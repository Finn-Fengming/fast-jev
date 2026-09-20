import { parseArgs } from 'node:util';
import { decide } from '../src/decision.mjs';
import { resolveConfig } from '../src/config.mjs';

// Real inference only: no fabricated latency, no mock-provider fallback.
const { values } = parseArgs({ options: {
  runs: { type: 'string', default: '3' }, provider: { type: 'string' }, model: { type: 'string' },
  config: { type: 'string' }, 'base-url': { type: 'string' }, timeout: { type: 'string' },
  'response-format': { type: 'string' },
} });
const runs = Number(values.runs);
if (!Number.isInteger(runs) || runs < 1 || runs > 100) throw new Error('--runs must be 1–100. Each run makes one real provider call.');
const { runs: ignored, ...flags } = values;
const options = await resolveConfig(flags);
const samples = [];
for (let index = 0; index < runs; index++) {
  const request = { state: 'Customer says: I was charged twice for one purchase.', questions: [
    { id: 'queue', type: 'choice', prompt: 'Choose the support queue.', options: ['billing', 'technical', 'other'] },
    { id: 'duplicate', type: 'boolean', prompt: 'Does the customer report a duplicate charge?' },
  ] };
  const start = performance.now();
  try {
    const output = await decide(request, options);
    samples.push({ ok: true, elapsed_ms: Math.round(performance.now() - start), correct: output.results[0].value === 'billing' && output.results[1].value === true, meta: output.meta });
  } catch (error) {
    samples.push({ ok: false, elapsed_ms: Math.round(performance.now() - start), code: error.code ?? 'ERROR', message: error.message });
  }
  process.stderr.write(`Completed ${index + 1}/${runs}\n`);
}
const times = samples.filter(sample => sample.ok).map(sample => sample.elapsed_ms).sort((a, b) => a - b);
const percentile = p => times.length ? times[Math.ceil(times.length * p) - 1] : null;
console.log(JSON.stringify({
  date: new Date().toISOString(), node: process.version, platform: process.platform,
  provider: options.provider, model: options.model, runs, succeeded: times.length,
  p50_ms: percentile(0.5), p95_ms: percentile(0.95),
  note: 'Sequential independent calls; agy includes process startup. This tiny fixture is a smoke test, not a general accuracy or calibration benchmark.', samples,
}, null, 2));
if (times.length !== runs) process.exitCode = 1;
