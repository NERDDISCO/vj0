#!/usr/bin/env python3
"""Bounded same-weight VAE layout/compiler candidates against production compute."""
import argparse
import copy
from pathlib import Path
import time

from n03n04_common import Experiment, add_common_arguments, deadline, parse_sizes


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    add_common_arguments(parser)
    parser.add_argument('--variants',default='channels-last,conv-1x1-as-mm')
    args=parser.parse_args();args.probe=Path(__file__)
    names=args.variants.split(',')
    if len(names)>2 or len(set(names))!=len(names) or any(name not in ['channels-last','conv-1x1-as-mm'] for name in names):
        parser.error('At most the two preselected VAE variants are allowed')
    experiment=None
    try:
        experiment=Experiment(args,'n04_vae');torch=experiment.torch;pipe=experiment.pipe
        original_vae=pipe.vae
        # Clone the same loaded/quantized weights, not another checkpoint.
        encoder=original_vae.encoder;decoder=original_vae.decoder
        original_vae.encoder=getattr(encoder,'_orig_mod',encoder)
        original_vae.decoder=getattr(decoder,'_orig_mod',decoder)
        try:
            template=copy.deepcopy(original_vae)
        finally:
            original_vae.encoder=encoder;original_vae.decoder=decoder
        experiment.save({'status':'control','native_threads':torch.get_num_threads(),
                         'conv_1x1_as_mm':torch._inductor.config.conv_1x1_as_mm,
                         'variants':names,'max_targeted_variants':2})
        with torch.no_grad():
            for name in names:
                candidate=copy.deepcopy(template)
                options={'triton.cudagraphs':True}
                if name=='channels-last':
                    before={key:value.detach().clone() for key,value in candidate.named_parameters() if value.ndim==4}
                    candidate=candidate.to(memory_format=torch.channels_last)
                    same=all(torch.equal(before[key],value) for key,value in candidate.named_parameters() if value.ndim==4)
                    assert same,'Layout conversion changed 4D parameter values'
                    experiment.save({'status':'same-weights','candidate':name,'checked_4d_parameters':len(before),'exact':same})
                    del before
                else:
                    assert torch._inductor.config.conv_1x1_as_mm is False,'Control already enables this option'
                    options['conv_1x1_as_mm']=True
                candidate.encoder=torch.compile(candidate.encoder,options=options,fullgraph=False,dynamic=False)
                candidate.decoder=torch.compile(candidate.decoder,options=options,fullgraph=False,dynamic=False)
                def select(variant):
                    pipe.vae=original_vae if variant=='baseline' else candidate
                rejected=False
                for width,height in parse_sizes(args.sizes):
                    started=time.perf_counter()
                    try:
                        with deadline(args.compile_timeout,f'N04 {name} {width}x{height} warmup'):
                            for variant in ['baseline','candidate']:
                                select(variant)
                                for _ in range(4):experiment.run(experiment.make_input(width,height,0),width,height)
                    except Exception as error:
                        experiment.save({'status':'variant-failed','candidate':name,'size':[width,height],
                                         'error':f'{type(error).__name__}: {error}',
                                         'stop_rule':'Stop unsupported/resource/compile-timeout candidate; retain evidence'})
                        rejected=True;break
                    experiment.save({'status':'warmup','candidate':name,'size':[width,height],'seconds':time.perf_counter()-started})
                    if not experiment.quality(select,name,width,height):
                        experiment.save({'status':'rejected-quality','candidate':name,'size':[width,height]})
                        select('candidate');experiment.profile(name,width,height)
                        rejected=True;break
                    survives=experiment.measure_pairs(select,name,width,height)
                    select('candidate');experiment.profile(name,width,height)
                    if not survives:
                        rejected=True;break
                select('baseline')
                experiment.save({'status':'candidate-complete','candidate':name,'rejected':rejected})
                del candidate
        experiment.finish()
    except Exception as error:
        if experiment is not None:experiment.finish('failed',error)
        raise


if __name__=='__main__':main()
