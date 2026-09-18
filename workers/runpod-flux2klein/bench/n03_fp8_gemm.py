#!/usr/bin/env python3
"""SM120-only, same-input FP8 GEMM microbenchmark and gated pipeline follow-up.

Capture real model operands, rank two shape families by CUDA event activity,
then allow only two generic Triton mm tiles. No TMA/CuTe/SM100 template and no
whole-model autotuning. A numerical failure is evidence, never a promotion.
"""
import argparse
import ast
from collections import Counter
from collections import defaultdict
from contextlib import contextmanager
import gzip
import hashlib
import json
from pathlib import Path
import statistics
import sys
import time

from n03n04_common import Experiment, add_common_arguments, deadline, parse_sizes, sha

SAFE_TILES = {(64,128,64,4,4),(128,64,64,4,4)}
TILE_KEYS = ('BLOCK_M', 'BLOCK_N', 'BLOCK_K', 'num_stages', 'num_warps')


class ExecutionProofUnresolved(RuntimeError):
    """Retain source/trace for bounded review; not a hardware/numerical verdict."""


def literal_field(node, key):
    """Read one literal metadata field without evaluating generated code."""
    if not isinstance(node, ast.Dict):
        raise ValueError('Expected literal metadata dictionary')
    matches = [value for name, value in zip(node.keys, node.values)
               if isinstance(name, ast.Constant) and name.value == key]
    if len(matches) != 1:
        raise ValueError('Missing or duplicate metadata field: ' + key)
    return matches[0]


def template_record(kernel_name, source):
    """Fail closed on unrecognized generated Triton template source formats.

    A pointwise kernel can contain '_scaled_mm' in its name. Evidence therefore
    requires the actual template decorator, FP8 inputs, dot instruction, static
    M/N/K and the exact allowed tile, bound to the runtime kernel name.
    """
    record = {'kernel_name': kernel_name,
              'source_sha256': hashlib.sha256(source.encode()).hexdigest()}
    try:
        tree = ast.parse(source)
        functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)
                     and n.name == kernel_name]
        if not kernel_name.startswith('triton_tem_') or len(functions) != 1:
            raise ValueError('Not an exact named Triton template function')
        function = functions[0]
        decorators = [n for n in function.decorator_list if isinstance(n, ast.Call)
                      and isinstance(n.func, ast.Attribute) and n.func.attr == 'template'
                      and isinstance(n.func.value, ast.Name) and n.func.value.id == 'triton_heuristics']
        if len(decorators) != 1:
            raise ValueError('Missing audited triton_heuristics.template decorator')
        kwargs = {k.arg: k.value for k in decorators[0].keywords}
        metadata_name = ast.literal_eval(literal_field(kwargs['inductor_meta'], 'kernel_name'))
        if metadata_name != kernel_name:
            raise ValueError('Generated metadata kernel name differs')
        signature = ast.literal_eval(literal_field(kwargs['triton_meta'], 'signature'))
        types = signature.values() if isinstance(signature, dict) else signature
        if sum(isinstance(v, str) and v.startswith('*fp8') for v in types) < 2:
            raise ValueError('Two FP8 pointer inputs are not established; a fused BF16-to-FP8 prologue requires review of saved source, not a hardware-failure conclusion')
        dot = [n for n in ast.walk(function) if isinstance(n, ast.Call)
               and isinstance(n.func, ast.Attribute) and n.func.attr == 'dot'
               and isinstance(n.func.value, ast.Name) and n.func.value.id == 'tl']
        if not dot:
            raise ValueError('No tl.dot GEMM instruction in generated function')
        constants = {}
        wanted = {'M', 'N', 'K', 'BLOCK_M', 'BLOCK_N', 'BLOCK_K'}
        for node in function.body:
            targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, ast.AnnAssign) else []
            for target in targets:
                if isinstance(target, ast.Name) and target.id in wanted:
                    value = ast.literal_eval(node.value)
                    if target.id in constants or type(value) is not int or value <= 0:
                        raise ValueError('Ambiguous or invalid static GEMM constant')
                    constants[target.id] = value
        shape = tuple(constants[k] for k in ('M', 'N', 'K'))
        tile = tuple(constants[k] for k in TILE_KEYS[:3]) + tuple(ast.literal_eval(kwargs[k]) for k in TILE_KEYS[3:])
        if tile not in SAFE_TILES:
            raise ValueError('Generated tile is outside fixed allowlist')
        record.update(status='verified', shape=list(shape), tile=list(tile),
                      fp8_signature=signature, dot_calls_in_source=len(dot))
    except (ValueError, TypeError, KeyError, SyntaxError) as error:
        record.update(status='unverified', error=f'{type(error).__name__}: {error}')
    return record


def wrapper_records(source):
    """Inspect literal async_compile.triton payloads, never execute their code."""
    tree = ast.parse(source)
    records = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name) and node.targets[0].id.startswith('triton_tem_')):
            continue
        name, call = node.targets[0].id, node.value
        if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute)
                and isinstance(call.func.value, ast.Name) and call.func.value.id == 'async_compile'
                and call.func.attr == 'triton' and len(call.args) >= 2
                and isinstance(call.args[0], ast.Constant) and call.args[0].value == name
                and isinstance(call.args[1], ast.Constant) and isinstance(call.args[1].value, str)):
            records.append({'kernel_name': name, 'status': 'unverified',
                            'error': 'Unrecognized async_compile.triton binding'})
            continue
        records.append(template_record(name, call.args[1].value))
    return records


@contextmanager
def track_candidate_source_loads():
    """Track actual wrapper bindings, including cached modules returned on a hit.

    Torch2.11 exposes modules/modules_no_attr, not the old PyCodeCache.cache.
    Intercepting the installed classmethod records which module the candidate
    actually loaded without treating unrelated old cache contents as evidence.
    """
    from types import ModuleType
    from torch._inductor.codecache import PyCodeCache
    if not isinstance(PyCodeCache.modules, list) or not isinstance(PyCodeCache.modules_no_attr, dict):
        raise ExecutionProofUnresolved('Unrecognized PyCodeCache module registry API')
    descriptor = PyCodeCache.__dict__.get('load_by_key_path')
    if not isinstance(descriptor, classmethod):
        raise ExecutionProofUnresolved('Unrecognized PyCodeCache loader descriptor')
    original = descriptor.__get__(None, PyCodeCache)
    before = {id(module) for module in PyCodeCache.modules}
    loads = []
    def tracked(cls, *args, **kwargs):
        module = original(*args, **kwargs)
        if not isinstance(module, ModuleType) or not isinstance(getattr(module, '__file__', None), str):
            raise ExecutionProofUnresolved('PyCodeCache returned an unrecognized source module')
        key = args[0] if args else kwargs.get('key')
        loads.append({'cache_key': str(key), 'module': module,
                      'already_loaded_before_candidate': id(module) in before})
        return module
    replacement = classmethod(tracked)
    PyCodeCache.load_by_key_path = replacement
    try:
        yield loads
    finally:
        if PyCodeCache.__dict__.get('load_by_key_path') is not replacement:
            raise ExecutionProofUnresolved('Candidate code-cache loader changed concurrently')
        PyCodeCache.load_by_key_path = descriptor


def archive_generated_sources(loads, output, tag):
    """Save only wrappers actually bound during this candidate, including hits."""
    sources, errors = [], []
    unique = {}
    for entry in loads:
        unique.setdefault(id(entry['module']), entry)
    if not unique or len(unique) > 64:
        return [], ['No candidate-bound wrappers or more than64 wrappers; source proof ambiguous']
    for index, entry in enumerate(unique.values()):
        module = entry['module']
        record = {'cache_key': entry['cache_key'], 'original_path': module.__file__,
                  'already_loaded_before_candidate': entry['already_loaded_before_candidate']}
        try:
            path = Path(module.__file__)
            if path.stat().st_size > 16 * 1024 * 1024:
                raise ValueError('Generated wrapper exceeds bounded16 MiB source audit')
            data = path.read_bytes()
            destination = output / f'{tag}-generated-{index}.py.gz'
            if destination.exists():
                raise ValueError('Refusing to overwrite generated source evidence')
            destination.write_bytes(gzip.compress(data))
            record.update(artifact=destination.name, sha256=hashlib.sha256(data).hexdigest(),
                          templates=wrapper_records(data.decode()))
        except (OSError, AttributeError, TypeError, ValueError, SyntaxError) as error:
            record['error'] = f'{type(error).__name__}: {error}'
            errors.append(record['error'])
        sources.append(record)
    return sources, errors


def prove_template_execution(sources, trace, expected, compile_log, targets, *, micro=False, source_errors=()):
    """Join exact runtime symbols to generated candidate source and shape counts."""
    errors = list(source_errors)
    allowed = set(targets)
    by_shape = defaultdict(set)
    for entry in compile_log:
        shape = tuple(entry.get('shape', []))
        tiles = [tuple(t.get(k) for k in TILE_KEYS) for t in entry.get('selected_tiles', [])]
        if shape not in allowed or not tiles or any(t not in SAFE_TILES for t in tiles):
            errors.append('Compiler choices are not bound to the allowed shape/tile contract')
        by_shape[shape].update(tiles)
    by_name = defaultdict(dict)
    for source in sources:
        for record in source.get('templates', []):
            key = record.get('source_sha256', json.dumps(record, sort_keys=True))
            by_name[record['kernel_name']][key] = record
    matched, observed = [], Counter()
    for name, launches in trace['counts'].items():
        if not name.startswith('triton_tem_'):
            continue
        candidates = list(by_name.get(name, {}).values())
        if len(candidates) != 1:
            # Other unchanged pipeline operators can have their own templates;
            # a micrograph has only one scaled-mm and permits no unknown template.
            if candidates or micro:
                errors.append('Missing/ambiguous generated source for runtime template: ' + name)
            continue
        record = candidates[0]
        if record.get('status') != 'verified':
            errors.append('Unverified generated runtime template: ' + name)
            continue
        shape, tile = tuple(record['shape']), tuple(record['tile'])
        if shape not in expected:
            if micro:
                errors.append('Micrograph executed an unexpected template GEMM shape')
            continue
        if tile not in by_shape.get(shape, set()):
            errors.append('Runtime template tile lacks matching compiler choices: ' + name)
            continue
        observed[shape] += launches
        matched.append({**record, 'runtime_launches': launches})
    if not expected or any(n <= 0 for n in expected.values()):
        errors.append('No positive expected selected-GEMM count')
    for shape, count in expected.items():
        if observed[shape] != count:
            errors.append(f'Selected GEMM {shape}: expected {count} runtime launches, observed {observed[shape]}')
    return {'status': 'passed' if not errors else 'failed', 'errors': errors,
            'expected_launches': [{'shape': list(k), 'count': v} for k, v in sorted(expected.items())],
            'matched_runtime_templates': matched, 'generated_sources': sources,
            'bounded_choices': compile_log, 'runtime_trace': trace,
            'scope': 'Actual template GEMM events joined to candidate-bound PyCodeCache source (including cache hits), FP8 signature, tl.dot, static shape and allowlisted tile; pointwise/reduction kernels never count'}


def pipeline_shape_counts(experiment, transformer, raw, width, height):
    """One untimed eager diagnostic counts selected shapes at this resolution."""
    from torch.utils._python_dispatch import TorchDispatchMode
    torch = experiment.torch
    counts = Counter()
    class Count(TorchDispatchMode):
        def __torch_dispatch__(self, func, types, args=(), kwargs=None):
            kwargs = kwargs or {}
            if func is torch.ops.aten._scaled_mm.default:
                shape, _ = descriptor(torch, func, args, kwargs)
                counts[shape] += 1
            return func(*args, **kwargs)
    prior = experiment.pipe.transformer
    had_instance_forward = 'forward' in transformer.__dict__
    original = transformer.forward
    def count_forward(*args, **kwargs):
        with Count():
            return original(*args, **kwargs)
    experiment.pipe.transformer = transformer
    transformer.forward = count_forward
    try:
        experiment.run(raw, width, height)
        torch.cuda.synchronize()
    finally:
        if had_instance_forward:
            transformer.forward = original
        else:
            del transformer.forward
        experiment.pipe.transformer = prior
    return counts


def source_proof_self_test():
    """Dependency-free positive/negative evidence fixtures; never imports torch."""
    import copy
    kernel = 'triton_tem_fused__scaled_mm_0'
    source = f'''import triton
import triton.language as tl
@triton_heuristics.template(num_stages=4, num_warps=4,
    triton_meta={{'signature': {{0:'*fp8e4nv',1:'*fp8e4nv',2:'*bf16'}}, 'device': DeviceProperties()}},
    inductor_meta={{'kernel_name': {kernel!r}}})
@triton.jit
def {kernel}(a,b,out):
    M = 2304
    N = 12288
    K = 3072
    BLOCK_M: tl.constexpr = 64
    BLOCK_N: tl.constexpr = 128
    BLOCK_K: tl.constexpr = 64
    acc = tl.dot(a,b)
'''
    wrapper = f'{kernel} = async_compile.triton({kernel!r}, {source!r}, device_str="cuda")'
    records = wrapper_records(wrapper)
    assert len(records) == 1 and records[0]['status'] == 'verified', records
    shape = (2304, 12288, 3072)
    log = [{'shape':list(shape), 'selected_tiles':[dict(zip(TILE_KEYS,(64,128,64,4,4)))]}]
    sources = [{'templates':records}]
    trace = {'counts':{kernel:3}, 'names':[kernel]}
    def check(s=sources, t=trace, c=log, expected=None, micro=True):
        return prove_template_execution(s,t,expected or {shape:3},c,{shape},micro=micro)['status']
    assert check() == 'passed'
    assert check(expected={shape:3}, micro=False) == 'passed'
    failures = 0
    for changed in [source.replace('tl.dot(a,b)','a+b'),
                    source.replace('BLOCK_K: tl.constexpr = 64','BLOCK_K: tl.constexpr = 128'),
                    source.replace('num_warps=4','num_warps=8'),
                    source.replace('M = 2304','M = a.shape[0]'),
                    source.replace("'*fp8e4nv'", "'*bf16'"),
                    source.replace('triton_heuristics.template','triton_heuristics.pointwise'),
                    source.replace("'kernel_name': 'triton_tem_fused__scaled_mm_0'", "'kernel_name': 'other'")]:
        invalid = template_record(kernel, changed)
        assert invalid['status'] == 'unverified', invalid
        assert check(s=[{'templates':[invalid]}]) == 'failed'
        failures += 1
    for count in (0, 1, 2, 4):
        assert check(t={'counts':{kernel:count}}) == 'failed'
        failures += 1
    # Realistic old false positive: '_scaled_mm' appears in a pointwise name.
    assert check(t={'counts':{'triton_poi_fused__scaled_mm__to_copy_clamp_div_t_transpose_view_51':3}}) == 'failed'
    assert check(s=[]) == 'failed'
    assert check(c=[]) == 'failed'
    bad_log = copy.deepcopy(log); bad_log[0]['shape'][0] = 576
    assert check(c=bad_log) == 'failed'
    duplicate = template_record(kernel, source.replace('N = 12288', 'N = 6144'))
    assert check(s=[{'templates':records+[duplicate]}]) == 'failed'
    mismatched = wrapper.replace(f'async_compile.triton({kernel!r},', "async_compile.triton('other',")
    assert wrapper_records(mismatched)[0]['status'] == 'unverified'
    # Full pipeline must match the independently counted number of selected ops.
    assert check(t={'counts':{kernel:15}}, expected={shape:15}, micro=False) == 'passed'
    assert check(t={'counts':{kernel:14}}, expected={shape:15}, micro=False) == 'failed'
    print(json.dumps({'source_proof_self_test':'passed','negative_cases':failures+7,
                      'scope':'Pure generated-source/runtime-event fixtures; no GPU or compiler execution'}))


def descriptor(torch, func, args, kwargs):
    bound={parameter.name:value for parameter,value in zip(func._schema.arguments,args)}
    bound.update(kwargs)
    for parameter in func._schema.arguments:
        if parameter.name not in bound and parameter.has_default_value():
            bound[parameter.name]=parameter.default_value
    a,b=bound['self'],bound['mat2']
    return (int(a.shape[0]),int(b.shape[1]),int(a.shape[1])),bound


def isolated_backend(experiment, targets, compile_log):
    """Change lowering only for selected scaled-mm shapes; leave other ops alone."""
    torch=experiment.torch
    from torch._inductor import config
    from torch._inductor.choices import InductorChoices
    from torch._inductor.kernel.mm import mm_template
    from torch._inductor.lowering import lowerings
    from torch._inductor.virtualized import V
    op=torch.ops.aten._scaled_mm.default
    original=lowerings[op]

    class BoundedChoices(InductorChoices):
        def _finalize_template_configs(self, choices, inputs, templates, op_name, kwarg_overrides=None):
            if op_name!='scaled_mm':
                return super()._finalize_template_configs(choices,inputs,templates,op_name,kwarg_overrides)
            selected=[]
            for template in templates:
                if template is not mm_template:
                    continue
                for choice in choices.get(template.uid,[]):
                    params=choice.params.to_kwargs()
                    tile=tuple(params.get(key) for key in ['BLOCK_M','BLOCK_N','BLOCK_K','num_stages','num_warps'])
                    if tile in SAFE_TILES:
                        selected.append(choice)
            if not selected:
                raise RuntimeError('No compatible generic Triton scaled-mm tile from fixed allowlist')
            compile_log.append({'shape':[int(value) for value in inputs.mnk_symbolic()],
                                'selected_tiles':[choice.params.to_kwargs() for choice in selected]})
            return selected

    def selected_lowering(a,b,*rest,**kwargs):
        shape=(int(a.get_size()[0]),int(b.get_size()[1]),int(a.get_size()[1]))
        if shape not in targets:
            return original(a,b,*rest,**kwargs)
        with config.patch({'max_autotune_gemm':True,'max_autotune_gemm_backends':'TRITON'}), \
             V.set_choices_handler(BoundedChoices()):
            return original(a,b,*rest,**kwargs)

    def backend(graph, example_inputs):
        prior=lowerings[op]
        lowerings[op]=selected_lowering
        try:
            return torch._inductor.compile(graph,example_inputs,
                    options={'triton.cudagraphs':True,'fx_graph_cache':False})
        finally:
            lowerings[op]=prior
    return backend


def scaled_callable(torch, bound):
    def run(a,b,scale_a,scale_b,bias,scale_result):
        return torch._scaled_mm(a,b,scale_a,scale_b,bias=bias,scale_result=scale_result,
                                out_dtype=bound['out_dtype'],use_fast_accum=bound['use_fast_accum'])
    values=tuple(bound[key] for key in ['self','mat2','scale_a','scale_b','bias','scale_result'])
    return run,values


def trace_kernels(experiment, call, path):
    torch=experiment.torch
    with torch.profiler.profile(activities=[torch.profiler.ProfilerActivity.CPU,
                                           torch.profiler.ProfilerActivity.CUDA],
                                record_shapes=False,with_stack=False) as profile:
        for _ in range(3):call()
        torch.cuda.synchronize()
    temporary=path.with_suffix('');profile.export_chrome_trace(str(temporary))
    data=temporary.read_bytes();path.write_bytes(gzip.compress(data));temporary.unlink()
    trace=json.loads(data)
    counts=Counter(event['name'] for event in trace['traceEvents'] if event.get('cat')=='kernel')
    return {'names':sorted(counts), 'counts':dict(counts), 'artifact':path.name, 'profiled_calls':3}


def main():
    if sys.argv[1:] == ['--self-test-source-proof']:
        source_proof_self_test()
        return
    parser=argparse.ArgumentParser(description=__doc__);add_common_arguments(parser)
    parser.set_defaults(sizes='1024x576,512x288,768x448')
    parser.add_argument('--capture-size',default='1024x576')
    parser.add_argument('--micro-iterations',type=int,default=100)
    args=parser.parse_args();args.probe=Path(__file__)
    experiment=None
    try:
        experiment=Experiment(args,'n03_fp8_gemm');torch=experiment.torch;pipe=experiment.pipe
        if not torch.__version__.startswith('2.11.'):
            raise RuntimeError('The isolated lowering extension is audited for Torch2.11; do not silently use another compiler')
        import torch._inductor.kernel.mm as mm_source
        import torch._inductor.choices as choice_source
        import torch._inductor.codecache as cache_source
        experiment.save({'status':'backend-contract','backend':'generic Inductor Triton scaled-mm',
                         'safe_tiles':[list(item) for item in sorted(SAFE_TILES)],
                         'excluded':'TMA, CuTeDSL, CUTLASS whole-model autotuning',
                         'shared_memory_operand_estimate_max_bytes':49152,
                         'sources':{module.__file__:sha(module.__file__) for module in (mm_source,choice_source,cache_source)}})
        compiled_transformer=pipe.transformer
        eager_transformer=getattr(compiled_transformer,'_orig_mod',compiled_transformer)
        width,height=parse_sizes(args.capture_size)[0]
        raw=experiment.make_input(width,height,0)
        with torch.no_grad():
            with deadline(args.compile_timeout,'N03 production control warmup'):
                for _ in range(4):experiment.run(raw,width,height)
            # The saved production trace deliberately omitted record_shapes.
            # Reconstruct the real shape inventory from the same loaded weights
            # outside measured runs; do not guess shapes from kernel names.
            from torch.utils._python_dispatch import TorchDispatchMode
            samples={};events=defaultdict(list);counts=defaultdict(int)
            class Capture(TorchDispatchMode):
                def __torch_dispatch__(self,func,types,args=(),kwargs=None):
                    kwargs=kwargs or {}
                    if func is not torch.ops.aten._scaled_mm.default:
                        return func(*args,**kwargs)
                    shape,bound=descriptor(torch,func,args,kwargs)
                    first=torch.cuda.Event(enable_timing=True);last=torch.cuda.Event(enable_timing=True)
                    first.record();output=func(*args,**kwargs);last.record()
                    counts[shape]+=1;events[shape].append((first,last))
                    if shape not in samples:
                        samples[shape]=bound
                    return output
            pipe.transformer=eager_transformer
            # Warm eager launch/allocation paths before ranking event activity.
            # Baseline compiled warmup alone does not warm every eager quantizer.
            for _ in range(2):experiment.run(raw,width,height)
            had_instance_forward='forward' in eager_transformer.__dict__
            original_forward=eager_transformer.forward
            def capture_forward(*args,**kwargs):
                with Capture():
                    return original_forward(*args,**kwargs)
            eager_transformer.forward=capture_forward
            try:
                experiment.run(raw,width,height)
                torch.cuda.synchronize()
            finally:
                if had_instance_forward:
                    eager_transformer.forward=original_forward
                else:
                    del eager_transformer.forward
                pipe.transformer=compiled_transformer
            ranking=sorted([{'shape':list(shape),'calls':counts[shape],
                             'summed_gpu_event_ms':sum(a.elapsed_time(b) for a,b in values)}
                            for shape,values in events.items()],
                           key=lambda row:row['summed_gpu_event_ms'],reverse=True)
            targets=[tuple(row['shape']) for row in ranking[:2]]
            assert len(targets)==2,'Expected at least two actual FP8 GEMM shape families'
            experiment.save({'status':'actual-shape-inventory','size':[width,height],
                             'ranking':ranking,'selected_shapes':[list(shape) for shape in targets],
                             'scope':'Eager diagnostic calls from original quantized transformer only; ranking is not production FPS'})
            # Release unused tensor references before the bounded microbench.
            samples={shape:samples[shape] for shape in targets}
            ready=True;surviving=[]
            for index,shape in enumerate(targets):
                bound=samples[shape]
                scale_a,scale_b=bound['scale_a'],bound['scale_b']
                assert scale_a.dtype==torch.float32 and scale_b.dtype==torch.float32
                assert scale_a.numel()==scale_b.numel()==1,'Only current per-tensor scaling is in scope'
                assert bound['self'].dtype==bound['mat2'].dtype==torch.float8_e4m3fn
                function,values=scaled_callable(torch,bound)
                contract={'shape':list(shape),'a_stride':list(bound['self'].stride()),'b_stride':list(bound['mat2'].stride()),
                          'input_dtype':str(bound['self'].dtype),'output_dtype':str(bound['out_dtype']),
                          'scale_shapes':[list(scale_a.shape),list(scale_b.shape)],
                          'scale_values':[float(scale_a),float(scale_b)],'use_fast_accum':bound['use_fast_accum'],
                          'has_bias':bound['bias'] is not None,'has_scale_result':bound['scale_result'] is not None}
                experiment.save({'status':'micro-contract',**contract})
                compile_log=[]
                baseline=torch.compile(function,mode='reduce-overhead',fullgraph=True,dynamic=False)
                candidate=torch.compile(function,backend=isolated_backend(experiment,{shape},compile_log),fullgraph=True,dynamic=False)
                try:
                    started=time.perf_counter()
                    with deadline(args.compile_timeout,'N03 one scaled-mm subgraph'):
                        for _ in range(4):baseline(*values)
                        torch.cuda.synchronize()
                        with track_candidate_source_loads() as source_loads:
                            for _ in range(4):candidate(*values)
                            torch.cuda.synchronize()
                            reference=baseline(*values).clone();torch.cuda.synchronize()
                            actual=candidate(*values).clone();torch.cuda.synchronize()
                            comparison=experiment.compare_array(reference.float().cpu().numpy(),actual.float().cpu().numpy())
                            kernels={}
                            for name,call in [('baseline',baseline),('candidate',candidate)]:
                                kernels[name]=trace_kernels(experiment,lambda:call(*values),args.output/f'micro-{index}-{name}.json.gz')
                            sources,source_errors=archive_generated_sources(source_loads,args.output,f'micro-{index}')
                    proof=prove_template_execution(sources,kernels['candidate'],{shape:3},compile_log,{shape},
                                                   micro=True,source_errors=source_errors)
                    experiment.save({'status':'micro-template-proof','shape':list(shape),'proof':proof})
                    if proof['status']!='passed':
                        raise ExecutionProofUnresolved('Selected template GEMM source/runtime proof unresolved; review saved exact artifacts before drawing a backend conclusion')
                    experiment.save({'status':'micro-quality','shape':list(shape),'comparison':comparison,
                                     'compile_seconds':time.perf_counter()-started,
                                     'kernel_names':{k:v['names'] for k,v in kernels.items()},
                                     'bounded_choices':compile_log,'actual_triton_gemm_execution':True})
                    # Microtiming a numerical loser is retained as a labelled tradeoff.
                    # It never passes the pipeline quality gate or becomes a default.
                    timings=[]
                    for pair in range(3):
                        for name in (['baseline','candidate'] if pair%2==0 else ['candidate','baseline']):
                            call=baseline if name=='baseline' else candidate
                            for _ in range(4):call(*values)
                            first=torch.cuda.Event(enable_timing=True);last=torch.cuda.Event(enable_timing=True)
                            first.record()
                            for _ in range(args.micro_iterations):call(*values)
                            last.record();last.synchronize()
                            row={'status':'micro-measured','shape':list(shape),'pair':pair,'variant':name,
                                 'iterations':args.micro_iterations,'gpu_ms_per_call':first.elapsed_time(last)/args.micro_iterations,
                                 'quality_passed':comparison['exact'],'timing_scope':'CUDA event interval around repeated compiled calls'}
                            timings.append(row);experiment.save(row)
                    medians={name:statistics.median(row['gpu_ms_per_call'] for row in timings if row['variant']==name) for name in ['baseline','candidate']}
                    repeatable=all(next(row['gpu_ms_per_call'] for row in timings if row['pair']==pair and row['variant']=='candidate')<next(row['gpu_ms_per_call'] for row in timings if row['pair']==pair and row['variant']=='baseline') for pair in range(3))
                    eligible=comparison['exact'] and comparison['finite'] and repeatable and medians['candidate']<medians['baseline']*.98
                    experiment.save({'status':'micro-decision','shape':list(shape),'eligible':eligible,
                                     'median_ms':medians,'repeatable_faster':repeatable,
                                     'decision':'advance exact repeatable >2% micro gain' if eligible else 'retain original path'})
                    if eligible:surviving.append(shape)
                except ExecutionProofUnresolved as error:
                    experiment.save({'status':'execution-proof-unresolved','shape':list(shape),
                                     'error':str(error),'stop_rule':'Preserve exact source/trace for bounded review; no new tiles, changed math or automatic retry'})
                    raise
                except Exception as error:
                    experiment.save({'status':'backend-failed','shape':list(shape),'error':f'{type(error).__name__}: {error}',
                                     'stop_rule':'Do not retry unsupported/resource/timeout backend'})
                    ready=False;break
            if ready and surviving:
                # Integrate only exact, faster shapes. All other scaled-mm calls
                # retain original ATen lowering; no other op is autotuned.
                compile_log=[]
                candidate_transformer=torch.compile(eager_transformer,
                    backend=isolated_backend(experiment,set(surviving),compile_log),fullgraph=False,dynamic=False)
                def select(variant):
                    pipe.transformer=compiled_transformer if variant=='baseline' else candidate_transformer
                for width,height in parse_sizes(args.sizes):
                    raw=experiment.make_input(width,height,0)
                    counts=pipeline_shape_counts(experiment,eager_transformer,raw,width,height)
                    expected={shape:counts[shape]*3 for shape in surviving if counts[shape]}
                    experiment.save({'status':'pipeline-shape-counts','size':[width,height],
                                     'selected_calls_per_frame':[{'shape':list(shape),'count':count//3} for shape,count in expected.items()],
                                     'scope':'Untimed eager original transformer; runtime proof separately required'})
                    if not expected:
                        experiment.save({'status':'pipeline-not-applicable','size':[width,height],
                                         'reason':'No surviving exact matrix shape occurs; do not measure an unchanged candidate as a speedup'})
                        continue
                    with deadline(args.compile_timeout,f'N03 selected-shape transformer {width}x{height}'):
                        select('baseline')
                        for _ in range(4):experiment.run(raw,width,height)
                        with track_candidate_source_loads() as source_loads:
                            select('candidate')
                            for _ in range(4):experiment.run(raw,width,height)
                            tag=f'pipeline-{width}x{height}'
                            trace=trace_kernels(experiment,lambda:experiment.run(raw,width,height),args.output/f'{tag}-candidate.json.gz')
                            sources,source_errors=archive_generated_sources(source_loads,args.output,tag)
                    proof=prove_template_execution(sources,trace,expected,compile_log,set(surviving),source_errors=source_errors)
                    experiment.save({'status':'pipeline-template-proof','size':[width,height],'proof':proof})
                    if proof['status']!='passed':
                        experiment.save({'status':'execution-proof-unresolved','size':[width,height],
                                         'stop_rule':'Preserve exact source/trace for bounded review; a fused quantization prologue is not automatically a kernel or numerical failure'})
                        raise ExecutionProofUnresolved('Full pipeline template source/runtime proof unresolved; no automatic backend retry')
                    if not experiment.quality(select,'triton-selected-shapes',width,height):
                        experiment.save({'status':'rejected-quality','candidate':'triton-selected-shapes','size':[width,height]});break
                    if not experiment.measure_pairs(select,'triton-selected-shapes',width,height):
                        break
                select('baseline')
                experiment.save({'status':'pipeline-compiler-choices','choices':compile_log})
            else:
                experiment.save({'status':'pipeline-not-advanced','reason':'No exact repeatably faster compatible micro candidate, or backend stopped'})
        experiment.finish()
    except Exception as error:
        if experiment is not None:experiment.finish('execution-proof-unresolved' if isinstance(error,ExecutionProofUnresolved) else 'failed',error)
        raise


if __name__=='__main__':main()
