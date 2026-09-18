#!/bin/bash
set -euo pipefail
export UV_CACHE_DIR=/workspace/uv-cache UV_LINK_MODE=copy
/workspace/tools/uv-py/bin/uv pip install --python /workspace/envs/klein-torch213-cu132/bin/python --constraint /workspace/vj0-next-c-constraints.txt --extra-index-url https://download.pytorch.org/whl/cu132 --index-strategy unsafe-best-match 'flashinfer-python[cu13]==0.6.18.post1' 'nvidia-cutlass-dsl[cu13]==4.7.1' 'cuda-toolkit[nvcc,cccl]==13.2.1' numpy==2.4.4 pillow==12.2.0 huggingface-hub==1.13.0
/workspace/envs/klein-torch213-cu132/bin/python -c 'import torch,torchao,diffusers,transformers,numpy,PIL; print(torch.__version__,torch.version.cuda,torchao.__version__,diffusers.__version__,transformers.__version__,numpy.__version__,PIL.__version__,torch.get_num_threads()); assert torch.__version__=="2.13.0+cu132"; assert numpy.__version__=="2.4.4"; assert PIL.__version__=="12.2.0"'
/workspace/tools/uv-py/bin/uv pip freeze --python /workspace/envs/klein-torch213-cu132/bin/python > /workspace/vj0-next-c-final-freeze.txt
date -u +%FT%TZ > /workspace/vj0-next-c-dependencies-ready
