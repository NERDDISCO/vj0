"""Shared isolated N03/N04 quality and timing utilities; no production patches."""
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import gzip
import importlib.metadata
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import statistics

from metrics import distribution, parse_sizes
from bench_terminal_followup import cpu_snapshot, cpu_delta

PROMPT = 'colorful abstract art, vibrant neon lights, psychedelic patterns'


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


@contextmanager
def deadline(seconds, label):
    def timeout(*_):
        raise TimeoutError(f'{label} exceeded {seconds} seconds; bounded experiment stopped')
    old = signal.signal(signal.SIGALRM, timeout)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, old)


class Experiment:
    def __init__(self, args, name):
        if args.output.exists():
            raise RuntimeError('Refusing to overwrite existing results')
        active = subprocess.check_output(['nvidia-smi', '--query-compute-apps=pid,process_name',
                                          '--format=csv,noheader'], text=True).strip()
        if active:
            raise RuntimeError('GPU not idle; leave experiment queued: ' + active)
        args.output.mkdir(parents=True)
        self.args = args
        self.records = []
        self.data = {'status': 'running', 'experiment': name, 'started_utc': self.now(),
                     'arguments': {key: str(value) if isinstance(value, Path) else value
                                   for key, value in vars(args).items()}, 'records': self.records,
                     'input_jpeg_quality': 85, 'output_jpeg_quality': 80,
                     'timing_boundary': 'JPEG decode, original worker VAE encode/generate, JPEG encode, CUDA completion; excludes IPC and transport'}
        self.save()
        os.environ.pop('TORCH_NUM_THREADS', None)
        os.environ['USE_TERMINAL_NOOP'] = '1'
        os.environ['USE_GPU_OUTPUT_CAST'] = '1'
        import numpy as np
        import torch
        self.np, self.torch = np, torch
        self.native_threads = torch.get_num_threads()
        assert self.native_threads == args.expected_native_threads
        assert torch.cuda.get_device_capability(0) == (12, 0), 'This bounded candidate is SM120 only'
        spec = importlib.util.spec_from_file_location('vj0_' + name, args.worker_script.resolve())
        self.worker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.worker)
        self.data.update(gpu=torch.cuda.get_device_name(0), torch_threads=self.native_threads,
                         versions={key: importlib.metadata.version(key) for key in ['torch','torchao','diffusers','numpy','pillow']},
                         sources={str(path): sha(path) for path in [Path(__file__), Path(args.worker_script),
                                  Path(args.worker_script).with_name('worker_runtime.py'), Path(args.probe)]})
        for relative in ['bench/terminal_noop.py','bench/gpu_output_cast.py','bench/metrics.py','bench/bench_terminal_followup.py']:
            path=Path(args.worker_script).parent/relative
            self.data['sources'][relative]=sha(path)
        self.save()
        self.pipe = self.worker.setup_pipeline()
        assert self.pipe._vj0_skip_terminal_enabled and self.pipe._vj0_gpu_output_cast_enabled
        assert torch.get_num_threads() == self.native_threads
        self.embeds = self.worker.PromptCache(self.pipe).get(PROMPT)
        self.data['model'] = {'model': self.worker.KLEIN_REPO, 'decoder': self.worker.DECODER_REPO,
                              'vae_fp8': self.worker.USE_VAE_FP8, 'compile_mode': self.worker.COMPILE_MODE,
                              'prompt': PROMPT, 'alpha': .1, 'seed': 42}
        cache=Path(os.environ.get('HF_HUB_CACHE',str(Path(os.environ.get('HF_HOME',str(Path.home()/'.cache/huggingface')))/'hub')))
        self.data['cached_model_provenance']={}
        for model in [self.worker.KLEIN_REPO,self.worker.DECODER_REPO]:
            folder=cache/('models--'+model.replace('/','--'))
            refs={str(path.relative_to(folder)):path.read_text().strip() for path in (folder/'refs').rglob('*') if path.is_file()}
            weight_blobs={str(path.relative_to(folder)):path.resolve().name for path in (folder/'snapshots').rglob('*.safetensors')}
            self.data['cached_model_provenance'][model]={'refs':refs,'weight_blob_identifiers':weight_blobs}
        self.save()

    @staticmethod
    def now():
        return datetime.now(timezone.utc).isoformat()

    def save(self, row=None):
        if row is not None:
            self.records.append(row)
            with (self.args.output/'records.jsonl').open('a') as stream:
                stream.write(json.dumps(row) + '\n')
            print(json.dumps({k:v for k,v in row.items() if k not in ('frame_ms','stage_comparisons')}), flush=True)
        temporary = self.args.output/'result.json.tmp'
        temporary.write_text(json.dumps(self.data, indent=2)+'\n')
        temporary.replace(self.args.output/'result.json')

    def finish(self, status='complete', error=None):
        self.data.update(status=status, finished_utc=self.now())
        if error is not None:
            self.data['error'] = f'{type(error).__name__}: {error}'
        self.save()

    def make_input(self, width, height, phase):
        from PIL import Image, ImageDraw
        image = Image.new('RGB', (width,height), (10,10,10))
        xs = self.np.arange(width)
        ys = height*(.5+.24*self.np.sin(xs/width*4*self.np.pi+phase*.25)
                     +.07*self.np.sin(xs/width*19*self.np.pi-phase*.17))
        draw = ImageDraw.Draw(image)
        draw.line(list(zip(xs.tolist(),ys.tolist())), fill='white', width=max(2,width//128))
        if phase % 3 == 2:
            draw.rectangle((width//5,height//5,width//3,height//3),fill=(40,200,255))
        stream = io.BytesIO();image.save(stream,format='JPEG',quality=85)
        return stream.getvalue()

    def run(self, raw, width, height, steps=2, capture=False):
        torch = self.torch
        assert torch.get_num_threads() == self.native_threads
        stages = {}
        before = self.pipe._vj0_terminal_skips
        image = self.worker.bytes_to_pil(raw,width,height)
        latents = self.worker.encode_image_to_latents(self.pipe,image,width,height)
        if capture:
            stages['encoded_latents'] = latents.detach().float().cpu().numpy().copy()
        original_decode = self.pipe.vae.decode
        if capture:
            def decode_with_snapshot(z, *args, **kwargs):
                stages['decoder_input_latents'] = z.detach().float().cpu().numpy().copy()
                decoded = original_decode(z,*args,**kwargs)
                value = decoded[0] if isinstance(decoded,tuple) else decoded.sample
                stages['decoder_output'] = value.detach().float().cpu().numpy().copy()
                return decoded
            self.pipe.vae.decode = decode_with_snapshot
        try:
            output = self.worker.generate(self.pipe,latents,self.embeds,.1,steps,height,width,42)
        finally:
            if capture:
                self.pipe.vae.decode = original_decode
        jpeg = self.worker.pil_to_jpeg_bytes(output,80)
        torch.cuda.synchronize()
        assert self.pipe._vj0_terminal_skips-before == 1
        return output,jpeg,stages

    def compare_array(self, reference, candidate):
        np = self.np
        exact = np.array_equal(reference,candidate) and reference.tobytes()==candidate.tobytes()
        delta = reference.astype(np.float64)-candidate.astype(np.float64)
        return {'exact': bool(exact), 'shape': list(reference.shape),
                'mse': float(np.mean(delta*delta)), 'max_abs_error': float(np.max(np.abs(delta))),
                'fraction_changed': float(np.mean(reference != candidate)),
                'finite': bool(np.isfinite(reference).all() and np.isfinite(candidate).all())}

    def quality(self, select, candidate_name, width, height, steps=(2,3,4)):
        """Compare traced stages and the actual uninstrumented timed worker path."""
        torch,np = self.torch,self.np
        passed = True
        for count in steps:
            for phase in range(3):
                results=[];rng=[]
                for variant,capture in [('baseline',True),('candidate',True),('baseline',False),('candidate',False)]:
                    select(variant)
                    cpu_rng=torch.random.get_rng_state().clone();gpu_rng=torch.cuda.get_rng_state().clone()
                    result=self.run(self.make_input(width,height,phase),width,height,count,capture)
                    rng.append(bool(torch.equal(cpu_rng,torch.random.get_rng_state()) and torch.equal(gpu_rng,torch.cuda.get_rng_state())))
                    results.append(result)
                stage_checks={key:self.compare_array(results[0][2][key],results[1][2][key]) for key in results[0][2]}
                pixel_checks=[self.compare_array(np.asarray(results[0][0]),np.asarray(item[0])) for item in results[1:]]
                jpeg_exact=all(results[0][1]==item[1] for item in results[1:])
                exact=all(item['exact'] and item['finite'] for item in stage_checks.values()) and all(item['exact'] for item in pixel_checks) and jpeg_exact and all(rng)
                prefix=f'{candidate_name}-{width}x{height}-steps{count}-phase{phase}'
                # Every phase remains available, including failed quality candidates.
                for index,label in [(0,'baseline'),(1,'candidate')]:
                    results[index][0].save(self.args.output/f'{prefix}-{label}.png')
                    np.savez_compressed(self.args.output/f'{prefix}-{label}-stages.npz',**results[index][2])
                self.save({'status':'quality','candidate':candidate_name,'size':[width,height],
                           'steps':count,'phase':phase,'exact':exact,'global_rng_unchanged':all(rng),
                           'stage_comparisons':stage_checks,'pixel_comparisons':pixel_checks,
                           'all_jpeg_exact':jpeg_exact,'traced_and_untraced_paths':True})
                passed &= exact
            # A failed 2-step fixture rejects this variant before extra step counts/timing.
            if not passed:
                break
        return passed

    def measure_pairs(self, select, candidate_name, width, height):
        torch = self.torch
        inputs=[self.make_input(width,height,phase) for phase in range(self.args.frames)]
        for pair in range(self.args.pairs):
            for variant in (['baseline','candidate'] if pair%2==0 else ['candidate','baseline']):
                select(variant)
                for _ in range(4):self.run(inputs[0],width,height)
                durations=[];cpu_before=cpu_snapshot()
                before_cast=self.pipe._vj0_gpu_output_cast_probe.unchecked_calls
                start=time.perf_counter()
                for raw in inputs:
                    frame_start=time.perf_counter();self.run(raw,width,height)
                    durations.append((time.perf_counter()-frame_start)*1000)
                elapsed=time.perf_counter()-start;cpu_after=cpu_snapshot()
                assert self.pipe._vj0_gpu_output_cast_probe.unchecked_calls-before_cast==self.args.frames
                self.save({'status':'measured','candidate':candidate_name,'variant':variant,
                           'size':[width,height],'steps':2,'pair':pair,'frames':self.args.frames,
                           'fps':self.args.frames/elapsed,'wall_seconds':elapsed,
                           'frame_ms':durations,'timing_ms':distribution(durations),
                           'cpu':cpu_delta(cpu_before,cpu_after,elapsed),'torch_threads':torch.get_num_threads()})
        rows=[row for row in self.records if row['status']=='measured' and row['candidate']==candidate_name and row['size']==[width,height]]
        medians={name:statistics.median(row['fps'] for row in rows if row['variant']==name) for name in ['baseline','candidate']}
        gains=[next(row['fps'] for row in rows if row['pair']==pair and row['variant']=='candidate')/
               next(row['fps'] for row in rows if row['pair']==pair and row['variant']=='baseline')-1 for pair in range(self.args.pairs)]
        survives=all(gain>0 for gain in gains) and medians['candidate']>medians['baseline']*1.02
        self.save({'status':'performance-decision','candidate':candidate_name,'size':[width,height],
                   'median_fps':medians,'paired_gain_pct':[gain*100 for gain in gains],
                   'survives':survives,'gate':'Every pair faster and median gain >2%; app confirmation still required'})
        return survives

    def profile(self, name, width, height):
        """Three untimed frames: retain executed kernel evidence, not FPS."""
        torch=self.torch
        raw=self.make_input(width,height,0)
        with torch.profiler.profile(activities=[torch.profiler.ProfilerActivity.CPU,
                                               torch.profiler.ProfilerActivity.CUDA],
                                    record_shapes=False,with_stack=False) as profile:
            for _ in range(3):self.run(raw,width,height)
        path=self.args.output/f'profile-{name}-{width}x{height}.json'
        profile.export_chrome_trace(str(path));data=path.read_bytes()
        path.with_suffix('.json.gz').write_bytes(gzip.compress(data));path.unlink()
        trace=json.loads(data)
        kernels=sorted({event['name'] for event in trace['traceEvents'] if event.get('cat')=='kernel'})
        self.save({'status':'untimed-profile','candidate':name,'size':[width,height],
                   'frames':3,'trace':path.name+'.gz','kernel_names':kernels})


def add_common_arguments(parser):
    parser.add_argument('--worker-script',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--expected-native-threads',type=int,default=128)
    parser.add_argument('--sizes',default='512x288,768x448,1024x576')
    parser.add_argument('--frames',type=int,default=150)
    parser.add_argument('--pairs',type=int,default=3)
    parser.add_argument('--compile-timeout',type=int,default=600)
