import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function fixture() {
  const calls=[], draws=[], closed=[];
  const exports={};
  const context=vm.createContext({exports, createImageBitmap:blob => new Promise((resolve,reject) => {
    calls.push({blob, resolve:() => resolve({id:blob, close:() => closed.push(blob)}),reject});
  })});
  const source=fs.readFileSync('src/lib/ai/latest-frame-decoder.ts','utf8');
  vm.runInContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
  return {calls,draws,closed,decoder:exports.createLatestFrameDecoder(bitmap => draws.push(bitmap.id))};
}
const settle=() => new Promise(resolve => setImmediate(resolve));

test('overload decodes current plus newest queued frame, while continuing to draw', async () => {
  const f=fixture();f.decoder.push('a');f.decoder.push('b');f.decoder.push('c');
  assert.deepEqual(f.calls.map(c=>c.blob),['a']);
  f.calls[0].resolve();await settle();
  assert.deepEqual(f.draws,['a']);assert.deepEqual(f.calls.map(c=>c.blob),['a','c']);
  f.calls[1].resolve();await settle();assert.deepEqual(f.draws,['a','c']);assert.deepEqual(f.closed,['a','c']);
});
test('disposal discards waiting frames and closes the late bitmap without drawing', async () => {
  const f=fixture();f.decoder.push('a');f.decoder.push('b');f.decoder.dispose();f.calls[0].resolve();await settle();
  assert.deepEqual(f.draws,[]);assert.deepEqual(f.closed,['a']);assert.equal(f.calls.length,1);
});
test('a failed decode does not strand the newest waiting frame', async () => {
  const f=fixture();f.decoder.push('a');f.decoder.push('b');f.calls[0].reject(new Error('bad JPEG'));await settle();
  assert.equal(f.calls[1].blob,'b');f.calls[1].resolve();await settle();assert.deepEqual(f.draws,['b']);
});
