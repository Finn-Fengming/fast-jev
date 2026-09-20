#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { cpus, totalmem, release } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { decide } from '../src/decision.mjs';
import { resolveConfig } from '../src/config.mjs';
import { loadSuite, buildBatch, unpackResults, shuffle, sourceHashes, hash } from './lib/suite.mjs';
import { scoreCase, summarize, percentile } from './lib/metrics.mjs';
import { classifyError } from './lib/errors.mjs';
import { publicAgyProbe } from './lib/privacy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  provider: { type: 'string' }, model: { type: 'string' }, config: { type: 'string' },
  'agy-bin': { type: 'string' }, 'base-url': { type: 'string' }, 'response-format': { type: 'string' },
  effort: { type: 'string' }, timeout: { type: 'string', default: '30000' },
  suite: { type: 'string', default: join(root, 'experiments/data/decision-suite.jsonl') },
  split: { type: 'string', default: 'test' }, repeats: { type: 'string', default: '3' },
  limit: { type: 'string' }, seed: { type: 'string', default: '20260920' },
  'batch-size': { type: 'string', default: '1' }, warmup: { type: 'string', default: '1' },
  'max-errors': { type: 'string', default: '3' }, out: { type: 'string' },
  plan: { type: 'boolean' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log(`Run a reproducible real-provider experiment (no mock fallback).
  node experiments/run.mjs --provider agy --split test --repeats 3 --batch-size 1
  --plan                 Freeze a manifest without calling a provider
  --suite FILE           JSONL dataset (default: bundled decision suite)
  --split dev|test|all   Default test; tune on dev, evaluate on frozen test
  --limit N              Explicit subset; recorded in the manifest
  --batch-size N         1–32 independent items per request; default 1
  --warmup N             0–5 excluded requests; failed warmup stops the run
  --max-errors N         Stop after N consecutive measured request failures
  --repeats N            1–10; every case repeated in a seeded shuffled order
  --out DIRECTORY       New directory; existing results are never overwritten
  --model ID --timeout MS --config FILE --effort low|medium|high
  Compatible backends also accept --base-url and --response-format.
Primary quality uses repeat 0; repeated outputs are dependent observations.
agy always starts a fresh process. No credentials or gold labels enter prompts.`);
  process.exit(0);
}
function integer(value, name, min, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer in [${min}, ${max}].`);
  return n;
}
const repeats = integer(values.repeats, 'repeats', 1, 10);
const batchSize = integer(values['batch-size'], 'batch-size', 1, 32);
const warmups = integer(values.warmup, 'warmup', 0, 5);
const seed = integer(values.seed, 'seed', 0, 0xFFFFFFFF);
const maxErrors = integer(values['max-errors'], 'max-errors', 1, 10);
if (!['dev', 'test', 'all'].includes(values.split)) throw new Error('split must be dev, test or all.');
const suite = await loadSuite(resolve(values.suite));
const eligible = suite.cases.filter(item => values.split === 'all' || item.split === values.split);
const limit = values.limit === undefined ? eligible.length : integer(values.limit, 'limit', 1, eligible.length);
const selected = shuffle(eligible, seed).slice(0, limit);
if (!selected.length) throw new Error('No cases match the selected split.');
const backendFlags = Object.fromEntries(['provider', 'model', 'config', 'agy-bin', 'base-url', 'response-format', 'effort', 'timeout'].filter(k => values[k] !== undefined).map(k => [k, values[k]]));
const options = await resolveConfig(backendFlags);
const controller = new AbortController();
for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => controller.abort());
options.signal = controller.signal;
const date = new Date();
const out = resolve(values.out ?? join(root, 'experiments/results', `${date.toISOString().replaceAll(':', '-')}-${options.provider}-b${batchSize}`));
await mkdir(dirname(out), { recursive: true });
await mkdir(out); // Deliberately refuse to replace prior evidence.
const json = (name, data) => writeFile(join(out, name), `${JSON.stringify(data, null, 2)}\n`);
const recordsPath = join(out, 'records.jsonl');
const requestsPath = join(out, 'requests.jsonl');
await writeFile(recordsPath, '', { flag: 'wx' });
await writeFile(requestsPath, '', { flag: 'wx' });
const source = await sourceHashes(root);
let commit = null;
try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* Initial uncommitted repository; hashes remain authoritative. */ }
const order = Array.from({ length: repeats }, (_, repeat) => shuffle(selected, seed + repeat + 1));
const plannedRequests = repeats * Math.ceil(selected.length / batchSize);
if (plannedRequests + warmups > 1000) throw new Error('Request budget exceeds 1000; reduce repeats or increase batch size.');
const snapshot = selected.map(item => JSON.stringify(item)).join('\n') + '\n';
const manifest = {
  schema_version: 1, created_at: date.toISOString(), experiment: 'agy-decision-suite-v1',
  status: values.plan ? 'planned' : 'running', source, git_commit: commit,
  environment: { node: process.version, platform: process.platform, arch: process.arch, os_release: release(), cpu: cpus()[0]?.model ?? null, logical_cpus: cpus().length, memory_gib: Math.round(totalmem() / 2 ** 30) },
  dataset: { filename: 'decision-suite.jsonl', sha256: suite.sha256, snapshot_sha256: hash(snapshot), bytes: suite.bytes, total_cases: suite.cases.length, eligible_cases: eligible.length, selected_cases: selected.length, split: values.split, is_subset: limit < eligible.length, selected_ids: selected.map(x => x.id) },
  backend: { provider: options.provider, requested_model: options.model, effort: options.effort ?? null, response_format: options.responseFormat ?? 'agy-json-schema', timeout_ms: options.timeoutMs, max_tokens: options.maxTokens ?? null, api_key_present: Boolean(options.apiKey), ...(options.provider === 'openai' ? { endpoint_configured: Boolean(options.url) } : {}) },
  protocol: { repeats, batch_size: batchSize, excluded_warmup_requests: warmups, max_consecutive_errors: maxErrors, seed, concurrency: 1, automatic_retries: 0, cache: 'none in fast-jev; upstream cache unknown', process: options.provider === 'agy' ? 'fresh agy process per request' : 'one Node process; fetch connection reuse allowed', planned_measured_requests: plannedRequests, planned_measured_cases: repeats * selected.length, score_tolerance: 0.5, primary_quality: 'repeat 0; backend failures count against end-to-end accuracy, unrun cases do not masquerade as failed predictions', confidence: 'not compared to calibrated probabilities', latency: 'wall clock around decide including build, backend and local validation; request-level percentiles; batch elapsed/N is amortized cost, not individual response latency' },
  order: order.map((items, repeat) => ({ repeat, case_ids: items.map(x => x.id) })),
};
await json('manifest.json', manifest);
// Snapshot labels for audit, separately from the provider-facing request.
await writeFile(join(out, 'cases.jsonl'), snapshot);
const records = [];
const requests = [];
let stopReason = null;
let fatal = null;
const append = async (path, value) => appendFile(path, JSON.stringify(value) + '\n');
async function execute(items, repeat, phase) {
  const { request, mapping } = buildBatch(items);
  const requestId = `r${requests.length}`;
  const started = performance.now();
  let output, failure;
  try { output = await decide(request, options); } catch (error) { failure = classifyError(error); }
  const elapsed = Number((performance.now() - started).toFixed(3));
  const entry = {
    request_id: requestId, phase, repeat, case_ids: items.map(x => x.id), question_count: request.questions.length,
    request_sha256: hash(JSON.stringify(request)), status: failure ? 'error' : 'ok', elapsed_ms: elapsed,
    ...(failure ? { error: failure } : { results: output.results, meta: output.meta }),
  };
  requests.push(entry);
  await append(requestsPath, entry);
  for (const item of items) {
    const result = output ? unpackResults(output.results, mapping, item.id) : null;
    const record = {
      request_id: requestId, phase, repeat, case_id: item.id, category: item.category, language: item.language,
      kind: item.request.questions[0].type, status: entry.status, elapsed_ms: elapsed,
      ...(failure ? { error: failure } : { results: result, score: scoreCase(item, result) }),
    };
    records.push(record);
    await append(recordsPath, record);
  }
  process.stderr.write(`${phase} ${requests.length}: ${entry.status}, ${items.length} case(s), ${elapsed} ms${failure ? `, ${failure.category}` : ''}\n`);
  return entry;
}
const startedRun = performance.now();
try {
  if (!values.plan) {
    if (options.provider === 'agy') {
      const { probeAgy } = await import('../src/agy.mjs');
      try {
        const probe = await probeAgy(options);
        const publicProbe = publicAgyProbe(probe, options.model, options.effort);
        manifest.backend.agy_version = publicProbe.version;
        manifest.backend.requested_model_listed = probe.models.includes(options.model);
        await json('probe.json', publicProbe);
      } catch (error) { manifest.backend.probe_error = classifyError(error); }
      await json('manifest.json', manifest);
    }
    const dev = shuffle(suite.cases.filter(x => x.split === 'dev'), seed);
    for (let n = 0; n < warmups; n++) {
      const pool = dev.length ? dev : selected;
      const entry = await execute(pool.slice(0, Math.min(batchSize, pool.length)), -1 - n, 'warmup');
      if (entry.status !== 'ok') { stopReason = `warmup_${entry.error.category}`; break; }
    }
    let consecutiveErrors = 0;
    outer: for (const [repeat, ordered] of order.entries()) {
      for (let start = 0; start < ordered.length; start += batchSize) {
        if (stopReason || controller.signal.aborted) { stopReason ??= 'canceled'; break outer; }
        const entry = await execute(ordered.slice(start, start + batchSize), repeat, 'measure');
        consecutiveErrors = entry.status === 'ok' ? 0 : consecutiveErrors + 1;
        if (consecutiveErrors >= maxErrors) { stopReason = `consecutive_${entry.error.category}`; break outer; }
      }
    }
  }
} catch (error) {
  fatal = classifyError(error);
  stopReason = 'runner_error';
} finally {
  const seen = new Set(records.filter(x => x.phase === 'measure').map(x => `${x.repeat}/${x.case_id}`));
  for (let repeat = 0; repeat < repeats; repeat++) {
    for (const item of order[repeat]) {
      if (seen.has(`${repeat}/${item.id}`)) continue;
      const record = { phase: 'measure', repeat, case_id: item.id, category: item.category, language: item.language, kind: item.request.questions[0].type, status: 'not_run', elapsed_ms: null, reason: values.plan ? 'plan_only' : stopReason ?? 'interrupted' };
      records.push(record);
      await append(recordsPath, record);
    }
  }
  const measured = requests.filter(x => x.phase === 'measure');
  const ok = measured.filter(x => x.status === 'ok');
  const elapsedSum = measured.reduce((a, x) => a + x.elapsed_ms, 0);
  const times = ok.map(x => x.elapsed_ms);
  const status = values.plan ? 'planned' : stopReason ? (measured.length ? 'partial' : 'blocked') : measured.some(x => x.status !== 'ok') ? 'completed_with_errors' : 'completed';
  const summary = {
    status, stop_reason: stopReason, fatal, elapsed_run_ms: Math.round(performance.now() - startedRun),
    quality: summarize(records, { plannedCases: selected.map(x => x.id), expectedRepeats: repeats }),
    requests: { planned: plannedRequests, attempted: measured.length, successful: ok.length, failed: measured.length - ok.length, not_run: plannedRequests - measured.length, warmup_attempts: requests.filter(x => x.phase === 'warmup').length,
      success_latency_ms: { p50: times.length ? percentile(times, 50) : null, p95: times.length ? percentile(times, 95) : null, mean: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null },
      successful_cases_per_second: elapsedSum ? ok.reduce((a, x) => a + x.case_ids.length, 0) / (elapsedSum / 1000) : null,
      successful_amortized_ms_per_case: ok.length ? ok.reduce((a, x) => a + x.elapsed_ms, 0) / ok.reduce((a, x) => a + x.case_ids.length, 0) : null,
    },
    interpretation: 'Only completed model outputs measure quality. Error timings are not inference latency. External Jev numbers use different datasets and environments, so this run cannot establish superiority. Small synthetic cases and repetitions do not establish production accuracy or calibration.',
  };
  manifest.status = status;
  manifest.finished_at = new Date().toISOString();
  await json('manifest.json', manifest);
  await json('summary.json', summary);
  console.log(JSON.stringify({ output: out, ...summary }, null, 2));
  if (!['completed', 'planned'].includes(status)) process.exitCode = controller.signal.aborted ? 130 : 1;
}
