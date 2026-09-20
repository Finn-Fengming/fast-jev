#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { cpus, totalmem, release } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { decide } from '../src/decision.mjs';
import { loadSuite, buildBatch, unpackResults, shuffle, sourceHashes, hash } from './lib/suite.mjs';
import { scoreCase, summarize } from './lib/metrics.mjs';
import { classifyError } from './lib/errors.mjs';
import { publicAgyProbe } from './lib/privacy.mjs';
import { generateReport } from './report.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const COMPARISON_MODELS = Object.freeze({ agy: 'gemini-3.8-flash-low', jev: 'typesafe/jev-1.13' });
const jsonl = rows => rows.length ? `${rows.map(row => JSON.stringify(row)).join('\n')}\n` : '';
const saveJSON = (path, data) => writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
const appendJSON = (path, data) => appendFile(path, `${JSON.stringify(data)}\n`);
const integer = (value, name, min, max) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer in [${min}, ${max}].`);
  return n;
};

/** Copy only rubric descriptions, never labels or rationales, into native criteria. */
export function batchScoreLevels(items, mapping) {
  const byId = new Map(items.map(item => [item.id, item]));
  const entries = [];
  for (const field of mapping) {
    const item = byId.get(field.case_id);
    const question = item.request.questions.find(q => q.id === field.original_id);
    if (question.type !== 'score') continue;
    const levels = item.score_levels?.[field.original_id];
    if (!Array.isArray(levels) || levels.some(level => typeof level !== 'string' || !level.trim())) {
      throw new Error('Every score question requires explicit score_levels descriptions.');
    }
    entries.push([field.id, [...levels]]);
  }
  return Object.fromEntries(entries);
}

/**
 * One fresh, paired pass. Dependency injection is for offline orchestration tests;
 * the CLI always uses the real adapters and never substitutes fixed predictions.
 */
export async function runComparison(settings = {}, dependencies = {}) {
  const split = settings.split ?? 'test';
  if (!['dev', 'test', 'all'].includes(split)) throw new Error('split must be dev, test or all.');
  const seed = integer(settings.seed ?? 20260920, 'seed', 0, 0xFFFFFFFF);
  const timeoutMs = integer(settings.timeoutMs ?? 30000, 'timeout', 1, 3_600_000);
  const rawBatchSizes = settings.batchSizes ?? [1, 8];
  if (!Array.isArray(rawBatchSizes) || !rawBatchSizes.length) {
    throw new Error('batch sizes must be a nonempty list without duplicates.');
  }
  const batchSizes = rawBatchSizes.map(size => integer(size, 'batch size', 1, 32));
  if (new Set(batchSizes).size !== batchSizes.length) throw new Error('batch sizes must be a nonempty list without duplicates.');
  const plan = settings.plan === true;
  const apiKey = settings.apiKey ?? process.env.OPENAI_API_KEY;
  // Fail before creating evidence directories, and never print credential values.
  if (!plan && (typeof apiKey !== 'string' || !apiKey.trim() || /[\r\n]/.test(apiKey))) {
    throw new Error('Configure a valid OPENAI_API_KEY for OpenRouter before running this comparison.');
  }
  const suite = await loadSuite(resolve(settings.suite ?? join(root, 'experiments/data/decision-suite.jsonl')));
  const eligible = suite.cases.filter(item => split === 'all' || item.split === split);
  const limit = settings.limit === undefined ? eligible.length : integer(settings.limit, 'limit', 1, eligible.length);
  const selected = shuffle(eligible, seed).slice(0, limit);
  if (!selected.length) throw new Error('No cases match the selected split.');
  const ordered = shuffle(selected, seed + 1);
  const dev = shuffle(suite.cases.filter(item => item.split === 'dev'), seed);
  if (!dev.length) throw new Error('Comparison requires development cases for excluded warmups.');
  const plannedCalls = batchSizes.reduce((total, size) => total + 2 * (Math.ceil(selected.length / size) + 1), 0);
  if (plannedCalls > 1000) throw new Error('Comparison exceeds the 1000-request budget.');
  const native = dependencies.callJev && dependencies.buildJevRequest
    ? dependencies : await import('./lib/jev-openrouter.mjs');
  const callJev = dependencies.callJev ?? native.callJev;
  const buildJevRequest = dependencies.buildJevRequest ?? native.buildJevRequest;
  const callAgy = dependencies.callAgy ?? decide;
  const probe = dependencies.probeAgy ?? (async options => (await import('../src/agy.mjs')).probeAgy(options));
  const generateComparisonReport = dependencies.generateComparisonReport
    ?? (async directory => (await import('./compare-report.mjs')).generateComparisonReport(directory));
  const onProgress = dependencies.onProgress ?? (message => process.stderr.write(`${message}\n`));
  // Validate all native mappings before creating artifacts or making any call.
  for (const batchSize of batchSizes) {
    for (const items of [dev.slice(0, batchSize), ...Array.from({ length: Math.ceil(ordered.length / batchSize) }, (_, index) => ordered.slice(index * batchSize, (index + 1) * batchSize))]) {
      const built = buildBatch(items);
      buildJevRequest(built.request, { model: COMPARISON_MODELS.jev, scoreLevels: batchScoreLevels(items, built.mapping) });
    }
  }
  const created = new Date().toISOString();
  const out = resolve(settings.out ?? join(root, 'experiments/results', `paired-jev-agy-${created.replaceAll(':', '-')}`));
  const source = await sourceHashes(root);
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* File hashes remain authoritative. */ }
  const environment = { node: process.version, platform: process.platform, arch: process.arch, os_release: release(), cpu: cpus()[0]?.model ?? null, logical_cpus: cpus().length, memory_gib: Math.round(totalmem() / 2 ** 30) };
  const snapshot = jsonl(selected);
  const dataset = { filename: 'decision-suite.jsonl', sha256: suite.sha256, snapshot_sha256: hash(snapshot), bytes: suite.bytes, total_cases: suite.cases.length, eligible_cases: eligible.length, selected_cases: selected.length, split, is_subset: limit < eligible.length, selected_ids: selected.map(item => item.id) };
  const commonProtocol = {
    repeats: 1, excluded_warmup_requests: 1, max_consecutive_errors: 3, seed,
    concurrency: 1, automatic_retries: 0, score_tolerance: 0.5,
    primary_quality: 'One measured repeat; backend failures count against end-to-end accuracy; unrun cases remain visible.',
    cache: 'none in fast-jev; upstream cache unknown',
    schedule: 'Paired serial requests on identical cases, alternating AGY/Jev then Jev/AGY across pairs, including warmups.',
    latency: 'Wall clock around the complete adapter call: input validation, provider request construction, transport/process startup, parsing and result validation; canonical batch construction, warmup, probing and artifact writes excluded. Batch elapsed/N is amortized cost, not individual response latency.',
    boolean_threshold: 'Jev noul >= 0.5 becomes true; no confidence gating.',
    score_conversion: 'Native Jev score is retained without rounding; both backends use absolute error <= 0.5 plus separate MAE and exact match.',
    dataset_disclosure: 'Previously observed, frozen synthetic test cases; this is a fresh measurement, not a new blind holdout.',
  };
  const comparisonManifest = {
    schema_version: 1, experiment: 'paired-jev-agy-v1', created_at: created,
    status: plan ? 'planned' : 'running', source, git_commit: commit, environment, dataset,
    models: COMPARISON_MODELS, protocol: { ...commonProtocol, batch_sizes: batchSizes, planned_total_requests_including_warmup: plannedCalls },
    runs: [], schedule: [],
  };
  const warmupSnapshot = jsonl(dev.slice(0, Math.max(...batchSizes)));
  comparisonManifest.warmup_snapshot_sha256 = hash(warmupSnapshot);
  let plannedPair = 0;
  for (const batchSize of batchSizes) {
    const batches = [
      { phase: 'warmup', items: dev.slice(0, batchSize) },
      ...Array.from({ length: Math.ceil(ordered.length / batchSize) }, (_, index) => ({ phase: 'measure', items: ordered.slice(index * batchSize, (index + 1) * batchSize) })),
    ];
    for (const [index, { phase, items }] of batches.entries()) {
      const { request, mapping } = buildBatch(items);
      const providerOrder = plannedPair % 2 === 0 ? ['agy', 'jev'] : ['jev', 'agy'];
      for (const backend of providerOrder) {
        comparisonManifest.schedule.push({
          sequence_index: comparisonManifest.schedule.length, pair_index: plannedPair,
          backend_order: providerOrder, directory: `b${batchSize}/${backend}`, backend, batch_size: batchSize,
          request_id: `r${index}`, phase, case_ids: items.map(item => item.id),
          request_sha256: hash(JSON.stringify(request)),
          ...(backend === 'jev' ? { wire_request_sha256: hash(JSON.stringify(buildJevRequest(request, { model: COMPARISON_MODELS.jev, scoreLevels: batchScoreLevels(items, mapping) }))) } : {}),
        });
      }
      plannedPair += 1;
    }
  }
  await mkdir(dirname(out), { recursive: true });
  await mkdir(out); // Never replace an earlier run.
  await writeFile(join(out, 'sequence.jsonl'), '', { flag: 'wx' });
  await writeFile(join(out, 'warmup-cases.jsonl'), warmupSnapshot);
  const contexts = [];
  for (const batchSize of batchSizes) {
    for (const backend of ['agy', 'jev']) {
      const relative = `b${batchSize}/${backend}`;
      const path = join(out, relative);
      await mkdir(path, { recursive: true });
      const manifest = {
        schema_version: 1, experiment: 'paired-jev-agy-v1', created_at: created,
        status: plan ? 'planned' : 'running', source, git_commit: commit, environment, dataset,
        backend: { provider: backend, requested_model: COMPARISON_MODELS[backend], effort: null, response_format: backend === 'agy' ? 'agy-json-schema' : 'native-decisions', timeout_ms: timeoutMs, max_tokens: null, api_key_present: backend === 'jev' && Boolean(apiKey), ...(backend === 'jev' ? { endpoint: 'https://openrouter.ai/api/alpha/decisions' } : {}) },
        protocol: { ...commonProtocol, batch_size: batchSize, planned_measured_requests: Math.ceil(selected.length / batchSize), planned_measured_cases: selected.length, process: backend === 'agy' ? 'fresh agy process per request' : 'one Node process; fetch connection reuse allowed' },
        order: [{ repeat: 0, case_ids: ordered.map(item => item.id) }],
      };
      await saveJSON(join(path, 'manifest.json'), manifest);
      await writeFile(join(path, 'cases.jsonl'), snapshot);
      await writeFile(join(path, 'records.jsonl'), '', { flag: 'wx' });
      await writeFile(join(path, 'requests.jsonl'), '', { flag: 'wx' });
      const context = { path, relative, backend, batchSize, manifest, records: [], requests: [] };
      contexts.push(context);
      comparisonManifest.runs.push({ directory: relative, backend, batch_size: batchSize });
    }
  }
  await saveJSON(join(out, 'manifest.json'), comparisonManifest);
  const signal = settings.signal;
  const agyOptions = { provider: 'agy', model: COMPARISON_MODELS.agy, agyBin: 'agy', timeoutMs, signal };
  let stopReason = null;
  let fatal = null;
  let pairIndex = 0;
  let sequenceIndex = 0;
  const consecutiveErrors = { agy: 0, jev: 0 };
  const runStarted = performance.now();

  async function execute(context, items, phase, providerOrder) {
    const { request, mapping } = buildBatch(items);
    const scoreLevels = batchScoreLevels(items, mapping);
    const requestId = `r${context.requests.length}`;
    const wireHash = context.backend === 'jev'
      ? hash(JSON.stringify(buildJevRequest(request, { model: COMPARISON_MODELS.jev, scoreLevels }))) : undefined;
    const startedAt = new Date().toISOString();
    const started = performance.now();
    let output, failure;
    try {
      output = context.backend === 'agy'
        ? await callAgy(request, agyOptions)
        : await callJev(request, { apiKey, model: COMPARISON_MODELS.jev, timeoutMs, signal, scoreLevels });
      if (context.backend === 'jev' && output.native?.wire_request_sha256 !== wireHash) {
        throw new Error('Native adapter returned an inconsistent wire request hash.');
      }
    } catch (error) { failure = classifyError(error); }
    const ended = performance.now();
    const finishedAt = new Date().toISOString();
    const elapsed = Number((ended - started).toFixed(3));
    const repeat = phase === 'warmup' ? -1 : 0;
    const entry = {
      request_id: requestId, phase, repeat, pair_index: pairIndex, sequence_index: sequenceIndex,
      started_at: startedAt, finished_at: finishedAt,
      start_offset_ms: Number((started - runStarted).toFixed(3)), end_offset_ms: Number((ended - runStarted).toFixed(3)),
      case_ids: items.map(item => item.id), question_count: request.questions.length,
      request_sha256: hash(JSON.stringify(request)), ...(wireHash ? { wire_request_sha256: wireHash } : {}),
      status: failure ? 'error' : 'ok', elapsed_ms: elapsed,
      ...(failure ? { error: failure } : { results: output.results, meta: output.meta, ...(context.backend === 'jev' ? { native: output.native } : {}) }),
    };
    context.requests.push(entry);
    await appendJSON(join(context.path, 'requests.jsonl'), entry);
    for (const item of items) {
      const result = !failure ? unpackResults(output.results, mapping, item.id) : null;
      const record = {
        request_id: requestId, phase, repeat, case_id: item.id, category: item.category,
        language: item.language, kind: item.request.questions[0].type, status: entry.status, elapsed_ms: elapsed,
        ...(failure ? { error: failure } : { results: result, score: scoreCase(item, result) }),
      };
      context.records.push(record);
      await appendJSON(join(context.path, 'records.jsonl'), record);
    }
    await appendJSON(join(out, 'sequence.jsonl'), {
      sequence_index: sequenceIndex++, pair_index: pairIndex, backend_order: providerOrder,
      directory: context.relative, backend: context.backend, batch_size: context.batchSize,
      request_id: requestId, phase, started_at: startedAt, finished_at: finishedAt,
      start_offset_ms: entry.start_offset_ms, end_offset_ms: entry.end_offset_ms, case_ids: entry.case_ids,
      status: entry.status, elapsed_ms: elapsed, request_sha256: entry.request_sha256,
      ...(wireHash ? { wire_request_sha256: wireHash } : {}),
    });
    if (phase === 'measure') consecutiveErrors[context.backend] = failure ? consecutiveErrors[context.backend] + 1 : 0;
    onProgress(`${phase} pair ${pairIndex + 1} ${context.relative}: ${entry.status}, ${items.length} case(s), ${elapsed} ms${failure ? `, ${failure.category}` : ''}`);
    return entry;
  }

  try {
    if (!plan) {
      try {
        const result = await probe(agyOptions);
        const publicProbe = publicAgyProbe(result, COMPARISON_MODELS.agy);
        for (const context of contexts.filter(context => context.backend === 'agy')) {
          context.manifest.backend.agy_version = publicProbe.version;
          context.manifest.backend.requested_model_listed = publicProbe.models.includes(COMPARISON_MODELS.agy);
          await saveJSON(join(context.path, 'probe.json'), publicProbe);
        }
      } catch (error) {
        for (const context of contexts.filter(context => context.backend === 'agy')) context.manifest.backend.probe_error = classifyError(error);
      }
      outer: for (const batchSize of batchSizes) {
        const modeContexts = contexts.filter(context => context.batchSize === batchSize);
        const batches = [
          { phase: 'warmup', items: dev.slice(0, Math.min(batchSize, dev.length)) },
          ...Array.from({ length: Math.ceil(ordered.length / batchSize) }, (_, index) => ({ phase: 'measure', items: ordered.slice(index * batchSize, (index + 1) * batchSize) })),
        ];
        for (const { phase, items } of batches) {
          const providerOrder = pairIndex % 2 === 0 ? ['agy', 'jev'] : ['jev', 'agy'];
          for (const backend of providerOrder) {
            if (signal?.aborted) { stopReason = 'canceled'; break outer; }
            const context = modeContexts.find(item => item.backend === backend);
            const entry = await execute(context, items, phase, providerOrder);
            if (phase === 'warmup' && entry.status === 'error') stopReason = `warmup_${backend}_${entry.error.category}`;
            if (phase === 'measure' && consecutiveErrors[backend] >= 3) stopReason = `consecutive_${backend}_${entry.error.category}`;
            if (stopReason) break outer;
          }
          pairIndex += 1;
        }
      }
    }
  } catch (error) {
    fatal = classifyError(error);
    stopReason = 'runner_error';
  } finally {
    for (const context of contexts) {
      const seen = new Set(context.records.filter(record => record.phase === 'measure').map(record => record.case_id));
      for (const item of ordered) {
        if (seen.has(item.id)) continue;
        const record = { phase: 'measure', repeat: 0, case_id: item.id, category: item.category, language: item.language, kind: item.request.questions[0].type, status: 'not_run', elapsed_ms: null, reason: plan ? 'plan_only' : stopReason ?? 'interrupted' };
        context.records.push(record);
        await appendJSON(join(context.path, 'records.jsonl'), record);
      }
      const measured = context.requests.filter(request => request.phase === 'measure');
      const complete = seen.size === selected.length;
      const status = plan ? 'planned' : !measured.length ? 'blocked' : !complete ? 'partial' : measured.some(request => request.status === 'error') ? 'completed_with_errors' : 'completed';
      context.manifest.status = status;
      context.manifest.finished_at = new Date().toISOString();
      await saveJSON(join(context.path, 'manifest.json'), context.manifest);
      const report = await generateReport(context.path);
      context.report = report;
      await saveJSON(join(context.path, 'summary.json'), {
        status, stop_reason: !complete && !plan ? stopReason : null, fatal,
        quality: summarize(context.records, { plannedCases: selected, expectedRepeats: 1 }),
        requests: report.requests,
        interpretation: 'One measurement on frozen synthetic cases. Compare end-to-end integration paths on matched cases; this does not isolate model compute or establish production accuracy.',
      });
    }
    const anyMeasured = contexts.some(context => context.requests.some(request => request.phase === 'measure'));
    comparisonManifest.status = plan ? 'planned' : stopReason ? (anyMeasured ? 'partial' : 'blocked') : contexts.some(context => context.report.status !== 'completed') ? 'completed_with_errors' : 'completed';
    comparisonManifest.finished_at = new Date().toISOString();
    comparisonManifest.stop_reason = stopReason;
    comparisonManifest.fatal = fatal;
    comparisonManifest.elapsed_run_ms = Math.round(performance.now() - runStarted);
    await saveJSON(join(out, 'manifest.json'), comparisonManifest);
  }
  const comparison = await generateComparisonReport(out);
  return { directory: out, ...comparison };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  for (const event of ['SIGINT', 'SIGTERM']) process.once(event, () => controller.abort());
  try {
    const { values } = parseArgs({ options: {
      split: { type: 'string', default: 'test' }, limit: { type: 'string' },
      'batch-sizes': { type: 'string', default: '1,8' }, seed: { type: 'string', default: '20260920' },
      timeout: { type: 'string', default: '30000' }, out: { type: 'string' },
      plan: { type: 'boolean' }, help: { type: 'boolean' },
    } });
    if (values.help) {
      console.log(`Compare local AGY and OpenRouter Jev on the same frozen cases.
  node experiments/compare.mjs --out experiments/results/my-jev-agy
  --plan                 Save the full schedule without credentials or inference
  --split dev|test|all    Default test (all 64 frozen test cases)
  --limit N              Explicit subset, recorded in every manifest
  --batch-sizes 1,8       One pass per backend and mode; default 1,8
  --seed 20260920         Seeded identical case order for both backends
  --timeout 30000        Equal per-request timeout in milliseconds
  --out DIRECTORY        New directory; existing evidence is never overwritten
Requires a working local agy and OPENAI_API_KEY configured for OpenRouter.
Fixed models: ${COMPARISON_MODELS.agy} and ${COMPARISON_MODELS.jev}.
Serial paired requests alternate backend order; one dev warmup per mode/backend.
No retries. Stop after a failed warmup or three consecutive errors per backend.`);
    } else {
      const result = await runComparison({ split: values.split, limit: values.limit, batchSizes: values['batch-sizes'].split(',').map(Number), seed: values.seed, timeoutMs: values.timeout, out: values.out, plan: values.plan, signal: controller.signal });
      console.log(JSON.stringify(result, null, 2));
      if (!['planned', 'completed'].includes(result.status)) process.exitCode = controller.signal.aborted ? 130 : 1;
    }
  } catch (error) {
    // Filesystem and argument errors may embed private paths or user-provided text.
    console.error(error?.code === 'EEXIST'
      ? 'Output directory already exists. Choose a new --out directory.'
      : 'Comparison could not start or finish. Check arguments, OPENAI_API_KEY, required files and output permissions; use --help for usage.');
    process.exitCode = controller.signal.aborted ? 130 : 1;
  }
}
