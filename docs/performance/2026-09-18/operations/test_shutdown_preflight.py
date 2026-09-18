import contextlib,copy,hashlib,importlib.util,io,json,os,sys,tarfile,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
def load(name):
 spec=importlib.util.spec_from_file_location(name,ROOT/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
release=load('release_live_c');persist=load('persist_c_caches')
class ShutdownTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.deadline=time.monotonic()+10
 def tearDown(self):self.temp.cleanup()
 def handoff(self):return {'status':'complete','owned_pgid':34687,'runtime_sha256':'abc','completed_epoch':time.time(),'ordered_barrier_passed':True,'cleanup_acknowledged':True,'critical_artifacts_saved':True}
 def debug(self):return {'stats':{'channelState':'closed'},'channel':None,'workers':[{'framePending':0,'compileStartedAt':0,'mailboxFlightSource':None} for _ in range(2)]}
 def test_handoff_positive(self):release.validate_capture_completion(self.handoff(),34687,'abc',time.time())
 def test_handoff_missing_identity_or_completion_rejected(self):
  for key,value in [('runtime_sha256','wrong'),('owned_pgid',123),('completed_epoch',float('nan')),('completed_epoch',time.time()+1000),('ordered_barrier_passed',False),('cleanup_acknowledged',False),('critical_artifacts_saved',False)]:
   with self.subTest(key=key):
    d=self.handoff();d[key]=value
    with self.assertRaises(AssertionError):release.validate_capture_completion(d,34687,'abc',time.time())
 def test_authoritative_channel_overrides_stale_diagnostic(self):
  d=self.debug();release.validate_idle_debug(d,2);d['channel']={'readyState':'open','bufferedAmount':0}
  with self.assertRaises(AssertionError):release.validate_idle_debug(d,2)
 def test_pending_compile_mailbox_missing_and_count_rejected(self):
  for key,value in [('framePending',1),('compileStartedAt',1),('mailboxFlightSource',42)]:
   d=self.debug();d['workers'][0][key]=value
   with self.assertRaises(AssertionError):release.validate_idle_debug(d,2)
  d=self.debug();del d['workers'][0]['mailboxFlightSource']
  with self.assertRaises(AssertionError):release.validate_idle_debug(d,2)
  with self.assertRaises(AssertionError):release.validate_idle_debug(self.debug(),1)
 def test_zombies_do_not_mask_live_members(self):
  self.assertEqual(release.live_members([{'pid':1,'state':'Z'},{'pid':2,'state':'S'}]),[{'pid':2,'state':'S'}])
 def test_process_exit_signal_race_is_tolerated(self):
  with patch.object(release.os,'kill',side_effect=ProcessLookupError):release.signal_owned(1,15)
  with patch.object(release.os,'killpg',side_effect=ProcessLookupError):release.signal_owned(1,15,group=True)
 def fixture(self):
  c=self.root/'cache';c.mkdir();(c/'payload').write_bytes(b'bounded cache payload'*50);(c/'empty').write_bytes(b'');(c/'link').symlink_to('payload');os.link(c/'payload',c/'hardlink')
  inv=persist.cache_inventory(self.root,['cache'],self.deadline);p=self.root/'archive.tar'
  with tarfile.open(p,'w',format=tarfile.PAX_FORMAT) as t:t.add(c,arcname='cache')
  return p,inv
 def test_archive_content_symlink_hardlink_integrity(self):
  p,inv=self.fixture();r=persist.verify_archive(p,inv,self.deadline);self.assertEqual(r['verified_members'],5);self.assertEqual(r['verified_regular_files'],3);self.assertEqual(r['archive_sha256'],hashlib.sha256(p.read_bytes()).hexdigest())
 def test_payload_corruption_rejected_even_with_readable_headers(self):
  p,inv=self.fixture()
  with tarfile.open(p) as t:member=next(m for m in t if m.isfile() and m.size>0);offset=member.offset_data
  with p.open('r+b') as f:f.seek(offset);f.write(b'X')
  with tarfile.open(p) as t:self.assertEqual(len(t.getmembers()),5)
  with self.assertRaises(AssertionError):persist.verify_archive(p,inv,self.deadline)
 def test_missing_duplicate_and_extra_members_rejected(self):
  p,inv=self.fixture()
  for mode in ['missing','duplicate','extra']:
   dest=self.root/(mode+'.tar')
   with tarfile.open(dest,'w') as t:
    if mode=='missing':t.add(self.root/'cache/payload',arcname='cache/payload')
    else:
     t.add(self.root/'cache',arcname='cache');t.add(self.root/'cache/payload',arcname='cache/payload' if mode=='duplicate' else 'extra')
   with self.subTest(mode=mode),self.assertRaises(AssertionError):persist.verify_archive(dest,inv,self.deadline)
 def test_changed_payload_after_inventory_rejected(self):
  p,inv=self.fixture();(self.root/'cache/payload').write_bytes(b'changed')
  with tarfile.open(p,'w') as t:t.add(self.root/'cache',arcname='cache')
  with self.assertRaises(AssertionError):persist.verify_archive(p,inv,self.deadline)
 def test_expired_deadline_rejected(self):
  p,inv=self.fixture()
  with self.assertRaises(TimeoutError):persist.verify_archive(p,inv,time.monotonic()-1)
 def test_top_level_symlink_rejected(self):
  (self.root/'real').mkdir();(self.root/'linked').symlink_to('real')
  with self.assertRaises(AssertionError):persist.cache_inventory(self.root,['linked'],self.deadline)
 def test_optional_cache_failure_retains_stop_readiness(self):
  workspace=self.root/'workspace';workspace.mkdir();tmp=self.root/'tmp';tmp.mkdir();proc=self.root/'proc/568';proc.mkdir(parents=True);(proc/'stat').write_text('568 (node) T 1 2')
  releasefile=self.root/'release.json';releasefile.write_text(json.dumps({'status':'released','released':True,'critical_artifacts_saved':True,'live_members_after':[],'gpu_compute_after':'','original_state_after':'T','owned_pgid':34687}))
  def mapped(value):
   s=str(value)
   if s=='/workspace' or s.startswith('/workspace/'):return workspace/s.removeprefix('/workspace').lstrip('/')
   if s=='/tmp' or s.startswith('/tmp/'):return tmp/s.removeprefix('/tmp').lstrip('/')
   if s.startswith('/proc/'):return self.root/s.lstrip('/')
   return Path(value)
  # No cache exists: preserve the explicit optional failure without blocking stop.
  with patch.object(persist,'Path',side_effect=mapped),patch.object(persist,'current_live_group_members',return_value=[]),patch.object(persist.subprocess,'check_output',return_value=''),patch.object(sys,'argv',['persist','--execute','--release',str(releasefile)]),contextlib.redirect_stdout(io.StringIO()):persist.main()
  d=json.loads((workspace/'vj0-C-20260918-final-caches.json').read_text());self.assertEqual(d['status'],'cache-preservation-failed-optional');self.assertTrue(d['stop_ready']);self.assertFalse(d['stop_blocked_by_cache']);self.assertIn('No expected caches',d['error'])
if __name__=='__main__':unittest.main(verbosity=2)
