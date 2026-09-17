#!/usr/bin/env python3
"""Check the official FA4 kernel against native SDPA at image/video-like shapes."""
import importlib.metadata
import json
import torch
from flash_attn.cute import flash_attn_func

torch.manual_seed(42)
results=[]
with torch.inference_mode():
    for query_length,key_length,heads in [(640,640,24),(1560,9360,12)]:
        q=torch.randn(1,query_length,heads,128,device='cuda',dtype=torch.bfloat16)
        k=torch.randn(1,key_length,heads,128,device='cuda',dtype=torch.bfloat16)
        v=torch.randn_like(k)
        expected=torch.nn.functional.scaled_dot_product_attention(q.transpose(1,2),k.transpose(1,2),v.transpose(1,2)).transpose(1,2)
        actual=flash_attn_func(q,k,v,causal=False)
        if isinstance(actual,tuple):actual=actual[0]
        torch.cuda.synchronize()
        difference=(actual.float()-expected.float()).abs()
        record={'query_length':query_length,'key_length':key_length,'heads':heads,
            'head_dim':128,'max_abs_difference':difference.max().item(),
            'mean_abs_difference':difference.mean().item(),
            'finite':bool(torch.isfinite(actual).all().item()),'shape':list(actual.shape)}
        results.append(record)
        assert record['finite'] and record['max_abs_difference']<0.05,record
print(json.dumps({'status':'passed','torch':torch.__version__,
    'flash-attn-4':importlib.metadata.version('flash-attn-4'),
    'gpu':torch.cuda.get_device_name(),'results':results}),flush=True)
