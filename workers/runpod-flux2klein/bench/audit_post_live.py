#!/usr/bin/env python3
"""Read-only input audit and interpretation of the frozen post-live probe.

Writes a separate audit JSON. Never contacts the pod or modifies measured data.
Kernel durations are diagnostic activity, not end-to-end FPS. Nested host ranges
are reported separately and must not be summed with their child ranges.
"""
import argparse
from collections import Counter, defaultdict
import gzip
import hashlib
import json
import math
from pathlib import Path
import statistics

SIZES = [(512,288),(768,448),(1024,576)]
DEFAULT_FROZEN = Path(__file__).resolve().parents[3]/'docs/performance/2026-09-17/post-live-frozen-sources'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def percentile(values, percent):
    values=sorted(values);position=(len(values)-1)*percent/100
    lo=math.floor(position);hi=math.ceil(position)
    return values[lo]+(values[hi]-values[lo])*(position-lo)


def near(left,right):
    return math.isclose(left,right,rel_tol=1e-9,abs_tol=1e-8)


def interval_union_us(events):
    intervals=sorted((event['ts'],event['ts']+event['dur']) for event in events)
    if not intervals:return 0.0
    start,end=intervals[0];total=0.0
    for a,b in intervals[1:]:
        if a<=end:end=max(end,b)
        else:total+=end-start;start,end=a,b
    return total+end-start


def kernel_category(name):
    lower=name.lower()
    if ('gemm' in lower or 'mma' in lower) and any(x in lower for x in ['e4m3','e5m2','fp8']):
        return 'explicitly_named_fp8_gemm'
    if any(x in lower for x in ['flash_fwd','flash_bwd','fmha','flashattn']):
        return 'explicitly_named_attention'
    if 'cudnn' in lower:return 'cudnn_named'
    if 'triton' in lower:return 'other_triton_named'
    return 'other_or_unclassified'


def profile_report(path, errors, warnings):
    with gzip.open(path,'rt') as stream:trace=json.load(stream)
    events=[event for event in trace.get('traceEvents',[]) if event.get('ph')=='X'
            and isinstance(event.get('dur'),(int,float)) and event['dur']>=0]
    kernels=[event for event in events if event.get('cat')=='kernel']
    if not kernels:errors.append(path.name+': no actual CUDA kernel events')
    names=defaultdict(lambda:{'count':0,'duration_us':0.0})
    category=defaultdict(lambda:{'count':0,'duration_us':0.0})
    for event in kernels:
        name=event['name'];names[name]['count']+=1;names[name]['duration_us']+=event['dur']
        group=kernel_category(name);category[group]['count']+=1;category[group]['duration_us']+=event['dur']
    total=sum(event['dur'] for event in kernels)
    for value in category.values():value['share_of_summed_kernel_duration_pct']=100*value['duration_us']/total if total else None
    host=defaultdict(list);gpu_ranges=defaultdict(list)
    for event in events:
        if event.get('name','').startswith('vj0/'):
            if event.get('cat')=='user_annotation':host[event['name']].append(event['dur'])
            elif event.get('cat')=='gpu_user_annotation':gpu_ranges[event['name']].append(event['dur'])
    host_rows={name:{'count':len(values),'inclusive_total_ms':sum(values)/1000,
                     'inclusive_mean_ms':statistics.fmean(values)/1000,
                     'inclusive_p95_ms':percentile(values,95)/1000} for name,values in host.items()}
    if len(host.get('vj0/frame',[]))!=20:errors.append(path.name+': expected 20 frame ranges')
    if len(host.get('vj0/transformer',[]))!=20:errors.append(path.name+': expected 20 transformer ranges for one actual model evaluation/frame')
    compilation=[event for event in events if any(x in event.get('name','') for x in
                 ['_compile.compile_inner','compile_fx_inner','GraphLowering.run','GraphLowering.compile_to_module'])]
    if compilation:warnings.append(path.name+': compilation events overlap profile; interpret diagnostic attribution cautiously')
    copies=defaultdict(lambda:{'count':0,'duration_us':0.0})
    for event in events:
        if event.get('cat') in ['gpu_memcpy','gpu_memset']:
            copies[event['name']]['count']+=1;copies[event['name']]['duration_us']+=event['dur']
    runtime=Counter(event.get('name') for event in events if event.get('cat')=='cuda_runtime'
                    and any(x in event.get('name','') for x in ['GraphLaunch','Synchronize']))
    top=sorted(({'name':name,**value,'share_of_summed_kernel_duration_pct':100*value['duration_us']/total if total else None}
                for name,value in names.items()),key=lambda row:row['duration_us'],reverse=True)[:30]
    operators_path=path.with_name(path.name.removesuffix('.json.gz')+'-operators.json')
    cpu_operators=[]
    if operators_path.is_file():
        operators=json.loads(operators_path.read_text())
        cpu_operators=sorted(({'name':row['key'],'count':row['count'],
            'self_host_total_ms':row['self_cpu_time_total_us']/1000,
            'self_host_ms_per_frame':row['self_cpu_time_total_us']/20000}
            for row in operators if row.get('self_cpu_time_total_us',0)>0),
            key=lambda row:row['self_host_total_ms'],reverse=True)[:30]
    else:
        errors.append('Missing exclusive host operator report '+str(operators_path))
    return {'trace_sha256':sha(path),'kernel_events':len(kernels),'summed_kernel_duration_ms':total/1000,
            'kernel_active_union_ms':interval_union_us(kernels)/1000,
            'kernel_categories':dict(category),'top_kernels':top,'host_ranges':host_rows,
            'gpu_annotation_ranges':{name:{'count':len(values),'inclusive_total_ms':sum(values)/1000,
                'inclusive_mean_ms':statistics.fmean(values)/1000} for name,values in gpu_ranges.items()},
            'compiled_graph_call_counts':dict(Counter(event['name'] for event in events
                if event.get('name','').startswith('## Call CompiledFxGraph'))),
            'copy_activity':dict(copies),'cuda_runtime_counts':dict(runtime),
            'top_exclusive_host_operators':cpu_operators,
            'compilation_event_names':sorted({event['name'] for event in compilation}),
            'interpretation_limits':['CPU user_annotation and GPU gpu_user_annotation ranges are separated; both are inclusive/nested and must not be added across parent/child ranges or devices.',
                'Kernel shares use only kernel events, never compiled-wrapper rows. Category matching is conservative name-based attribution.',
                'Exclusive host operator durations are wall time, not per-thread CPU cycles. Synchronization and pageable transfer calls can wait for earlier GPU work; they do not establish the cause of CPU quota throttling.',
                'The host output-conversion range includes waiting for the asynchronous decoder. Use GPU copy activity and the separate GPU annotation to assess the actual conversion/copy work.',
                'GPU kernel/copy durations are not end-to-end latency or throughput. Profiling is untimed diagnostic evidence.']}


def audit(root, frozen_sources=DEFAULT_FROZEN):
    result_path=root/'result.json'
    if result_path.exists():
        result_bytes=result_path.read_bytes()
    else:
        result_path=root/'result.json.gz'
        result_bytes=gzip.decompress(result_path.read_bytes())
    result=json.loads(result_bytes);errors=[];warnings=[]
    records=result.get('records',[]);counts=Counter(row.get('status') for row in records)
    out={'status':'running','input_directory':str(root),'result_sha256':hashlib.sha256(result_bytes).hexdigest(),
         'record_counts':dict(counts),'errors':errors,'warnings':warnings,'compute':[],'profiles':{},
         'audit_notes':['The initial checker counted both CPU user_annotation and GPU gpu_user_annotation records as host ranges. The corrected checker separates these categories: each trace has 20 CPU transformer calls and 20 corresponding GPU annotations. Measured data was not changed.'],
         'quality_scope':{'prompt':'colorful abstract art, vibrant neon lights, psychedelic patterns',
                          'alpha':0.1,'seed':42,'phases':3,'steps':[2,3,4],'sizes':[list(s) for s in SIZES]},
         'measurement_scope':'Offline JPEG85 input/JPEG80 output, VAE/inference/output conversion and CUDA completion; excludes IPC, WebRTC, browser and physical display.'}
    if result.get('status')!='complete':errors.append('Post-probe result is not complete')
    if result.get('initial_torch_threads')!=128:errors.append('Native initial thread count is not128')
    if result.get('jpeg_input_quality')!=85 or result.get('jpeg_output_quality')!=80:errors.append('Unexpected JPEG settings')
    sources=json.loads((frozen_sources/'sources.json').read_text())
    for name,expected_hash in sources.items():
        source_path=frozen_sources/name
        if not source_path.is_file() or sha(source_path)!=expected_hash:
            errors.append('Frozen source contents do not match manifest: '+name)
    mapping={'worker':'inference_server.py','runtime':'worker_runtime.py','terminal_helper':'bench/terminal_noop.py',
             'gpu_cast_helper':'bench/gpu_output_cast.py','probe':'bench/bench_post_live.py',
             'cpu_diagnostics':'bench/bench_terminal_followup.py'}
    for key,name in mapping.items():
        if result.get('source_sha256',{}).get(key)!=sources[name]:errors.append('Unexpected executed source hash: '+key)
    boot=[row for row in records if row.get('status')=='boot-proof']
    if len(boot)!=1 or any(boot[0].get(key)!=expected for key,expected in
                          [('torch_threads',128),('terminal_noop_enabled',True),('gpu_output_cast_enabled',True)]):
        errors.append('Missing or invalid production boot proof')
    quality=[row for row in records if row.get('status')=='quality']
    expected={(size,steps,phase) for size in SIZES for steps in [2,3,4] for phase in range(3)}
    observed=Counter((tuple(row['size']),row['steps'],row['phase']) for row in quality)
    if set(observed)!=expected or any(count!=1 for count in observed.values()):errors.append('Quality matrix incomplete or duplicated')
    checks=0
    for row in quality:
        label=f"quality {row['size']} steps{row['steps']} phase{row['phase']}"
        if not row.get('original_terminal_and_gpu_cast_pixels_jpeg_exact') or not row.get('global_rng_unchanged'):
            errors.append(label+': output/RNG gate failed')
        if row.get('torch_threads')!=128 or row.get('skip_counts')!=[0,1,1,0]:errors.append(label+': thread or skip gate failed')
        same_tensor=row.get('output_cast_checks',[]);checks+=len(same_tensor)
        if len(same_tensor)!=2 or not all(check.get('cpu_gpu_cast_exact') and check.get('finite') for check in same_tensor):
            errors.append(label+': same-tensor CPU/GPU conversion gate failed')
    out['quality_fixtures']=len(quality);out['same_tensor_cast_checks']=checks
    for size in SIZES:
        for phase in range(3):
            a=root/f'{size[0]}x{size[1]}-phase{phase}-baseline.png';b=root/f'{size[0]}x{size[1]}-phase{phase}-optimized.png'
            if not a.exists() or not b.exists():errors.append(f'Missing saved image pair {size} phase{phase}')
            elif a.read_bytes()!=b.read_bytes():errors.append(f'Saved PNG bytes differ {size} phase{phase}')
    measured=[row for row in records if row.get('status')=='compute-measured']
    for size in SIZES:
        group=[row for row in measured if row['size']==list(size)]
        keys=Counter((row['pair'],row['variant']) for row in group)
        if set(keys)!={(pair,variant) for pair in range(3) for variant in ['baseline','optimized']} or any(n!=1 for n in keys.values()):
            errors.append(f'Timing matrix incomplete/duplicate at {size}');continue
        summary={'size':list(size),'variants':{},'paired_improvement_pct':[]}
        for row in group:
            label=f"timing {size} {row['variant']} pair{row['pair']}"
            frames=row.get('frame_ms',[]);optimized=row['variant']=='optimized'
            if row.get('frames')!=100 or len(frames)!=100:errors.append(label+': frame count not100')
            if not all(math.isfinite(x) and x>=0 for x in frames):errors.append(label+': invalid duration')
            if row.get('torch_threads')!=128 or row.get('timing_reference_checks')!=0:errors.append(label+': thread/reference-work gate failed')
            if row.get('terminal_skips')!=(100 if optimized else 0) or row.get('selected_gpu_cast_calls')!=(100 if optimized else 0):
                errors.append(label+': actual skip/conversion call count incorrect')
            if row.get('cast')!=('gpu' if optimized else 'cpu'):errors.append(label+': wrong conversion')
            if row['wall_seconds']<=0 or not near(row['fps'],100/row['wall_seconds']):errors.append(label+': FPS arithmetic mismatch')
            if frames:
                distribution={'mean':statistics.fmean(frames),'p50':percentile(frames,50),'p95':percentile(frames,95),'p99':percentile(frames,99),'min':min(frames),'max':max(frames)}
                if any(not near(value,row['timing_ms'][key]) for key,value in distribution.items()):errors.append(label+': percentile arithmetic mismatch')
                if sum(frames)>row['wall_seconds']*1000+0.001:errors.append(label+': frame times exceed wall interval')
        for variant in ['baseline','optimized']:
            rows=sorted((row for row in group if row['variant']==variant),key=lambda row:row['pair'])
            summary['variants'][variant]={'fps_trials':[row['fps'] for row in rows],
                'median_fps':statistics.median(row['fps'] for row in rows),
                'median_trial_p50_ms':statistics.median(row['timing_ms']['p50'] for row in rows),
                'median_trial_p95_ms':statistics.median(row['timing_ms']['p95'] for row in rows),
                'worst_frame_ms':max(max(row['frame_ms']) for row in rows),
                'throttled_periods':[row['cpu']['delta'].get('cgroup_stat',{}).get('nr_throttled') for row in rows],
                'average_cpu_cores':[row['cpu']['delta']['average_process_cpu_cores'] for row in rows]}
        for pair in range(3):
            paired={row['variant']:row for row in group if row['pair']==pair}
            summary['paired_improvement_pct'].append(100*(paired['optimized']['fps']/paired['baseline']['fps']-1))
        summary['median_fps_improvement_pct']=100*(summary['variants']['optimized']['median_fps']/summary['variants']['baseline']['median_fps']-1)
        out['compute'].append(summary)
    if len(measured)!=18:errors.append('Expected18 compute timing cells')
    for row in [row for row in records if row.get('status')=='profile']:
        size=tuple(row['size']);path=root/row['trace']
        if row.get('frames')!=20 or row.get('torch_threads')!=128 or row.get('output_cast')!='gpu' or row.get('terminal_noop') is not True:
            errors.append(f'Unexpected profile settings {size}')
        if row.get('wrapped_warmup_skip_counts')!=[1,1,1,1] or row.get('profiled_quality_frames_exact')!=3:
            errors.append(f'Profile wrapper warmup/output gate failed {size}')
        if not path.is_file():errors.append('Missing trace '+str(path));continue
        out['profiles'][f'{size[0]}x{size[1]}']=profile_report(path,errors,warnings)
    if set(out['profiles'])!={'512x288','1024x576'}:errors.append('Expected both requested CUDA profiles')
    out['status']='passed' if not errors else 'failed'
    return out


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--frozen-sources',type=Path,default=DEFAULT_FROZEN)
    args=parser.parse_args()
    result=audit(args.input,args.frozen_sources)
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'status':result['status'],'errors':result['errors'],'warnings':result['warnings'],
                      'quality_fixtures':result['quality_fixtures'],'same_tensor_cast_checks':result['same_tensor_cast_checks'],
                      'compute':result['compute'],'output':str(args.output)},indent=2))
    return 0 if result['status']=='passed' else 1


if __name__=='__main__':raise SystemExit(main())
