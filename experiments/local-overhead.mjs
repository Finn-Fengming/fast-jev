#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, release } from 'node:os';
import { buildBatch, loadSuite, sourceHashes } from './lib/suite.mjs';
import { percentile } from './lib/metrics.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  iterations: { type: 'string', default: '1000' },
  warmup: { type: 'string', default: '100' },
  tag: { type: 'string', default: 'current' }, out: { type: 'string' }, variant: { type: 'string', default: 'current' },
} });
if (!['current', 'before-validation-reuse'].includes(values.variant)) throw new Error('Unknown variant.');
const { decide } = await import(values.variant === 'current' ? '../src/decision.mjs' : './variants/decision-before-validation-reuse.mjs');
const iterations = Number(values.iterations);
const warmup = Number(values.warmup);
if (!Number.isInteger(iterations) || iterations < 10 || iterations > 10000 || !Number.isInteger(warmup) || warmup < 0 || warmup > 1000) throw new Error('iterations must be 10–10000, warmup 0–1000.');
const out = resolve(values.out ?? join(root, 'experiments/results', `${new Date().toISOString().replaceAll(':', '-')}-local-overhead`));
await mkdir(dirname(out), { recursive: true });
await mkdir(out);
const { cases, sha256 } = await loadSuite(join(root, 'experiments/data/decision-suite.jsonl'));
const originalFetch = globalThis.fetch;
const samples = [];
try {
  for (const count of [1, 8, 32]) {
    const group = cases.filter(item => item.split === 'dev').slice(0, count);
    const { request, mapping } = buildBatch(group);
    const outputs = mapping.map(item => {
      const data = group.find(x => x.id === item.case_id);
      return { id: item.id, type: data.request.questions.find(q => q.id === item.original_id).type, value: data.expected[item.original_id], confidence: 1 };
    });
    const payload = JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results: outputs }) } }] });
    globalThis.fetch = async (url, options) => {
      if (url !== 'https://local-fixture.invalid/v1/chat/completions') throw new Error('Microbenchmark attempted a non-fixture endpoint.');
      options.signal.throwIfAborted();
      return new Response(payload, { headers: { 'Content-Type': 'application/json' } });
    };
    for (let index = -warmup; index < iterations; index++) {
      const start = performance.now();
      const output = await decide(request, { provider: 'openai', model: 'local-fixture', baseUrl: 'https://local-fixture.invalid/v1', timeoutMs: 60000 });
      const elapsed = performance.now() - start;
      if (output.results.length !== count) throw new Error('Invalid local fixture.');
      if (index >= 0) samples.push({ batch_size: count, iteration: index, elapsed_ms: elapsed });
    }
  }
} finally { globalThis.fetch = originalFetch; }
const summary = {
  schema_version: 1, kind: 'local_wrapper_overhead_only', tag: values.tag, variant: values.variant, created_at: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch, os_release: release(), cpu: cpus()[0]?.model },
  source: await sourceHashes(root), dataset_sha256: sha256,
  protocol: { iterations_per_batch_size: iterations, excluded_warmup_iterations: warmup, batch_sizes: [1, 8, 32], concurrency: 1, transport: 'in-process global fetch fixture; zero network calls', timing: 'decide() including prompt/schema, request serialization, fixture response parsing and strict validation', provider_inference: false, accuracy_measurement: false },
  batches: [1, 8, 32].map(count => {
    const times = samples.filter(x => x.batch_size === count).map(x => x.elapsed_ms);
    return { batch_size: count, n: times.length, p50_ms: percentile(times, 50), p95_ms: percentile(times, 95), mean_ms: times.reduce((a, b) => a + b, 0) / times.length };
  }),
  interpretation: 'These timings measure local wrapper work with fixed gold outputs, not AGY, network latency, model speed, model accuracy, or a Jev comparison. GC/JIT and host load affect results.',
};
await writeFile(join(out, 'samples.jsonl'), samples.map(x => JSON.stringify(x)).join('\n') + '\n');
await writeFile(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ output: out, ...summary }, null, 2));
