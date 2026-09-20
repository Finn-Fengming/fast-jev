#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { percentile } from './lib/metrics.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { out: { type: 'string' }, pairs: { type: 'string', default: '5' }, iterations: { type: 'string', default: '1000' } } });
const pairs = Number(values.pairs);
if (!Number.isInteger(pairs) || pairs < 2 || pairs > 20) throw new Error('pairs must be 2–20.');
const out = resolve(values.out ?? join(root, 'experiments/results', `${new Date().toISOString().replaceAll(':', '-')}-overhead-ab`));
await mkdir(dirname(out), { recursive: true });
await mkdir(out);
const run = promisify(execFile);
const runs = [];
for (let pair = 0; pair < pairs; pair++) {
  const order = pair % 2 === 0 ? ['before-validation-reuse', 'current'] : ['current', 'before-validation-reuse'];
  for (const variant of order) {
    const directory = `pair-${pair + 1}-${variant}`;
    await run(process.execPath, [join(root, 'experiments/local-overhead.mjs'), '--variant', variant, '--tag', `paired-${pair + 1}`, '--iterations', values.iterations, '--out', join(out, directory)], { cwd: root, maxBuffer: 2 * 1024 * 1024 });
    const summary = JSON.parse(await readFile(join(out, directory, 'summary.json'), 'utf8'));
    runs.push({ pair, variant, directory, batches: summary.batches });
    process.stderr.write(`Pair ${pair + 1}/${pairs}: ${variant}\n`);
  }
}
const batches = [1, 8, 32].map(count => {
  const before = runs.filter(x => x.variant === 'before-validation-reuse').map(x => x.batches.find(b => b.batch_size === count).p50_ms);
  const after = runs.filter(x => x.variant === 'current').map(x => x.batches.find(b => b.batch_size === count).p50_ms);
  return {
    batch_size: count, pair_count: pairs,
    before_p50_median_ms: percentile(before, 50), after_p50_median_ms: percentile(after, 50),
    before_p50_range_ms: [Math.min(...before), Math.max(...before)], after_p50_range_ms: [Math.min(...after), Math.max(...after)],
    paired_reduction_fraction: before.map((value, index) => (value - after[index]) / value),
    median_paired_reduction_fraction: percentile(before.map((value, index) => (value - after[index]) / value), 50),
  };
});
const report = { kind: 'local_wrapper_optimization_ab', created_at: new Date().toISOString(), pairs, order: 'Alternating AB/BA; fresh Node process per variant, 100 warmups then measured iterations per batch size', batches, runs, inference_measured: false, interpretation: 'Local fixture only. These results do not measure AGY inference or demonstrate that fast-jev beats Jev. Every raw timing sample is retained in the run directories.' };
await writeFile(join(out, 'comparison.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: out, ...report }, null, 2));
