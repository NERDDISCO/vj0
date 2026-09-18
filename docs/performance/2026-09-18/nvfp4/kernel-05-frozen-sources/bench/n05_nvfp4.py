"""Isolated N05 selective NVFP4 helpers; never imported by the production worker.

Native b12x is explicit: unsupported kernels raise rather than switching backend.
Weights are converted from the original BF16 checkpoint before TorchAO FP8.
The VAE, text path, attention, modulation and final projections are untouched.
"""
import copy
from contextlib import contextmanager
import hashlib
import importlib.util
from pathlib import Path
import re

FLASHINFER_VERSION = "0.6.18.post1"
FLASHINFER_COMMIT = "8bc3b578027791336c6ae87db5c9d76f82cef8bc"
FLASHINFER_SOURCE_HASHES = {
    "gemm/gemm_base.py": "de6b7ec299f45801e15e5b9ec7341c417c4d9df8d4a5b4650d701694c483ab8e",
    "gemm/kernels/dense_blockscaled_gemm_sm120_b12x.py": "eee668e5c143f1c31690ad8a7b44f65050fee3232df1e1c484a3789c2ef0d960",
    "quantization/fp4_quantization.py": "a003e182bf9667c28bf925fb6749f944dbb6b1d30e1800bf0d4f2a1bf855d23c",
}
FAMILY = re.compile(r"^transformer_blocks\.[0-9]+\.ff\.linear_(in|out)$")
CONFIGS = ("image_ff_in", "image_ff_both")


def selected(name, config):
    if config not in CONFIGS:
        raise ValueError(config)
    return bool(FAMILY.fullmatch(name)) and (
        config == "image_ff_both" or name.endswith("linear_in"))


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def import_worker(path):
    spec = importlib.util.spec_from_file_location("vj0_n05_worker", path)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    return worker


@contextmanager
def retain_original_weights(worker, capture_only=False):
    """Intercept setup locally; keep original BF16 copies before FP8 mutation.

capture_only suppresses transformer compilation solely for untimed input capture.
VAE compilation/precision, prompt cache and worker conditioning stay unchanged.
"""
    import torch
    import torchao.quantization as quantization
    originals = {}
    real_quantize = quantization.quantize_
    real_compile = torch.compile

    def quantize(module, *args, **kwargs):
        if hasattr(module, "single_transformer_blocks"):
            for name, layer in module.named_modules():
                if FAMILY.fullmatch(name):
                    assert isinstance(layer, torch.nn.Linear)
                    assert type(layer.weight) is torch.nn.Parameter
                    assert layer.weight.dtype == torch.bfloat16
                    originals[name] = copy.deepcopy(layer).cpu()
        return real_quantize(module, *args, **kwargs)

    def compile_model(module, *args, **kwargs):
        if capture_only and hasattr(module, "single_transformer_blocks"):
            return module
        return real_compile(module, *args, **kwargs)

    quantization.quantize_ = quantize
    torch.compile = compile_model
    try:
        yield originals
    finally:
        quantization.quantize_ = real_quantize
        torch.compile = real_compile


def prepare_native():
    import importlib.metadata
    import torch
    import flashinfer
    from flashinfer import SfLayout, mm_fp4, nvfp4_quantize
    assert importlib.metadata.version("flashinfer-python") == FLASHINFER_VERSION
    assert torch.cuda.get_device_capability() == (12, 0), "N05 pilot requires actual SM120"
    assert int(torch.version.cuda.split(".")[0]) >= 13, "b12x requires CUDA13+"
    assert mm_fp4.is_backend_supported("b12x", 120)
    # This is an opaque GPU operator so torch.compile keeps the native kernel.
    # There is deliberately no dequantization or alternative matmul in this path.
    @torch.library.custom_op("vj0_n05::linear_b12x", mutates_args=())
    def native_linear(x: torch.Tensor, packed_weight: torch.Tensor,
                      weight_scale: torch.Tensor, weight_global: torch.Tensor) -> torch.Tensor:
        a = x.reshape(-1, x.shape[-1]).contiguous()
        global_a = 2688.0 / a.float().abs().amax().clamp_min(1e-30)
        packed_a, scale_a = nvfp4_quantize(
            a, global_a, sfLayout=SfLayout.layout_128x4,
            do_shuffle=False, backend="cuda")
        return mm_fp4(
            packed_a, packed_weight.T, scale_a, weight_scale.T,
            1.0 / (global_a * weight_global), out_dtype=torch.bfloat16,
            block_size=16, use_8x4_sf_layout=False, backend="b12x",
            use_nvfp4=True).reshape(*x.shape[:-1], packed_weight.shape[0])

    @native_linear.register_fake
    def fake(x, packed_weight, weight_scale, weight_global):
        return x.new_empty((*x.shape[:-1], packed_weight.shape[0]))

    class Nvfp4Linear(torch.nn.Module):
        def __init__(self, original):
            super().__init__()
            assert original.bias is None, "Pilot is limited to unbiased image FFNs"
            weight = original.weight.detach().to(device="cuda", dtype=torch.bfloat16).contiguous()
            assert weight.ndim == 2 and weight.shape[1] % 32 == 0
            assert torch.isfinite(weight).all().item() and weight.abs().max().item() > 0
            scale = 2688.0 / weight.float().abs().amax().clamp_min(1e-30)
            packed, block_scale = nvfp4_quantize(
                weight, scale, sfLayout=SfLayout.layout_128x4,
                do_shuffle=False, backend="cuda")
            self.register_buffer("packed_weight", packed)
            self.register_buffer("weight_scale", block_scale)
            self.register_buffer("weight_global", scale)
            self.in_features, self.out_features = weight.shape[1], weight.shape[0]

        def forward(self, x):
            return native_linear(x, self.packed_weight, self.weight_scale, self.weight_global)

    package = Path(flashinfer.__file__).parent
    actual_hashes = {name: sha(package / name) for name in FLASHINFER_SOURCE_HASHES}
    assert actual_hashes == FLASHINFER_SOURCE_HASHES, "FlashInfer wheel differs from audited release source"
    identity = {
        "version": FLASHINFER_VERSION, "release_commit": FLASHINFER_COMMIT,
        "backend": "b12x", "activation_quantization": "cuda, dynamic tensor global + block16",
        "source_sha256": actual_hashes,
    }
    return Nvfp4Linear, identity


def replace_layers(transformer, layers):
    root = getattr(transformer, "_orig_mod", transformer)
    for name, layer in layers.items():
        parent, child = name.rsplit(".", 1)
        setattr(root.get_submodule(parent), child, layer)


def fixture(width, height, phase=0):
    """JPEG input covering silence, thin/dense waveform, beat and scene cut."""
    import io
    import numpy as np
    from PIL import Image, ImageDraw
    image = Image.new("RGB", (width, height), (10, 10, 10))
    draw = ImageDraw.Draw(image)
    xs = np.arange(width)
    if phase != 0:
        dense = phase >= 2
        ys = height * (0.5 + 0.24 * np.sin(xs / width * 4 * np.pi + phase * 0.25)
                       + (0.07 if dense else 0) * np.sin(xs / width * 19 * np.pi - phase * 0.17))
        draw.line(list(zip(xs.tolist(), ys.tolist())), fill="white",
                  width=max(1, width // (96 if dense else 256)))
    if phase == 3:
        draw.rectangle((width // 3, height // 4, width // 3 + width // 16, 3 * height // 4),
                       fill=(255, 255, 255))
    if phase >= 4:
        image = Image.new("RGB", (width, height), (40, 8, 90))
        draw = ImageDraw.Draw(image)
        draw.ellipse((width // 5, height // 5, 4 * width // 5, 4 * height // 5),
                     fill=(40, 200, 255))
    stream = io.BytesIO()
    image.save(stream, format="JPEG", quality=85)
    return stream.getvalue()
