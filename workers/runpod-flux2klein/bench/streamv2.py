#!/usr/bin/env python3
"""Isolated StreamDiffusionV2 staged API benchmark. Stop Klein GPU work first.

Reports actual decoded output count, including pipeline fill/drain shortfall.
Offline throughput is not live capture age; no input/output correspondence is
assumed across the stream-batched pipeline.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import time
import traceback

from metrics import distribution


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--checkpoint-folder', required=True)
    p.add_argument('--model-type', choices=['T2V-1.3B', 'T2V-14B'], default='T2V-1.3B')
    p.add_argument('--config-path')
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--width', type=int, default=832)
    p.add_argument('--height', type=int, default=480)
    p.add_argument('--frames', type=int, default=65)
    p.add_argument('--steps', type=int, default=2)
    p.add_argument('--repeats', type=int, default=3)
    p.add_argument('--mode', choices=['single', 'single-wo'], default='single')
    p.add_argument('--taehv', action='store_true')
    p.add_argument('--tensorrt', action='store_true')
    p.add_argument('--fast', action='store_true', help='Upstream fast preset changes decoder AND KV/context settings')
    p.add_argument('--arrival-fps', type=float, default=0, help='Pace chunk availability; reports submission delay, not input/output correspondence')
    p.add_argument('--noise-scale', type=float, default=0.8)
    p.add_argument('--scene', choices=['waveform', 'detailed'], default='waveform')
    p.add_argument('--prompt', default='colorful abstract art, vibrant neon lights, psychedelic patterns')
    a = p.parse_args()
    if a.frames < 5 or (a.frames - 1) % 4 or not 1 <= a.steps <= 4 or a.repeats < 1 or a.arrival_fps < 0:
        p.error('frames must be 1+4n >=5, steps 1..4, and repeats positive')
    a.output.mkdir(parents=True, exist_ok=True)
    import numpy as np
    import torch
    from PIL import Image, ImageDraw
    from streamdiffusionv2 import StreamDiffusionV2Pipeline, export_video
    import streamdiffusionv2.pipeline as pipeline_module

    report = {'status': 'running', 'config': {k: str(v) if isinstance(v, Path) else v for k, v in vars(a).items()},
        'python': platform.python_version(), 'gpu': torch.cuda.get_device_name(0),
        'versions': {n: importlib.metadata.version(n) for n in ['torch', 'diffusers', 'transformers', 'numpy', 'pillow']},
        'pipeline_sha256': hashlib.sha256(Path(pipeline_module.__file__).read_bytes()).hexdigest(),
        'frame_age': 'not measured: offline inputs, no verified output-to-input correspondence', 'runs': []}

    def save():
        (a.output / 'result.json').write_text(json.dumps(report, indent=2) + '\n')

    save()
    try:
        started = time.perf_counter()
        pipe = StreamDiffusionV2Pipeline(a.checkpoint_folder, mode=a.mode,
            width=a.width, height=a.height, step=a.steps, noise_scale=a.noise_scale,
            seed=42, use_taehv=a.taehv, use_tensorrt=a.tensorrt, fast=a.fast,
            model_type=a.model_type, config_path=a.config_path, device='cuda', fps=30)
        torch.cuda.synchronize()
        report['load_seconds'] = time.perf_counter() - started
        print(json.dumps({'loaded_seconds': report['load_seconds']}), flush=True)
        frames = []
        x = np.arange(a.width)
        for index in range(a.frames):
            if a.scene == 'detailed':
                yy, xx = np.indices((a.height, a.width))
                background = np.stack(((xx*3+yy)%128, (xx+yy*5)%128,
                    ((xx//12 ^ yy//12)%2)*100), axis=-1).astype('uint8')
                im = Image.fromarray(background)
            else:
                im = Image.new('RGB', (a.width, a.height), (10, 10, 10))
            y = a.height * (0.5 + 0.24 * np.sin(x / a.width * np.pi * 4 + index * 0.25)
                           + 0.07 * np.sin(x / a.width * np.pi * 19 - index * 0.17))
            ImageDraw.Draw(im).line(list(zip(x.tolist(), y.tolist())), fill='white', width=max(2, a.width // 128))
            frames.append(np.asarray(im))
        inputs = np.stack(frames)
        Image.fromarray(inputs[0]).save(a.output / 'input-first.png')
        video = torch.from_numpy(inputs.copy()).permute(3, 0, 1, 2).unsqueeze(0).to(device='cuda', dtype=torch.bfloat16) / 127.5 - 1
        for repeat in range(a.repeats):
            pipe.prepare(a.prompt)
            torch.manual_seed(42)
            chunks = pipe.chunk_video(video)
            noise_scale = a.noise_scale
            outputs, timings, records = [], [], []
            torch.cuda.reset_peak_memory_stats()
            torch.cuda.synchronize()
            start = time.perf_counter()
            first_output = None
            for index, chunk in enumerate(chunks):
                # Input frame zero arrives at t=0. A chunk cannot be submitted
                # until its final input frame has arrived. Do not count queued
                # or duplicated display frames as generated outputs.
                available = start + (chunk.end_idx - 1) / a.arrival_fps if a.arrival_fps else None
                if available is not None:
                    time.sleep(max(0, available - time.perf_counter()))
                t0 = time.perf_counter()
                encoded = pipe.encode_chunk(video, chunk, previous_noise_scale=noise_scale,
                    initial_noise_scale=a.noise_scale)
                noise_scale = encoded.noise_scale
                denoised = pipe.denoise_chunk(encoded)
                decoded = pipe.decode_chunk(denoised) if denoised is not None else None
                torch.cuda.synchronize()
                done = time.perf_counter()
                timings.append((done - t0) * 1000)
                count = len(decoded) if decoded is not None else 0
                if count:
                    outputs.append(decoded)
                    if first_output is None:
                        first_output = done - start
                records.append({'input_start': chunk.start_idx, 'input_end': chunk.end_idx,
                    'output_frames': count, 'elapsed_ms': timings[-1], 'noise_scale': noise_scale,
                    'adaptive_timestep': encoded.current_step,
                    'chunk_submission_delay_ms': (t0 - available) * 1000 if available is not None else None,
                    'submitted_chunk_available_to_completion_ms': (done - available) * 1000 if available is not None else None})
            elapsed = time.perf_counter() - start
            count = sum(len(o) for o in outputs)
            if count == 0:
                raise RuntimeError('no decoded output')
            # Validate and log after stopping the timer. Never claim a requested
            # resolution when the model silently returned another shape.
            for decoded in outputs:
                if decoded.ndim != 4 or tuple(decoded.shape[1:]) != (a.height, a.width, 3):
                    raise RuntimeError(f'unexpected output shape: {decoded.shape}')
                if not np.isfinite(decoded).all() or decoded.min() < 0 or decoded.max() > 1:
                    raise RuntimeError('output must be finite RGB values in [0, 1]')
            run = {'repeat': repeat, 'cold_first_pass': repeat == 0, 'elapsed_seconds': elapsed,
                'input_frames': a.frames, 'output_frames': count, 'output_fps': count / elapsed,
                'output_shape_thwc': [count, a.height, a.width, 3],
                'output_range': [float(min(o.min() for o in outputs)), float(max(o.max() for o in outputs))],
                'first_output_seconds': first_output, 'chunk_ms': distribution(timings), 'chunks': records,
                'peak_allocated_bytes': torch.cuda.max_memory_allocated(),
                'peak_reserved_bytes': torch.cuda.max_memory_reserved()}
            report['runs'].append(run)
            save()
            print(json.dumps(run), flush=True)
            if repeat == 0:
                output = np.concatenate(outputs)
                for name, frame in [('first', output[0]), ('middle', output[len(output)//2]), ('last', output[-1])]:
                    Image.fromarray((np.clip(frame, 0, 1) * 255).astype('uint8')).save(a.output / f'output-{name}.png')
                export_video(output, str(a.output / 'output.mp4'), fps=30)
                export_video(inputs.astype('float32') / 255, str(a.output / 'input.mp4'), fps=30)
        report['status'] = 'measured'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
        report['traceback'] = traceback.format_exc()
        raise
    finally:
        save()


if __name__ == '__main__':
    main()
