#!/usr/bin/env python3
"""Audit the declared N06 quality/timing proof without inventing CUDA profiles.

Read-only inputs; the historical auditor and its failed full-coverage verdict
are retained unchanged. A temporary source-manifest adapter supplies its older
filename convention. Only the explicitly declared missing-profile coverage is
separated from the unchanged numerical, timing, thread and source checks.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import tempfile

import audit_post_live

DEFAULT_FROZEN = Path(__file__).resolve().parents[3] / 'docs/performance/2026-09-18/scaling/frozen-production'
AUDITOR_SHA256 = '3730698cba54bf855720be11859632ec98330239fb05081137103c3663eef5dd'
MISSING_PROFILES = 'Expected both requested CUDA profiles'
EXPECTED_SOURCES = {
    'worker_runtime.py': '9f4db6c60d93fba34724136687b6e1fde9de0fa863c033a2c418779b6ba85fba',
    'inference_server.py': 'e28fd5079951160c264bbcbae80499c0e25fe0114f13b14a439cc49425d4daad',
    'bench/metrics.py': '820490a5067dfdc126fa7e6ed253779eabd7383855817d92eddf606fdf1c93ac',
    'bench/bench_terminal_followup.py': 'ba90438e341c305607347db5e6380aba24451d9849554f9fa8c99c8d119b69d4',
    'bench/bench_post_live.py': '7d9060c73965d3d7fa4e478b6f5211d4f640d6c1fb7b8d706ae80f2cb5fc7613',
    'bench/gpu_output_cast.py': '2bf079647d464b4dbc5c429615d66e47cf93a8b9ddebb4cd1278c6aeb9562d87',
    'bench/terminal_noop.py': '33a741c159b6432bc5ee38b8206708cb41cbbfb648072faa9cd0817fbcb667da',
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    if not path.is_file():
        path = path.with_name(path.name + '.gz')
    data = path.read_bytes()
    payload = gzip.decompress(data) if path.suffix == '.gz' else data
    return json.loads(payload), {'path': str(path), 'stored_sha256': sha(data), 'payload_sha256': sha(payload)}


class StrictParser(argparse.ArgumentParser):
    def error(self, message):
        raise ValueError(message)


def launch_arguments(argv):
    if not isinstance(argv, list) or len(argv) < 3 or not all(isinstance(x, str) for x in argv):
        raise ValueError('Runner argv must be the exact subprocess argument array')
    if Path(argv[1]).name != 'bench_post_live.py' or argv.count('--skip-profiles') != 1:
        raise ValueError('Runner must invoke bench_post_live.py with one explicit --skip-profiles')
    # Duplicate options are ambiguous provenance even if argparse would accept
    # the final occurrence. Never interpret shell text or execute this argv.
    options = [x.split('=', 1)[0] for x in argv[2:] if x.startswith('--')]
    if len(options) != len(set(options)):
        raise ValueError('Duplicate runner option')
    parser = StrictParser(add_help=False)
    parser.add_argument('--worker-script', required=True)
    parser.add_argument('--output', required=True)
    for key, default in [('frames', 100), ('pairs', 3), ('profile-frames', 20), ('warmup', 4), ('expected-native-threads', 128)]:
        parser.add_argument('--' + key, type=int, default=default)
    parser.add_argument('--cast-pairs-1024', action='store_true')
    parser.add_argument('--skip-profiles', action='store_true')
    parsed = vars(parser.parse_args(argv[2:]))
    if Path(argv[1]) != Path(parsed['worker_script']).parent / 'bench/bench_post_live.py':
        raise ValueError('Probe and worker do not belong to the same frozen directory')
    return parsed


def audit(root, runner_state, frozen_sources=DEFAULT_FROZEN):
    root, runner_state, frozen_sources = map(Path, (root, runner_state, frozen_sources))
    errors = []
    output = {'status': 'failed', 'scope': 'N06 production quality/timing proof only; CUDA attribution profiles deliberately omitted',
              'errors': errors, 'original_auditor': None, 'bindings': {},
              'profile_coverage': {'status': 'not-measured', 'required_profiles': 0,
                  'historical_full_audit_required_profiles': 2, 'launch_declaration_verified': False},
              'limitations': ['A scoped quality/timing pass is not a pass of the historical full-profile audit.',
                  'No CUDA kernel attribution or browser/live FPS is established by this proof.',
                  'Quality checks cover terminal skip and GPU output cast through production generate with per-frame noise. They do not prove pixel equivalence of the complete live wrapper, including its constant cache and event timing.',
                  'Saved runner argv and hashes are evidence, not independent attestation of remote execution.']}

    def require(condition, message):
        if not condition:
            errors.append(message)

    try:
        result, output['bindings']['result'] = read(root / 'result.json')
        runner, output['bindings']['runner_state'] = read(runner_state)
        manifest, output['bindings']['source_manifest'] = read(frozen_sources / 'hashes.json')
        require(manifest == EXPECTED_SOURCES, 'Frozen manifest is not the exact seven approved production sources')
        require(runner.get('sources') == EXPECTED_SOURCES, 'Runner source manifest differs from the approved seven sources')
        require(runner.get('status') == 'complete' and type(runner.get('exit_code')) is int
                and runner['exit_code'] == 0 and runner.get('result_status') == 'complete',
                'Runner did not complete successfully with a complete result')
        arguments = launch_arguments(runner.get('argv'))
        require(arguments == result.get('arguments'), 'Saved subprocess argv differs from result arguments')
        require(result.get('arguments', {}).get('skip_profiles') is True, 'Result does not declare skip_profiles=true')
        require(all(arguments[key] == value for key, value in
                    [('frames', 100), ('pairs', 3), ('profile_frames', 20), ('warmup', 4),
                     ('expected_native_threads', 128), ('cast_pairs_1024', False)]),
                'Unexpected N06 production proof counts/settings')
        records = result.get('records', [])
        require(not any(r.get('status') == 'profile' for r in records), 'Unexpected profile records in declared skipped-profile run')
        require(not list(root.rglob('profile*')), 'Unexpected profile artifacts in declared skipped-profile run')
        allowed = {'boot-proof', 'warmup', 'quality', 'compute-measured'}
        require(all(r.get('status') in allowed for r in records), 'Unexpected record type in N06 quality/timing proof')
        warmups = [r.get('size') for r in records if r.get('status') == 'warmup']
        require(len(warmups) == 3 and sorted(warmups) == sorted(map(list, audit_post_live.SIZES)),
                'Warmup size coverage differs from the three declared resolutions')
        auditor_path = Path(audit_post_live.__file__)
        output['bindings']['historical_auditor'] = {'path': str(auditor_path), 'sha256': sha(auditor_path.read_bytes())}
        require(output['bindings']['historical_auditor']['sha256'] == AUDITOR_SHA256,
                'Historical auditor changed; explicit coverage exception requires renewed review')
        frozen_bytes = {}
        for name, expected in EXPECTED_SOURCES.items():
            data = (frozen_sources / name).read_bytes()
            require(sha(data) == expected, 'Frozen source contents differ: ' + name)
            frozen_bytes[name] = data
        output['profile_coverage']['launch_declaration_verified'] = not errors
        if errors:
            return output
        # Adapt only the manifest filename. The actual results, images, rows and
        # auditor code are passed through unmodified.
        with tempfile.TemporaryDirectory(prefix='vj0-n06-source-adapter-') as directory:
            adapter = Path(directory)
            for name, data in frozen_bytes.items():
                path = adapter / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            (adapter / 'sources.json').write_text(json.dumps(manifest))
            original = output['original_auditor'] = audit_post_live.audit(root, adapter)
        output['coverage_difference'] = {'expected_original_error': MISSING_PROFILES,
            'meaning': 'The historical failed verdict below is retained. Only this predeclared coverage difference permits a separate quality/timing-only conclusion.'}
        require(original['status'] == 'failed' and original['errors'] == [MISSING_PROFILES],
                'Historical audit did not fail solely for the declared absent CUDA profiles')
        require(original['quality_fixtures'] == 27 and original['same_tensor_cast_checks'] == 54
                and len(original['compute']) == 3 and original['record_counts'].get('compute-measured') == 18,
                'Historical numerical/timing coverage differs from the required 27 quality and 18 timing cells')
        # Catch a concurrent rewrite while these artifacts were being inspected.
        for name, path in [('result', root / 'result.json'), ('runner_state', runner_state),
                           ('source_manifest', frozen_sources / 'hashes.json')]:
            require(read(path)[1] == output['bindings'][name], 'Input changed during audit: ' + name)
        if not errors:
            output['status'] = 'passed-quality-timing-only'
    except (OSError, ValueError, TypeError, KeyError, IndexError, AttributeError) as error:
        errors.append(f'{type(error).__name__}: {error}')
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input', type=Path, required=True)
    parser.add_argument('--runner-state', type=Path, required=True)
    parser.add_argument('--frozen-sources', type=Path, default=DEFAULT_FROZEN)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    destination = args.output.resolve()
    if destination.exists() or any(directory.resolve() == destination or directory.resolve() in destination.parents
                                   for directory in (args.input, args.frozen_sources)) or destination == args.runner_state.resolve():
        parser.error('Use a fresh output file outside measured data and frozen sources')
    report = audit(args.input, args.runner_state, args.frozen_sources)
    destination.write_text(json.dumps(report, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'status': report['status'], 'errors': report['errors'], 'output': str(destination)}))
    return 0 if report['status'] == 'passed-quality-timing-only' else 1


if __name__ == '__main__':
    raise SystemExit(main())
