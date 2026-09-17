import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

export const cadenceSource = ts.transpileModule(
  fs.readFileSync('src/lib/ai/capture-cadence.ts', 'utf8'),
  {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}},
).outputText;
const context=vm.createContext({exports:{}});
vm.runInContext(cadenceSource,context);
export const {isCaptureFrameDue,advanceCaptureFrameDeadline}=context.exports;
