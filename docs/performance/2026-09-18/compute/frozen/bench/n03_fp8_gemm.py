#!/usr/bin/env python3
"""SM120-only, same-input FP8 GEMM microbenchmark and gated pipeline follow-up.

Capture real model operands, rank two shape families by CUDA event activity,
then allow only two generic Triton mm tiles. No TMA/CuTe/SM100 template and no
whole-model autotuning. A numerical failure is evidence, never a promotion.
"""
import argparse
from collections import defaultdict
from contextlib import contextmanager
import gzip
import json
from pathlib import Path
import statistics
import time

from n03n04_common import Experiment, add_common_arguments, deadline, parse_sizes, sha

SAFE_TILES = {(64,128,64,4,4),(128,64,64,4,4)}


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
    names=sorted({event['name'] for event in trace['traceEvents'] if event.get('cat')=='kernel'})
    return names


def main():
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
        experiment.save({'status':'backend-contract','backend':'generic Inductor Triton scaled-mm',
                         'safe_tiles':[list(item) for item in sorted(SAFE_TILES)],
                         'excluded':'TMA, CuTeDSL, CUTLASS whole-model autotuning',
                         'shared_memory_operand_estimate_max_bytes':49152,
                         'sources':{mm_source.__file__:sha(mm_source.__file__),choice_source.__file__:sha(choice_source.__file__)}})
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
                        for _ in range(4):baseline(*values);candidate(*values)
                        torch.cuda.synchronize()
                    reference=baseline(*values).clone();torch.cuda.synchronize()
                    actual=candidate(*values).clone();torch.cuda.synchronize()
                    comparison=experiment.compare_array(reference.float().cpu().numpy(),actual.float().cpu().numpy())
                    kernels={}
                    for name,call in [('baseline',baseline),('candidate',candidate)]:
                        kernels[name]=trace_kernels(experiment,lambda:call(*values),args.output/f'micro-{index}-{name}.json.gz')
                    executed=any('triton' in name.lower() for name in kernels['candidate'])
                    assert executed,'Candidate did not execute a Triton kernel'
                    experiment.save({'status':'micro-quality','shape':list(shape),'comparison':comparison,
                                     'compile_seconds':time.perf_counter()-started,'kernel_names':kernels,
                                     'bounded_choices':compile_log,'actual_triton_execution':executed})
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
                    with deadline(args.compile_timeout,f'N03 selected-shape transformer {width}x{height}'):
                        for variant in ['baseline','candidate']:
                            select(variant)
                            for _ in range(4):experiment.run(experiment.make_input(width,height,0),width,height)
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
        if experiment is not None:experiment.finish('failed',error)
        raise


if __name__=='__main__':main()
