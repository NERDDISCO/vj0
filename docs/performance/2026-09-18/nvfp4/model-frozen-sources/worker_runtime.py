"""Boot-time controls for the measured Klein worker optimizations.

No GPU work or optional dependency import happens when this module is imported.
Terminal prediction skipping stays opt-in and uses the exact audited helper.
"""
import hashlib
import importlib.util
import inspect
import os
from pathlib import Path


TERMINAL_HELPER_SHA256 = "33a741c159b6432bc5ee38b8206708cb41cbbfb648072faa9cd0817fbcb667da"
GPU_OUTPUT_CAST_HELPER_SHA256 = "2bf079647d464b4dbc5c429615d66e47cf93a8b9ddebb4cd1278c6aeb9562d87"
# inspect.getsource(VaeImageProcessor.pt_to_numpy), including @staticmethod,
# in the Diffusers revision pinned by requirements.txt.
PT_TO_NUMPY_SOURCE_SHA256 = "315d31184f8fe84b0cec55e5f0837545b0540216bafd8bc7cb4cdbe9f2a1f9e5"


def configure_torch_threads(torch, log, environ=None):
    """Set intra-op threads before model loading; zero preserves native choice."""
    env = os.environ if environ is None else environ
    raw = env.get("TORCH_NUM_THREADS", "0")
    try:
        requested = int(raw)
    except (TypeError, ValueError):
        raise ValueError("TORCH_NUM_THREADS must be an integer from 0 to 256") from None
    if not 0 <= requested <= 256:
        raise ValueError("TORCH_NUM_THREADS must be an integer from 0 to 256")
    previous = torch.get_num_threads()
    if requested:
        torch.set_num_threads(requested)
    effective = torch.get_num_threads()
    log(f"CPU intra-op threads={effective} (previous={previous}, "
        f"TORCH_NUM_THREADS={requested}; 0 preserves native selection)")
    return effective


def _load_terminal_helper():
    path = Path(__file__).with_name("bench") / "terminal_noop.py"
    if hashlib.sha256(path.read_bytes()).hexdigest() != TERMINAL_HELPER_SHA256:
        raise RuntimeError("Terminal helper differs from the audited implementation")
    spec = importlib.util.spec_from_file_location("vj0_terminal_noop_runtime", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def configure_terminal_noop(pipe, log, environ=None):
    """Enable the audited patch only when requested and all source guards pass.

    Installation failure restores the original call method. Once installed,
    the measured helper retains the original prediction branch whenever its
    per-step scheduler/dtype/conditioning checks do not match.
    """
    env = os.environ if environ is None else environ
    requested = env.get("USE_TERMINAL_NOOP", "0")
    if requested not in ("0", "1"):
        raise ValueError("USE_TERMINAL_NOOP must be 0 or 1")
    if requested == "0":
        log("terminal_noop=disabled (USE_TERMINAL_NOOP=0)")
        return False

    pipeline_type = type(pipe)
    original_call = pipeline_type.__call__
    try:
        helper = _load_terminal_helper()
        helper.install(pipe)
    except Exception as exc:
        pipeline_type.__call__ = original_call
        pipe._vj0_skip_terminal_enabled = False
        log(f"terminal_noop=disabled; original pipeline retained "
            f"({type(exc).__name__}: {exc})")
        return False

    pipe._vj0_skip_terminal_enabled = True
    log("terminal_noop=enabled; audited helper, pipeline and scheduler source guards passed")
    return True


def _load_gpu_output_cast_helper():
    path = Path(__file__).with_name("bench") / "gpu_output_cast.py"
    if hashlib.sha256(path.read_bytes()).hexdigest() != GPU_OUTPUT_CAST_HELPER_SHA256:
        raise RuntimeError("GPU output-cast helper differs from the measured implementation")
    spec = importlib.util.spec_from_file_location("vj0_gpu_output_cast_runtime", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _validate_output_processor(processor):
    from diffusers.image_processor import VaeImageProcessor
    from diffusers.pipelines.flux2.image_processor import Flux2ImageProcessor

    if type(processor) is not Flux2ImageProcessor:
        raise RuntimeError("Unsupported image processor class")
    original = processor.pt_to_numpy
    if original is not VaeImageProcessor.pt_to_numpy:
        raise RuntimeError("Image conversion is already overridden")
    if hashlib.sha256(inspect.getsource(original).encode()).hexdigest() != PT_TO_NUMPY_SOURCE_SHA256:
        raise RuntimeError("Image conversion source differs from the pinned implementation")


def configure_gpu_output_cast(pipe, numpy, log, environ=None):
    """Install the exact measured cast on this processor instance, when opted in.

    The helper keeps the same NHWC FP32 output, casting before the GPU download.
    CPU inputs retain the original converter. Installation failure also retains
    the original; runtime CUDA errors use the worker's existing error handling.
    """
    env = os.environ if environ is None else environ
    requested = env.get("USE_GPU_OUTPUT_CAST", "0")
    if requested not in ("0", "1"):
        raise ValueError("USE_GPU_OUTPUT_CAST must be 0 or 1")
    if requested == "0":
        log("gpu_output_cast=disabled (USE_GPU_OUTPUT_CAST=0)")
        return False

    processor = pipe.image_processor
    original = processor.pt_to_numpy
    try:
        _validate_output_processor(processor)
        helper = _load_gpu_output_cast_helper()
        probe = helper.GPUOutputCastProbe(processor, numpy)

        def convert(images):
            if not images.is_cuda:
                return original(images)
            return probe.convert(images)

        processor.pt_to_numpy = convert
    except Exception as exc:
        processor.pt_to_numpy = original
        pipe._vj0_gpu_output_cast_enabled = False
        log(f"gpu_output_cast=disabled; original image conversion retained "
            f"({type(exc).__name__}: {exc})")
        return False

    # Keep the selected callables available to paired quality/throughput checks.
    # The live worker does not toggle them or enable duplicate reference work.
    pipe._vj0_gpu_output_cast_original = original
    pipe._vj0_gpu_output_cast_convert = convert
    pipe._vj0_gpu_output_cast_probe = probe
    pipe._vj0_gpu_output_cast_enabled = True
    log("gpu_output_cast=enabled; measured helper and pinned image-conversion source guards passed")
    return True
