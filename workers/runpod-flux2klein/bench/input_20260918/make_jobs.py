#!/usr/bin/env python3
"""Predeclare balanced input comparisons; no adaptive cherry-picking of trials."""
import argparse
import json
from pathlib import Path


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--server',required=True)
    p.add_argument('--origin',default='http://127.0.0.1:18768')
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--width',type=int,default=512)
    p.add_argument('--height',type=int,default=288)
    p.add_argument('--seconds',type=int,default=60)
    p.add_argument('--comparisons',default='rate40,rate30,buffer64,buffer16')
    p.add_argument('--pairs',type=int,default=3)
    a=p.parse_args()
    if a.output.exists():p.error('Refusing to overwrite jobs')
    variants={'rate40':(40,262144),'rate30':(30,262144),'buffer64':(60,65536),'buffer16':(60,16384)}
    jobs=[]
    for comparison in a.comparisons.split(','):
        fps,threshold=variants[comparison]
        for pair in range(a.pairs):
            for role in (['control','candidate'] if pair%2==0 else ['candidate','control']):
                jobs.append({'name':f'{comparison}-{a.width}x{a.height}-r{pair}-{role}',
                    'comparison':comparison,'pair':pair,'role':role,'server':a.server,'origin':a.origin,
                    'layout':'vj-next','width':a.width,'height':a.height,'seconds':a.seconds,
                    'sendFps':60 if role=='control' else fps,
                    'thresholdBytes':262144 if role=='control' else threshold,
                    'variant':'terminal-noop','mailbox':True,'workerThreads':128,'outputCast':'gpu',
                    'activeWorkers':1,'maxPending':3,'inputImpulses':True})
    a.output.write_text(json.dumps(jobs,indent=2)+'\n')
    print(json.dumps({'jobs':len(jobs),'timed_minutes':len(jobs)*a.seconds/60,'path':str(a.output)}))


if __name__=='__main__':main()
