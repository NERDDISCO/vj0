"""Instance-scoped GPU output-cast experiment with quality-only reference checks.

Keeps the original NHWC permutation and FP32 array. Quality mode compares both
paths on the same generated CUDA tensor. Timing mode never calls the reference.
"""


class GPUOutputCastProbe:
    def __init__(self, processor, numpy):
        self.numpy = numpy
        self.original = processor.pt_to_numpy
        self.compare_enabled = False
        self.context = {}
        self.comparisons = []
        self.unchecked_calls = 0
        processor.pt_to_numpy = self.convert

    def convert(self, images):
        if not images.is_cuda:
            raise RuntimeError("GPU-output-cast experiment requires an actual CUDA tensor")
        result = images.permute(0, 2, 3, 1).float().cpu().numpy()
        if not self.compare_enabled:
            self.unchecked_calls += 1
            return result
        expected = self.original(images)
        equal = (expected.dtype == result.dtype and expected.shape == result.shape
                 and self.numpy.array_equal(expected, result)
                 and expected.tobytes() == result.tobytes())
        finite = bool(self.numpy.isfinite(expected).all() and self.numpy.isfinite(result).all())
        self.comparisons.append({
            **self.context,
            "input_dtype": str(images.dtype), "input_device": str(images.device),
            "input_shape": list(images.shape), "input_stride": list(images.stride()),
            "output_dtype": str(result.dtype), "output_shape": list(result.shape),
            "cpu_gpu_cast_exact": bool(equal), "finite": finite,
        })
        if not equal or not finite:
            raise RuntimeError("CPU/GPU output casts differ or contain non-finite values")
        return result
