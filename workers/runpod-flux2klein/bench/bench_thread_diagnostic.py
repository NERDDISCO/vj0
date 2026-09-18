#!/usr/bin/env python3
"""Native-thread output-cast A/B, then staged 128->4->128 quality diagnosis.

One loaded original worker. All pixel/stage arrays are retained. Timed native
cast pairs precede thread specialization changes; callbacks are quality-only.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import time

from bench_terminal_followup import cpu_snapshot, cpu_delta
from gpu_output_cast import GPUOutputCastProbe
from metrics import distribution
from terminal_noop import install


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--worker-script', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--frames', type=int, default=150)
    a = p.parse_args()
    if a.output.exists(): p.error('New output directory required')
    a.output.mkdir(parents=True)
    import numpy as np
    import torch
    from PIL import Image, ImageDraw
    spec = importlib.util.spec_from_file_location('vj0_thread_diagnostic_worker', a.worker_script)
    worker = importlib.util.module_from_spec(spec); spec.loader.exec_module(worker)
    manifest = {'status':'running','started_utc':datetime.now(timezone.utc).isoformat(),
        'worker_sha256':hashlib.sha256(a.worker_script.read_bytes()).hexdigest(),
        'probe_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'records':[], 'boundary':'input JPEG85 decode, VAE, generation/decode, output JPEG80, CUDA sync; no IPC/network/browser'}
    def save(row=None):
        if row is not None:
            manifest['records'].append(row)
            with (a.output/'records.jsonl').open('a') as f: f.write(json.dumps(row)+'\n')
            print(json.dumps({k:v for k,v in row.items() if k not in ['frame_ms','cpu']}),flush=True)
        q=a.output/'result.json.tmp';q.write_text(json.dumps(manifest,indent=2)+'\n');q.replace(a.output/'result.json')
    save()
    try:
        pipe=worker.setup_pipeline();install(pipe)
        assert torch.get_num_threads()==128, 'Expected untouched native128 setup'
        cast=GPUOutputCastProbe(pipe.image_processor,np);original_cast=cast.original
        embeds=worker.PromptCache(pipe).get('colorful abstract art, vibrant neon lights, psychedelic patterns')
        w,h=512,288
        inputs=[]
        for phase in range(max(3,a.frames)):
            img=Image.new('RGB',(w,h),(10,10,10));draw=ImageDraw.Draw(img);xs=np.arange(w)
            ys=h*(.5+.24*np.sin(xs/w*4*np.pi+phase*.25)+.07*np.sin(xs/w*19*np.pi-phase*.17))
            draw.line(list(zip(xs.tolist(),ys.tolist())),fill='white',width=max(2,w//128))
            if phase%3==2: draw.rectangle((w//5,h//5,w//3,h//3),fill=(40,200,255))
            b=io.BytesIO();img.save(b,format='JPEG',quality=85);inputs.append(b.getvalue())
        manifest['input_sha256']=[hashlib.sha256(x).hexdigest() for x in inputs[:3]]
        def select(gpu,compare=False):
            cast.compare_enabled=compare;pipe.image_processor.pt_to_numpy=cast.convert if gpu else original_cast
        def run(raw):
            before=pipe._vj0_terminal_skips
            lat=worker.encode_image_to_latents(pipe,worker.bytes_to_pil(raw,w,h),w,h)
            out=worker.generate(pipe,lat,embeds,.1,2,h,w,42)
            jpg=worker.pil_to_jpeg_bytes(out,80);torch.cuda.synchronize()
            return out,jpg,pipe._vj0_terminal_skips-before
        with torch.no_grad():
            for enabled in [False,True]:
                pipe._vj0_skip_terminal_enabled=enabled
                for gpu in [False,True]:
                    select(gpu)
                    for _ in range(6):run(inputs[0])
            for phase in range(3):
                outputs=[];counts=[];rng=[]
                for enabled,gpu in [(False,False),(True,False),(True,True)]:
                    pipe._vj0_skip_terminal_enabled=enabled;select(gpu,compare=gpu)
                    cpu=torch.random.get_rng_state().clone();cuda=torch.cuda.get_rng_state().clone()
                    out,jpg,count=run(inputs[phase]);outputs.append((np.asarray(out).copy(),jpg));counts.append(count)
                    rng.append(bool(torch.equal(cpu,torch.random.get_rng_state()) and torch.equal(cuda,torch.cuda.get_rng_state())))
                    out.save(a.output/f'native128-phase{phase}-terminal{int(enabled)}-gpu{int(gpu)}.png')
                exact=all(np.array_equal(outputs[0][0],x[0]) and outputs[0][1]==x[1] for x in outputs[1:])
                save({'status':'native-quality','phase':phase,'pixels_jpeg_exact':exact,'skip_counts':counts,'rng_unchanged':all(rng)})
                assert exact and counts==[0,1,1] and all(rng)
            pipe._vj0_skip_terminal_enabled=True
            for repeat in range(3):
                for gpu in ([False,True] if repeat%2==0 else [True,False]):
                    select(gpu)
                    for _ in range(8):run(inputs[0])
                    before_checks=len(cast.comparisons);before_calls=cast.unchecked_calls
                    before=cpu_snapshot();durations=[];start=time.perf_counter()
                    for raw in inputs[:a.frames]:
                        t=time.perf_counter();_,_,count=run(raw);durations.append((time.perf_counter()-t)*1000);assert count==1
                    elapsed=time.perf_counter()-start;after=cpu_snapshot()
                    assert len(cast.comparisons)==before_checks
                    assert cast.unchecked_calls-before_calls==(a.frames if gpu else 0)
                    save({'status':'native-cast-measured','cast':'gpu' if gpu else 'cpu','threads':128,'repeat':repeat,
                        'frames':a.frames,'fps':a.frames/elapsed,'wall_seconds':elapsed,'timing_ms':distribution(durations),
                        'frame_ms':durations,'cpu':cpu_delta(before,after,elapsed)})
            select(False);pipe._vj0_skip_terminal_enabled=False
            reference={}
            def array(t):return t.detach().float().cpu().numpy().copy()
            def delta(old,new):
                diff=new.astype(np.float64)-old.astype(np.float64);mse=float(np.mean(diff*diff))
                return {'exact':bool(np.array_equal(old,new)),'mse':mse,'max_abs':float(np.max(np.abs(diff))),
                    'changed_fraction':float(np.mean(diff!=0)),'psnr_255_db':None if mse==0 else float(10*np.log10(255**2/mse))}
            for label,threads in [('native-first',128),('four',4),('native-return',128)]:
                torch.set_num_threads(threads)
                for _ in range(6):run(inputs[0])
                for repeat in range(2):
                    for phase in range(3):
                        cpu=torch.random.get_rng_state().clone();cuda=torch.cuda.get_rng_state().clone()
                        lat=worker.encode_image_to_latents(pipe,worker.bytes_to_pil(inputs[phase],w,h),w,h)
                        noise=torch.randn(lat.shape,generator=torch.Generator(device='cuda').manual_seed(42),dtype=lat.dtype,device='cuda')
                        blended=.1*lat+.9*noise
                        stages={'encoded':array(lat),'noise':array(noise),'blended':array(blended)}
                        def callback(_p,index,timestep,kwargs):
                            stages[f'step{index}']=array(kwargs['latents']);return kwargs
                        traced=pipe(image=None,prompt=None,prompt_embeds=embeds,latents=blended,
                            sigmas=np.linspace(.9,0.,2).tolist(),height=h,width=w,num_inference_steps=2,
                            generator=torch.Generator(device='cuda').manual_seed(42),callback_on_step_end=callback,
                            callback_on_step_end_tensor_inputs=['latents']).images[0]
                        actual,_,_=run(inputs[phase])
                        stages['pixels']=np.asarray(actual).copy()
                        assert np.array_equal(stages['pixels'],np.asarray(traced))
                        assert torch.equal(cpu,torch.random.get_rng_state()) and torch.equal(cuda,torch.cuda.get_rng_state())
                        assert all(np.isfinite(x).all() for x in stages.values())
                        name=f'{label}-r{repeat}-phase{phase}'
                        actual.save(a.output/(name+'.png'));np.savez_compressed(a.output/(name+'.npz'),**stages)
                        if label=='native-first' and repeat==0:reference[phase]={k:v.copy() for k,v in stages.items()}
                        comparison={k:delta(reference[phase][k],v) for k,v in stages.items()}
                        save({'status':'thread-quality','label':label,'threads':threads,'repeat':repeat,'phase':phase,
                              'relative_to':'native-first-r0-same-phase','stages':comparison})
            manifest['output_cast_checks']=cast.comparisons
        manifest['status']='complete'
    except BaseException as error:
        manifest.update(status='failed',error=str(error));raise
    finally:
        manifest['finished_utc']=datetime.now(timezone.utc).isoformat();save()


if __name__=='__main__':main()
