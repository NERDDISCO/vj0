import fs from 'node:fs';
import {cadenceSource} from './load-cadence.mjs';

// Inject the actual production helper into the isolated browser comparison.
console.log(`(() => { const exports = {}; ${cadenceSource}; window.vj0CaptureCadence = exports; })();`);
console.log(fs.readFileSync('workers/runpod-flux2klein/bench/capture-diagnostics/capture-loop.js','utf8'));
