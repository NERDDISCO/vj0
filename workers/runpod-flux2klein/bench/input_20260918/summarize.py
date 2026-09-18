#!/usr/bin/env python3
"""Summarize only complete predeclared input comparisons, retaining failures."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import statistics


def json_path(path):
    return path if path.exists() else path.with_name(path.name+'.gz')


def read_json(path):
    path=json_path(path)
    return json.loads(gzip.decompress(path.read_bytes()) if path.suffix=='.gz' else path.read_bytes())


def main():
    p=argparse.ArgumentParser(description=__doc__)
    source=p.add_mutually_exclusive_group(required=True)
    source.add_argument('--results',type=Path)
    source.add_argument('--selection',type=Path,help='Explicit job-to-root provenance; never choose the best repeat')
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args()
    selection=read_json(a.selection) if a.selection else None
    identity=selection if selection else read_json(a.results/'identity.json')
    if len({j['name'] for j in identity['jobs']})!=len(identity['jobs']):
        raise ValueError('Duplicate selected job names')
    roots={j['name']:Path(selection['trial_roots'][j['name']]) if selection else a.results for j in identity['jobs']}
    common_identity=None
    if selection:
        cohort_identities={str(root):read_json(root/'identity.json') for root in set(roots.values())}
        for job in identity['jobs']:
            cohort=cohort_identities[str(roots[job['name']])]
            members=[j for j in cohort['jobs'] if j['name']==job['name']]
            if members!=[job]:raise ValueError('Selected job is not an exact unique member of cohort identity: '+job['name'])
            signature={key:cohort[key] for key in ['harness_sha256','probe_sha256','fixture']}
            if common_identity is None:common_identity=signature
            elif signature!=common_identity:raise ValueError('Selected cohorts differ in harness, probe or fixture')
    cleanups={}
    for root in set(roots.values()):
        path=root/'cleanup.json'
        cleanups[str(root)]=read_json(path) if json_path(path).exists() else {'status':'missing'}
    cleanup={'status':'pages-closed' if all(c.get('status')=='pages-closed' and not c.get('errors') for c in cleanups.values()) else 'failed',
             'errors':[str(root)+': '+str(c) for root,c in cleanups.items() if c.get('status')!='pages-closed' or c.get('errors')],
             'cohorts':cleanups}
    groups={}
    for job in identity['jobs']:
        key=job['comparison']+f"-{job['width']}x{job['height']}"
        group=groups.setdefault(key,{'trials':[]})
        folder=roots[job['name']]/job['name']
        path=folder/'summary.json'
        if not json_path(path).exists():
            group['trials'].append({'name':job['name'],'role':job['role'],'pair':job['pair'],
                'source_summary':str(path),'status':'missing'})
            continue
        summary=read_json(path);stage=summary['input']['surfaces']['stage/webgl-frame-submitted']
        if selection and summary.get('config')!=job:
            raise ValueError('Selected trial configuration differs: '+str(path))
        admission=summary['input'].get('admission',{})
        drain_path=folder/'drain-before-switch.json'
        drain=read_json(drain_path) if json_path(drain_path).exists() else {}
        drain_valid=drain.get('status')=='drained' and (not drain.get('initial',{}).get('open') or
            drain.get('ordered_barrier',{}).get('ack',{}).get('status')=='passed')
        group['trials'].append({'name':job['name'],'role':job['role'],'pair':job['pair'],
            'source_summary':str(json_path(path)),'problems':summary.get('problems',[]),
            'status':summary['status'],'stage_fps':stage['unique_fps'],
            'transition_drain_valid':drain_valid,
            'age_ms':stage['source_age_ms'],'age_fractions':stage['fractions_older_than_ms'],
            'max_gap_ms':stage['output_gap_ms']['max'],
            'impulses':summary['input']['impulse_summary'],
            'requested_fps':job.get('sendFps'),
            'threshold_bytes':job.get('thresholdBytes'),
            'admission_checks':admission.get('checks',{}),
            'send_fps':summary['input']['surfaces']['main/sent']['unique_fps'],
            'receive_fps':summary['input']['surfaces']['main/received']['unique_fps']})
    for key,group in groups.items():
        trials=group['trials']
        counts={role:sum(r['role']==role for r in trials) for role in ['control','candidate']}
        pair_keys=[(r['role'],r['pair']) for r in trials]
        matched_pairs=(len(set(pair_keys))==len(pair_keys) and
            {r['role'] for r in trials}=={'control','candidate'} and
            all({r['pair'] for r in trials if r['role']==role}=={0,1,2} for role in ['control','candidate']))
        group['matched_predeclared_pairs']=matched_pairs
        def complete_window(r):
            # A continuity failure is a measured negative outcome, never a reason
            # to discard its numbers or rerun it until it passes. Structural or
            # unspecified failures still cannot enter descriptive medians.
            return r['status']=='measured' or (r['status']=='invalid' and r.get('problems') and
                all(problem.startswith('main: worker ') and problem.endswith('had an output gap over two seconds')
                    for problem in r['problems']))
        if not matched_pairs or any(not complete_window(r) for r in trials) or counts['control']<3 or counts['control']!=counts['candidate']:
            group['decision']='incomplete-or-failed; do not mix into a complete-cohort median'
            continue
        median=lambda role,fn:statistics.median(fn(r) for r in trials if r['role']==role)
        stats={role:{'stage_fps':median(role,lambda r:r['stage_fps']),
                     'send_fps':median(role,lambda r:r['send_fps']),
                     'receive_fps':median(role,lambda r:r['receive_fps']),
                     'p95_age_ms':median(role,lambda r:r['age_ms']['p95']),
                     'p99_age_ms':median(role,lambda r:r['age_ms']['p99']),
                     'missed_stage_impulses':median(role,lambda r:r['impulses']['stage_unobserved_in_window']),
                     'impulses_within_1000ms':median(role,lambda r:r['impulses']['stage_response_within_1000ms'])}
               for role in ['control','candidate']}
        control,candidate=stats['control'],stats['candidate']
        temporal={role:{field:sum(r['impulses'].get(field,0) for r in trials if r['role']==role)
            for field in ['expected_count','stage_response_within_1000ms','stage_unobserved_in_window','no_admitted_capture']}
            for role in ['control','candidate']}
        paired_temporal=[]
        for pair in range(3):
            c=next(r['impulses'] for r in trials if r['role']=='control' and r['pair']==pair)
            k=next(r['impulses'] for r in trials if r['role']=='candidate' and r['pair']==pair)
            paired_temporal.append({'pair':pair,'preserved':
                k['expected_count']==c['expected_count'] and
                k['stage_response_within_1000ms']>=c['stage_response_within_1000ms'] and
                k['stage_unobserved_in_window']<=c['stage_unobserved_in_window'] and
                k.get('no_admitted_capture',0)<=c.get('no_admitted_capture',0)})
        group['pooled_temporal_counts']=temporal
        group['matched_pair_temporal_checks']=paired_temporal
        group['treatment_observation']={
            'candidate_send_fps_fraction_of_control':candidate['send_fps']/control['send_fps'] if control['send_fps'] else None,
            'threshold_rejections_by_role':{role:sum(
                check.get('rejected',0) for r in trials if r['role']==role
                for check in r['admission_checks'].values()) for role in ['control','candidate']},
            'meaning':'Requested rate is not achieved rate. Zero admission rejections means the threshold did not bind in these trials; it does not establish behavior under a congested link.'}
        checks={'all_trials_passed_continuity_and_structure':all(r['status']=='measured' for r in trials),
                'stage_fps_at_least_95pct':candidate['stage_fps']>=control['stage_fps']*.95,
                'p95_age_at_least_10pct_lower':candidate['p95_age_ms']<=control['p95_age_ms']*.9,
                'p99_age_no_more_than_10pct_worse':candidate['p99_age_ms']<=control['p99_age_ms']*1.1,
                'equal_pooled_impulse_opportunities':temporal['candidate']['expected_count']==temporal['control']['expected_count'],
                'no_increase_in_unobserved_impulses':temporal['candidate']['stage_unobserved_in_window']<=temporal['control']['stage_unobserved_in_window'],
                'no_fewer_impulses_within_1000ms':temporal['candidate']['stage_response_within_1000ms']>=temporal['control']['stage_response_within_1000ms'],
                'no_increase_in_uncaptured_impulses':temporal['candidate']['no_admitted_capture']<=temporal['control']['no_admitted_capture'],
                'all_matched_pairs_preserve_temporal_response':all(r['preserved'] for r in paired_temporal),
                'complete_temporal_coverage':all(r['impulses'].get('expected_count',0)>0 and
                    r['impulses']['count']==r['impulses']['expected_count'] and
                    r['impulses'].get('valid_indices')==list(range(r['impulses']['expected_count'])) and
                    not r['impulses'].get('invalid_indices') and not r['impulses'].get('censored_indices') for r in trials),
                'all_transition_barriers_verified':all(r['transition_drain_valid'] for r in trials),
                'final_cleanup_verified':cleanup.get('status')=='pages-closed' and not cleanup.get('errors')}
        group.update(median_trials=stats,gates=checks,
                     descriptive_medians_include_failed_outcome_trials=any(r['status']!='measured' for r in trials),
                     decision='eligible-for-expansion; temporal visuals still need review' if all(checks.values()) else 'not-promoted; inspect tradeoff or one bounded follow-up batch')
    result={'comparisons':groups,'cleanup':cleanup,'selection_provenance':str(a.selection) if a.selection else None,
            'common_identity':({key:common_identity[key] for key in ['harness_sha256','probe_sha256']} |
                {'fixture_sha256':hashlib.sha256(json.dumps(common_identity['fixture'],sort_keys=True).encode()).hexdigest()}) if common_identity else None,
            'interpretation':'Stage submission is not physical presentation; age is capture encode start to submission; impulse IDs/RMS are not perceptual visual-equivalence proof. Complete-window continuity failures remain in descriptive medians and always block promotion.'}
    a.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({k:v['decision'] for k,v in groups.items()},indent=2))


if __name__=='__main__':main()
