import datetime,json,pathlib,subprocess,time,os,shutil
root=pathlib.Path('/tmp/torchinductor_root')
out=pathlib.Path('/workspace/torchinductor-A-20260918-final.tar')
partial=pathlib.Path(str(out)+'.partial')
proof=pathlib.Path('/workspace/torchinductor-A-20260918-final-proof.json')
assert not out.exists() and not partial.exists() and not proof.exists()
assert not subprocess.check_output(['nvidia-smi','--query-compute-apps=pid','--format=csv,noheader'],text=True).strip()
state={'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':str(root),'destination':str(out),'partial':str(partial),'cap_seconds':120,'status':'running','gpu_idle':True,'format':'uncompressed tar, source paths relative to /tmp'}
start=time.monotonic()
def save():proof.write_text(json.dumps(state,indent=2)+'\n')
save()
try:
 size=int(subprocess.check_output(['du','-sb',str(root)],text=True,timeout=10).split()[0]);state['source_bytes']=size
 assert shutil.disk_usage('/workspace').free>size*2,'Insufficient reported free workspace space'
 with open('/workspace/torchinductor-A-20260918-final-tar.log','wb') as log:
  subprocess.run(['tar','--format=posix','-cf',str(partial),'-C','/tmp','torchinductor_root'],stdout=log,stderr=subprocess.STDOUT,check=True,timeout=max(1,120-(time.monotonic()-start)))
 state['archive_bytes']=partial.stat().st_size
 # Traverse all headers before allowing the completed filename.
 subprocess.run(['tar','-tf',str(partial)],stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,check=True,timeout=max(1,120-(time.monotonic()-start)))
 partial.rename(out);state.update(status='complete',readable_archive_checked=True)
except BaseException as error:
 state.update(status='failed',error=f'{type(error).__name__}: {error}',partial_bytes=partial.stat().st_size if partial.exists() else 0)
finally:
 state.update(elapsed_seconds=time.monotonic()-start,finished_utc=datetime.datetime.now(datetime.timezone.utc).isoformat());save();print(json.dumps(state,indent=2),flush=True)
