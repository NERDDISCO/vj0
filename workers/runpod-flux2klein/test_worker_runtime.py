"""CPU-only configuration/guard regressions; no model or CUDA imports."""
import ast
import hashlib
import importlib.util
import inspect
from pathlib import Path
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import patch

import worker_runtime as runtime


class FakeTorch:
    def __init__(self):
        self.threads = 128
        self.changes = []

    def get_num_threads(self):
        return self.threads

    def set_num_threads(self, value):
        self.changes.append(value)
        self.threads = value


class ThreadConfiguration(unittest.TestCase):
    def test_native_default_and_explicit_values_are_applied(self):
        for env, expected in [({}, 128), ({"TORCH_NUM_THREADS": "1"}, 1),
                              ({"TORCH_NUM_THREADS": "8"}, 8)]:
            with self.subTest(env=env):
                torch = FakeTorch()
                self.assertEqual(runtime.configure_torch_threads(torch, lambda _: None, env), expected)
                self.assertEqual(torch.changes, [expected] if env else [])

    def test_zero_preserves_the_native_pool(self):
        torch = FakeTorch()
        self.assertEqual(runtime.configure_torch_threads(torch, lambda _: None,
                                                        {"TORCH_NUM_THREADS": "0"}), 128)
        self.assertEqual(torch.changes, [])

    def test_invalid_thread_values_fail_before_mutating_the_pool(self):
        for value in ["", "-1", "1.5", "257", "all"]:
            with self.subTest(value=value):
                torch = FakeTorch()
                with self.assertRaisesRegex(ValueError, "TORCH_NUM_THREADS"):
                    runtime.configure_torch_threads(torch, lambda _: None, {"TORCH_NUM_THREADS": value})
                self.assertEqual(torch.changes, [])


class TerminalInstallation(unittest.TestCase):
    def setUp(self):
        class Pipeline:
            def __call__(self):
                return "original"
        self.pipe = Pipeline()
        self.original = Pipeline.__call__
        self.logs = []

    def test_disabled_is_the_default_and_does_not_load_or_patch(self):
        with patch.object(runtime, "_load_terminal_helper", side_effect=AssertionError("unexpected import")):
            self.assertFalse(runtime.configure_terminal_noop(self.pipe, self.logs.append, {}))
        self.assertIs(type(self.pipe).__call__, self.original)

    def test_explicit_opt_in_enables_the_installed_helper(self):
        def install(pipe):
            pipe._vj0_skip_terminal_enabled = False
        with patch.object(runtime, "_load_terminal_helper", return_value=SimpleNamespace(install=install)):
            self.assertTrue(runtime.configure_terminal_noop(self.pipe, self.logs.append,
                                                           {"USE_TERMINAL_NOOP": "1"}))
        self.assertTrue(self.pipe._vj0_skip_terminal_enabled)

    def test_source_or_dependency_mismatch_retains_original(self):
        for error in [RuntimeError("source mismatch"), ImportError("unsupported dependency")]:
            with self.subTest(error=error):
                with patch.object(runtime, "_load_terminal_helper", side_effect=error):
                    self.assertFalse(runtime.configure_terminal_noop(self.pipe, self.logs.append,
                                                                    {"USE_TERMINAL_NOOP": "1"}))
                self.assertIs(type(self.pipe).__call__, self.original)
                self.assertFalse(self.pipe._vj0_skip_terminal_enabled)
                self.assertEqual(self.pipe(), "original")

    def test_partial_installation_failure_restores_original_call(self):
        def install(pipe):
            type(pipe).__call__ = lambda _: "wrong"
            raise RuntimeError("partial installation")
        with patch.object(runtime, "_load_terminal_helper", return_value=SimpleNamespace(install=install)):
            self.assertFalse(runtime.configure_terminal_noop(self.pipe, self.logs.append,
                                                            {"USE_TERMINAL_NOOP": "1"}))
        self.assertIs(type(self.pipe).__call__, self.original)
        self.assertEqual(self.pipe(), "original")

    def test_invalid_toggle_fails_without_installing(self):
        with self.assertRaisesRegex(ValueError, "USE_TERMINAL_NOOP"):
            runtime.configure_terminal_noop(self.pipe, self.logs.append, {"USE_TERMINAL_NOOP": "yes"})
        self.assertIs(type(self.pipe).__call__, self.original)


class MeasuredTerminalGuard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.helper = runtime._load_terminal_helper()

    def fixture(self):
        class Scheduler:
            pass
        scheduler = Scheduler()
        scheduler.config = SimpleNamespace(stochastic_sampling=False, invert_sigmas=False)
        scheduler.step_index = 2
        scheduler.sigmas = [0.9, 0.45, 0.0, 0.0]
        pipe = SimpleNamespace(_vj0_skip_terminal_enabled=True,
            _vj0_terminal_scheduler_type=Scheduler, _vj0_terminal_skips=0,
            scheduler=scheduler, transformer=SimpleNamespace(dtype="bf16"))
        return pipe, SimpleNamespace(dtype="bf16")

    def test_exact_terminal_zero_update_is_eligible(self):
        pipe, latents = self.fixture()
        self.assertTrue(self.helper._terminal_is_noop(pipe, 2, [3, 2, 0], None, None, latents))
        self.assertEqual(pipe._vj0_terminal_skips, 1)

    def test_original_branch_retained_for_each_unsupported_condition(self):
        cases = ["disabled", "nonterminal", "scheduler_type", "stochastic", "invert",
                 "image_condition", "kv_cache", "dtype", "step_index", "sigma", "next_sigma"]
        for case in cases:
            with self.subTest(case=case):
                pipe, latents = self.fixture()
                index, image, cache = 2, None, None
                if case == "disabled": pipe._vj0_skip_terminal_enabled = False
                elif case == "nonterminal": index = 1
                elif case == "scheduler_type": pipe._vj0_terminal_scheduler_type = object
                elif case == "stochastic": pipe.scheduler.config.stochastic_sampling = True
                elif case == "invert": pipe.scheduler.config.invert_sigmas = True
                elif case == "image_condition": image = object()
                elif case == "kv_cache": cache = object()
                elif case == "dtype": latents.dtype = "fp32"
                elif case == "step_index": pipe.scheduler.step_index = 1
                elif case == "sigma": pipe.scheduler.sigmas[2] = 1e-12
                elif case == "next_sigma": pipe.scheduler.sigmas[3] = 1e-12
                self.assertFalse(self.helper._terminal_is_noop(pipe, index, [3, 2, 0], image, cache, latents))
                self.assertEqual(pipe._vj0_terminal_skips, 0)

    def test_unrecognized_pipeline_source_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "Unexpected pipeline source"):
            self.helper.transform_source("class Flux2KleinKVPipeline: pass")


class GPUOutputCastInstallation(unittest.TestCase):
    def setUp(self):
        self.original_calls = []
        def original(images):
            self.original_calls.append(images)
            return "original"
        self.original = original
        self.pipe = SimpleNamespace(image_processor=SimpleNamespace(pt_to_numpy=original))
        self.logs = []

    def test_disabled_does_not_load_validate_or_patch(self):
        with patch.object(runtime, "_validate_output_processor", side_effect=AssertionError("unexpected import")):
            with patch.object(runtime, "_load_gpu_output_cast_helper", side_effect=AssertionError("unexpected import")):
                self.assertFalse(runtime.configure_gpu_output_cast(self.pipe, None, self.logs.append, {}))
        self.assertIs(self.pipe.image_processor.pt_to_numpy, self.original)

    def test_explicit_opt_in_uses_measured_cast_and_retains_cpu_fallback(self):
        # Exercise the unchanged measured helper, including operation order,
        # without importing CUDA/Torch or performing the duplicate reference.
        class Tensor:
            is_cuda = True
            def __init__(self): self.operations = []
            def permute(self, *dims): self.operations.append(("permute", dims)); return self
            def float(self): self.operations.append("float"); return self
            def cpu(self): self.operations.append("cpu"); return self
            def numpy(self): self.operations.append("numpy"); return "converted"
        with patch.object(runtime, "_validate_output_processor"):
            self.assertTrue(runtime.configure_gpu_output_cast(self.pipe, None, self.logs.append,
                                                              {"USE_GPU_OUTPUT_CAST": "1"}))
        tensor = Tensor()
        self.assertEqual(self.pipe.image_processor.pt_to_numpy(tensor), "converted")
        self.assertEqual(tensor.operations, [("permute", (0, 2, 3, 1)), "float", "cpu", "numpy"])
        self.assertEqual(self.original_calls, [])
        self.assertFalse(self.pipe._vj0_gpu_output_cast_probe.compare_enabled)
        self.assertEqual(self.pipe._vj0_gpu_output_cast_probe.unchecked_calls, 1)
        self.assertIs(self.pipe.image_processor.pt_to_numpy, self.pipe._vj0_gpu_output_cast_convert)
        self.assertIs(self.pipe._vj0_gpu_output_cast_original, self.original)
        cpu = SimpleNamespace(is_cuda=False)
        self.assertEqual(self.pipe.image_processor.pt_to_numpy(cpu), "original")
        self.assertEqual(self.original_calls, [cpu])

    def test_guard_or_dependency_failure_retains_original(self):
        for stage in ["_validate_output_processor", "_load_gpu_output_cast_helper"]:
            with self.subTest(stage=stage):
                with patch.object(runtime, "_validate_output_processor"):
                    with patch.object(runtime, stage, side_effect=RuntimeError("unsupported source")):
                        self.assertFalse(runtime.configure_gpu_output_cast(self.pipe, None, self.logs.append,
                                                                           {"USE_GPU_OUTPUT_CAST": "1"}))
                self.assertIs(self.pipe.image_processor.pt_to_numpy, self.original)
                self.assertFalse(self.pipe._vj0_gpu_output_cast_enabled)

    def test_partial_installation_failure_restores_original(self):
        def broken_install(processor, numpy):
            processor.pt_to_numpy = lambda _: "wrong"
            raise RuntimeError("partial installation")
        with patch.object(runtime, "_validate_output_processor"):
            with patch.object(runtime, "_load_gpu_output_cast_helper",
                              return_value=SimpleNamespace(GPUOutputCastProbe=broken_install)):
                self.assertFalse(runtime.configure_gpu_output_cast(self.pipe, None, self.logs.append,
                                                                   {"USE_GPU_OUTPUT_CAST": "1"}))
        self.assertIs(self.pipe.image_processor.pt_to_numpy, self.original)

    def test_invalid_toggle_fails_without_patch(self):
        for value in ["", "yes", "2", "-1"]:
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "USE_GPU_OUTPUT_CAST"):
                    runtime.configure_gpu_output_cast(self.pipe, None, self.logs.append,
                                                       {"USE_GPU_OUTPUT_CAST": value})
                self.assertIs(self.pipe.image_processor.pt_to_numpy, self.original)

    def test_modified_measured_helper_is_rejected(self):
        with patch.object(Path, "read_bytes", return_value=b"changed"):
            with self.assertRaisesRegex(RuntimeError, "differs from the measured"):
                runtime._load_gpu_output_cast_helper()

    def test_source_guard_rejects_other_class_override_and_changed_source(self):
        class Vae:
            @staticmethod
            def pt_to_numpy(images):
                return "reference"
        class Flux(Vae): pass
        class Other(Flux): pass
        modules = {
            "diffusers": ModuleType("diffusers"),
            "diffusers.image_processor": SimpleNamespace(VaeImageProcessor=Vae),
            "diffusers.pipelines": ModuleType("diffusers.pipelines"),
            "diffusers.pipelines.flux2": ModuleType("diffusers.pipelines.flux2"),
            "diffusers.pipelines.flux2.image_processor": SimpleNamespace(Flux2ImageProcessor=Flux),
        }
        source_hash = hashlib.sha256(inspect.getsource(Vae.pt_to_numpy).encode()).hexdigest()
        with patch.dict("sys.modules", modules):
            with patch.object(runtime, "PT_TO_NUMPY_SOURCE_SHA256", source_hash):
                runtime._validate_output_processor(Flux())
                with self.assertRaisesRegex(RuntimeError, "Unsupported image processor"):
                    runtime._validate_output_processor(Other())
                overridden = Flux()
                overridden.pt_to_numpy = lambda _: "custom"
                with self.assertRaisesRegex(RuntimeError, "already overridden"):
                    runtime._validate_output_processor(overridden)
            with patch.object(runtime, "PT_TO_NUMPY_SOURCE_SHA256", "wrong"):
                with self.assertRaisesRegex(RuntimeError, "source differs"):
                    runtime._validate_output_processor(Flux())


class PackagingAndBootOrder(unittest.TestCase):
    def test_worker_can_be_imported_by_path_without_sibling_on_sys_path(self):
        torch = ModuleType("torch")
        torch.no_grad = lambda: lambda fn: fn
        numpy = ModuleType("numpy")
        pil = ModuleType("PIL")
        pil.Image = SimpleNamespace(Image=object)
        spec = importlib.util.spec_from_file_location("vj0_worker_import_test",
            Path(__file__).with_name("inference_server.py"))
        worker = importlib.util.module_from_spec(spec)
        # Block the bare sibling name: file-based import must resolve the
        # companion relative to inference_server.py instead of ambient paths.
        with patch.dict("sys.modules", {"torch": torch, "numpy": numpy, "PIL": pil,
                                         "worker_runtime": None}):
            spec.loader.exec_module(worker)
        self.assertEqual(worker.configure_torch_threads(FakeTorch(), lambda _: None, {}), 128)

    def test_runtime_setup_precedes_model_work_and_warmup(self):
        tree = ast.parse(Path(__file__).with_name("inference_server.py").read_text())
        setup = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "setup_pipeline")
        self.assertEqual(ast.unparse(setup.body[0].value.func), "configure_torch_threads")
        self.assertEqual(ast.unparse(setup.body[-3].value.func), "configure_terminal_noop")
        self.assertEqual(ast.unparse(setup.body[-2].value.func), "configure_gpu_output_cast")
        self.assertIsInstance(setup.body[-1], ast.Return)

    def test_image_contains_runtime_and_exact_measured_helper(self):
        root = Path(__file__).parent
        docker = (root / "Dockerfile").read_text()
        self.assertIn("COPY server.js inference_server.py worker_runtime.py ./", docker)
        self.assertIn("COPY bench/terminal_noop.py ./bench/terminal_noop.py", docker)
        self.assertIn("COPY bench/gpu_output_cast.py ./bench/gpu_output_cast.py", docker)
        self.assertIn("TORCH_NUM_THREADS=0", docker)
        self.assertIn("USE_GPU_OUTPUT_CAST=0", docker)
        self.assertEqual(hashlib.sha256((root / "bench/terminal_noop.py").read_bytes()).hexdigest(),
                         runtime.TERMINAL_HELPER_SHA256)
        self.assertEqual(hashlib.sha256((root / "bench/gpu_output_cast.py").read_bytes()).hexdigest(),
                         runtime.GPU_OUTPUT_CAST_HELPER_SHA256)


if __name__ == "__main__":
    unittest.main()
