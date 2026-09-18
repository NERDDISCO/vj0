"""Isolated experiment: avoid a denoiser prediction discarded by a zero Euler step.

This patches only the pinned pipeline in the benchmark process. The scheduler,
step count, shifted timesteps, callbacks and output processing stay in place.
There is no production default. Finite-output equivalence must be checked by the
caller: zero times a non-finite original prediction is not an algebraic no-op.
"""
import ast
import hashlib
import importlib
from pathlib import Path


PIPELINE_SHA256 = "76cc461fd6d277926ae9df402a070b639145f3e647a1d87721338bc31bd384a9"
SCHEDULER_SHA256 = "56a330bc5765578ac9738265c76a3213ab42ad61befe8c040777c538da52045d"


def transform_source(source):
    """Return a replacement __call__; fail closed if the pinned source differs."""
    if hashlib.sha256(source.encode()).hexdigest() != PIPELINE_SHA256:
        raise RuntimeError("Unexpected pipeline source; audit before adapting this experiment")
    tree = ast.parse(source)
    cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Flux2KleinKVPipeline")
    call = next(n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "__call__")
    matches = 0

    class ReplacePrediction(ast.NodeTransformer):
        def visit_If(self, node):
            nonlocal matches
            if ast.unparse(node.test) == "i == 0 and image_latents is not None":
                matches += 1
                guard = ast.parse("_vj0_terminal_is_noop(self, i, timesteps, image_latents, kv_cache, latents)", mode="eval").body
                assignment = ast.parse("noise_pred = torch.zeros_like(latents)").body[0]
                return ast.copy_location(ast.If(test=guard, body=[assignment], orelse=[node]), node)
            return self.generic_visit(node)

    call = ReplacePrediction().visit(call)
    if matches != 1:
        raise RuntimeError(f"Expected one prediction branch, found {matches}")
    return ast.fix_missing_locations(ast.Module(body=[call], type_ignores=[]))


def _terminal_is_noop(pipe, i, timesteps, image_latents, kv_cache, latents):
    if not getattr(pipe, "_vj0_skip_terminal_enabled", False) or i != len(timesteps) - 1:
        return False
    scheduler = pipe.scheduler
    config = scheduler.config
    if (type(scheduler) is not pipe._vj0_terminal_scheduler_type
            or config.stochastic_sampling or config.invert_sigmas
            or image_latents is not None or kv_cache is not None
            or latents.dtype != pipe.transformer.dtype
            or scheduler.step_index != i):
        return False
    # Deliberate scalar validation on the real, already shifted schedule. This
    # initial proof variant pays synchronization cost instead of guessing from
    # requested step count or silently changing compute_empirical_mu.
    if float(scheduler.sigmas[i]) != 0.0 or float(scheduler.sigmas[i + 1]) != 0.0:
        return False
    pipe._vj0_terminal_skips = getattr(pipe, "_vj0_terminal_skips", 0) + 1
    return True


def install(pipe):
    from diffusers.schedulers.scheduling_flow_match_euler_discrete import FlowMatchEulerDiscreteScheduler
    scheduler_module = importlib.import_module(FlowMatchEulerDiscreteScheduler.__module__)
    scheduler_hash = hashlib.sha256(Path(scheduler_module.__file__).read_bytes()).hexdigest()
    if scheduler_hash != SCHEDULER_SHA256 or type(pipe.scheduler) is not FlowMatchEulerDiscreteScheduler:
        raise RuntimeError("Unexpected scheduler source or class; audit before adapting this experiment")
    module = importlib.import_module(pipe.__class__.__module__)
    source = Path(module.__file__).read_text()
    code = compile(transform_source(source), str(module.__file__) + ":vj0-terminal-noop", "exec")
    namespace = dict(vars(module))
    namespace["_vj0_terminal_is_noop"] = _terminal_is_noop
    exec(code, namespace)
    original = pipe.__class__.__call__
    candidate = namespace["__call__"]

    def dispatch(self, *args, **kwargs):
        call = candidate if getattr(self, "_vj0_skip_terminal_enabled", False) else original
        return call(self, *args, **kwargs)

    pipe.__class__.__call__ = dispatch
    pipe._vj0_skip_terminal_enabled = False
    pipe._vj0_terminal_skips = 0
    pipe._vj0_terminal_scheduler_type = FlowMatchEulerDiscreteScheduler
    return original
