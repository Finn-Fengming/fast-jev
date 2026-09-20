#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { generateReport } from './report.mjs';
import { buildBatch, hash, loadSuite } from './lib/suite.mjs';
import { percentile } from './lib/metrics.mjs';
import { buildJevRequest, normalizeJevAnswers } from './lib/jev-openrouter.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = message => { throw new Error(`Invalid paired comparison artifacts: ${message}`); };
const ensure = (condition, message) => { if (!condition) fail(message); };
const nonnegative = value => Number.isFinite(value) && value >= 0;
const equal = (a, b) => isDeepStrictEqual(a, b);
const jsonl = (bytes, name) => bytes.toString('utf8').split(/\r?\n/).flatMap(line => {
  if (!line.trim()) return [];
  try { return [JSON.parse(line)]; } catch { fail(`${name} contains invalid JSON.`); }
});
const readJson = async path => {
  const bytes = await readFile(path);
  try { return { value: JSON.parse(bytes.toString('utf8')), bytes }; }
  catch { fail('a JSON artifact cannot be parsed.'); }
};
const stats = rows => {
  const values = rows.map(row => row.elapsed_ms);
  return {
    sample_count: values.length,
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    p50: percentile(values, 50), p95: percentile(values, 95),
  };
};
const ratio = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null;
const number = (value, digits = 2) => value === null || value === undefined ? 'N/A' : Number(value).toFixed(digits);
const rate = value => value === null || value === undefined ? 'N/A' : `${number(value * 100)}%`;

function scoreLevels(items, mapping) {
  const byId = new Map(items.map(item => [item.id, item]));
  return Object.fromEntries(mapping.flatMap(item => {
    const levels = byId.get(item.case_id).score_levels?.[item.original_id];
    return levels ? [[item.id, levels]] : [];
  }));
}

function renderMarkdown(report) {
  const lines = [
    '# Matched AGY versus native Jev comparison', '',
    `Status: ${report.status}. Metrics were recomputed from frozen labels and raw typed answers.`, '',
    `UTC clock warnings: ${report.integrity.clock_warnings.length}; monotonic timing remains authoritative for elapsed time and serial execution checks.`, '',
    'The two pathways use the same cases, question order and batch grouping. Calls are sequential and paired; backend order alternates. Warmups are excluded.', '',
    '## Quality (first measured repeat)', '',
    '| Mode | Backend | Correct / attempted | Valid / attempted | Successful-response accuracy | Attempted case coverage | Score MAE | Score exact match |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const [mode, value] of Object.entries(report.modes)) {
    for (const backend of ['agy', 'jev']) {
      const quality = value.backends[backend].quality;
      const q = quality.primary;
      lines.push(`| ${mode} | ${backend} | ${q.correct_count}/${q.attempted_count} (${rate(q.end_to_end_correct_rate)}) | ${q.valid_count}/${q.attempted_count} (${rate(q.valid_rate)}) | ${rate(q.observed_success_accuracy)} | ${quality.coverage.attempted_case_count}/${quality.coverage.planned_case_count} | ${number(q.score_mae, 4)} | ${rate(q.score_exact_match)} |`);
    }
  }
  lines.push('', 'Backend failures count as incorrect in end-to-end accuracy. Unrun cases remain visible through coverage and are excluded from attempted denominators. Continuous Jev scores are not rounded; score correctness uses absolute error ≤ 0.5.', '',
    '## Request latency (milliseconds)', '',
    '| Mode | Backend | Success / attempted / planned | Success p50 | Success p95 | Success mean | All-attempt p50 | All-attempt p95 | Amortized successful ms/case |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [mode, value] of Object.entries(report.modes)) {
    for (const backend of ['agy', 'jev']) {
      const r = value.backends[backend].requests;
      lines.push(`| ${mode} | ${backend} | ${r.successful}/${r.attempted}/${r.planned} | ${number(r.success_latency_ms.p50)} | ${number(r.success_latency_ms.p95)} | ${number(r.success_latency_ms.mean)} | ${number(r.all_attempt_latency_ms.p50)} | ${number(r.all_attempt_latency_ms.p95)} | ${number(r.successful_amortized_ms_per_case)} |`);
    }
  }
  lines.push('', 'A batch request is one latency sample. Amortized time is request time divided by case count, **not individual response latency**. Successful and all-attempt latency use their own sample counts; failed timings are not successful inference latency.', '',
    '## Same-mode speed ratios', '',
    '| Mode | AGY/Jev successful p50 | AGY/Jev successful mean | Both-success pairs | Median paired AGY/Jev ratio |',
    '| --- | ---: | ---: | ---: | ---: |');
  for (const [mode, value] of Object.entries(report.modes)) {
    const r = value.speed_ratio;
    lines.push(`| ${mode} | ${number(r.success_p50_agy_over_jev)} | ${number(r.success_mean_agy_over_jev)} | ${r.matched_success_pair_count} | ${number(r.median_paired_agy_over_jev)} |`);
  }
  lines.push('', 'A ratio above 1 means AGY took longer than Jev; below 1 means AGY was faster. Ratios compare the same batch mode only, and do not isolate model compute from transport/process overhead.', '',
    '## Quality breakdowns (first measured repeat)', '',
    '| Mode | Group | Value | Backend | Correct / attempted | Valid rate | Score MAE | Score exact match |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: |');
  for (const [mode, value] of Object.entries(report.modes)) {
    for (const grouping of ['by_category', 'by_language', 'by_kind']) {
      for (const backend of ['agy', 'jev']) {
        for (const [label, q] of Object.entries(value.backends[backend].quality[grouping])) {
          lines.push(`| ${mode} | ${grouping} | ${label} | ${backend} | ${q.correct_count}/${q.attempted_count} (${rate(q.end_to_end_correct_rate)}) | ${rate(q.valid_rate)} | ${number(q.score_mae, 4)} | ${rate(q.score_exact_match)} |`);
        }
      }
    }
  }
  lines.push('', 'Native Jev probabilities and AGY self-reported confidence are not compared. The fixed synthetic cases have been observed previously; this is not an unseen benchmark or evidence of general production superiority. Repeated/template-related cases are not independent population samples. N/A indicates absent observations.', '',
    'Artifact checks establish internal consistency, not independent provenance or tamper-proof timestamps. Source and artifact hashes, coverage, failure counts and all computed metrics are available in `comparison.json`.', '');
  return lines.join('\n');
}

/** Recompute metrics and verify the paired schedule without any provider calls. */
export async function generateComparisonReport(directory) {
  const path = resolve(directory);
  const { value: manifest, bytes: manifestBytes } = await readJson(join(path, 'manifest.json'));
  ensure(manifest?.schema_version === 1 && manifest.experiment === 'paired-jev-agy-v1', 'unsupported manifest schema.');
  ensure(manifest.source?.files && typeof manifest.source.files === 'object' && !Array.isArray(manifest.source.files)
    && Object.values(manifest.source.files).every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))
    && manifest.source.sha256 === hash(JSON.stringify(manifest.source.files)), 'recorded source hash is inconsistent.');
  ensure(manifest.protocol?.repeats === 1 && manifest.protocol.concurrency === 1
    && manifest.protocol.automatic_retries === 0 && manifest.protocol.excluded_warmup_requests === 1,
  'comparison requires one serial measured repeat, one warmup and no retries.');
  const sizes = manifest.protocol.batch_sizes;
  ensure(Array.isArray(sizes) && sizes.length > 0 && new Set(sizes).size === sizes.length
    && sizes.every(size => Number.isInteger(size) && size > 0 && size <= 32), 'invalid batch modes.');
  ensure(manifest.models?.agy === 'gemini-3.8-flash-low' && manifest.models?.jev === 'typesafe/jev-1.13', 'unexpected comparison model.');
  const expectedRuns = sizes.flatMap(batch_size => ['agy', 'jev'].map(backend => ({ directory: `b${batch_size}/${backend}`, backend, batch_size })));
  ensure(equal(manifest.runs, expectedRuns), 'run directories do not match the paired modes.');
  const warmupBytes = await readFile(join(path, 'warmup-cases.jsonl'));
  ensure(manifest.warmup_snapshot_sha256 === hash(warmupBytes), 'warmup snapshot SHA-256 mismatch.');
  const { cases: warmupCases } = await loadSuite(join(path, 'warmup-cases.jsonl'));
  ensure(warmupCases.every(item => item.split === 'dev'), 'warmup must use development cases.');
  ensure(warmupCases.length <= Math.max(...sizes), 'warmup snapshot exceeds the largest batch.');
  const sequenceBytes = await readFile(join(path, 'sequence.jsonl'));
  const sequence = jsonl(sequenceBytes, 'sequence.jsonl');
  const children = new Map();
  let commonSnapshot = null;
  let commonOrder = null;
  const artifactHashes = { 'manifest.json': hash(manifestBytes), 'warmup-cases.jsonl': hash(warmupBytes), 'sequence.jsonl': hash(sequenceBytes) };
  for (const run of expectedRuns) {
    const childPath = join(path, run.directory);
    const { value: child, bytes: childBytes } = await readJson(join(childPath, 'manifest.json'));
    const snapshot = await readFile(join(childPath, 'cases.jsonl'));
    const requestBytes = await readFile(join(childPath, 'requests.jsonl'));
    const requests = jsonl(requestBytes, 'requests.jsonl');
    const { cases } = await loadSuite(join(childPath, 'cases.jsonl'));
    ensure(equal(child.dataset, manifest.dataset), 'backend dataset metadata differs from the comparison.');
    ensure(equal(child.source, manifest.source) && child.git_commit === manifest.git_commit, 'backend source snapshots differ.');
    ensure(child.backend?.provider === run.backend && child.backend.requested_model === manifest.models[run.backend], 'backend identity differs from its run.');
    ensure(child.protocol?.batch_size === run.batch_size && child.protocol.repeats === 1
      && child.protocol.excluded_warmup_requests === 1 && child.protocol.concurrency === 1
      && child.protocol.automatic_retries === 0 && child.protocol.seed === manifest.protocol.seed,
    'backend schedule settings differ.');
    ensure(child.backend.timeout_ms > 0 && child.backend.timeout_ms === (children.values().next().value?.manifest.backend.timeout_ms ?? child.backend.timeout_ms), 'backend timeouts differ.');
    if (commonSnapshot === null) commonSnapshot = snapshot;
    else ensure(snapshot.equals(commonSnapshot), 'backend case snapshots differ.');
    if (commonOrder === null) commonOrder = child.order;
    else ensure(equal(child.order, commonOrder), 'backend case order differs.');
    ensure(Array.isArray(child.order) && child.order.length === 1 && child.order[0].repeat === 0, 'invalid measured case order.');
    const byId = new Map(cases.map(item => [item.id, item]));
    ensure(Array.isArray(child.order[0].case_ids) && child.order[0].case_ids.length === cases.length
      && new Set(child.order[0].case_ids).size === cases.length && child.order[0].case_ids.every(id => byId.has(id)), 'measured order must include every case exactly once.');
    const ordered = child.order[0].case_ids.map(id => byId.get(id));
    const batches = [
      { phase: 'warmup', items: warmupCases.slice(0, run.batch_size) },
      ...Array.from({ length: Math.ceil(ordered.length / run.batch_size) }, (_, index) => ({ phase: 'measure', items: ordered.slice(index * run.batch_size, (index + 1) * run.batch_size) })),
    ];
    const context = { ...run, path: childPath, manifest: child, cases, requests, batches };
    children.set(run.directory, context);
    artifactHashes[`${run.directory}/manifest.json`] = hash(childBytes);
    artifactHashes[`${run.directory}/cases.jsonl`] = hash(snapshot);
    artifactHashes[`${run.directory}/requests.jsonl`] = hash(requestBytes);
    artifactHashes[`${run.directory}/records.jsonl`] = hash(await readFile(join(childPath, 'records.jsonl')));
  }
  const schedule = [];
  let pairIndex = 0;
  for (const batchSize of sizes) {
    const context = children.get(`b${batchSize}/agy`);
    for (const [index, batch] of context.batches.entries()) {
      const backendOrder = pairIndex % 2 === 0 ? ['agy', 'jev'] : ['jev', 'agy'];
      const built = buildBatch(batch.items);
      for (const backend of backendOrder) {
        const wireHash = backend === 'jev' ? hash(JSON.stringify(buildJevRequest(built.request, {
          model: manifest.models.jev, scoreLevels: scoreLevels(batch.items, built.mapping),
        }))) : undefined;
        schedule.push({
          sequence_index: schedule.length, pair_index: pairIndex, backend_order: backendOrder,
          directory: `b${batchSize}/${backend}`, backend, batch_size: batchSize,
          request_id: `r${index}`, phase: batch.phase, case_ids: batch.items.map(item => item.id),
          request_sha256: hash(JSON.stringify(built.request)),
          ...(wireHash ? { wire_request_sha256: wireHash } : {}),
        });
      }
      pairIndex += 1;
    }
  }
  ensure(equal(manifest.schedule, schedule), 'frozen schedule does not match cases, grouping or alternating backend order.');
  ensure(manifest.protocol.planned_total_requests_including_warmup === schedule.length, 'planned call count differs from schedule.');
  ensure(sequence.length <= schedule.length, 'more sequence calls than planned.');
  const seen = new Set();
  const clockWarnings = [];
  let previous = null;
  const created = Date.parse(manifest.created_at);
  const finished = Date.parse(manifest.finished_at);
  ensure(Number.isFinite(created) && Number.isFinite(finished) && finished >= created, 'invalid overall UTC timestamps.');
  ensure(nonnegative(manifest.elapsed_run_ms), 'invalid run duration.');
  for (const [index, entry] of sequence.entries()) {
    const scheduled = schedule[index];
    for (const key of Object.keys(scheduled)) ensure(equal(entry[key], scheduled[key]), 'sequence is not the complete prefix of the frozen schedule.');
    const context = children.get(entry.directory);
    const matches = context.requests.filter(request => request.request_id === entry.request_id);
    ensure(matches.length === 1, 'sequence request is missing or duplicated.');
    const request = matches[0];
    for (const key of ['request_id', 'phase', 'case_ids', 'request_sha256', 'sequence_index', 'pair_index', 'status', 'elapsed_ms', 'started_at', 'finished_at', 'start_offset_ms', 'end_offset_ms']) {
      ensure(equal(request[key], entry[key]), 'sequence and backend request evidence differ.');
    }
    ensure(['ok', 'error'].includes(entry.status) && nonnegative(entry.elapsed_ms), 'invalid request outcome or elapsed time.');
    ensure(nonnegative(entry.start_offset_ms) && nonnegative(entry.end_offset_ms)
      && entry.end_offset_ms >= entry.start_offset_ms, 'negative or invalid monotonic timestamps.');
    ensure(Math.abs(entry.end_offset_ms - entry.start_offset_ms - entry.elapsed_ms) <= 0.01, 'monotonic duration differs from elapsed time.');
    ensure(entry.end_offset_ms <= manifest.elapsed_run_ms + 2, 'request exceeds the recorded run duration.');
    const start = Date.parse(entry.started_at);
    const end = Date.parse(entry.finished_at);
    ensure(Number.isFinite(start) && Number.isFinite(end) && end >= start && start >= created && end <= finished, 'invalid request UTC timestamps.');
    if (Math.abs(end - start - entry.elapsed_ms) > 3) clockWarnings.push({ sequence_index: index, kind: 'utc_duration_differs_from_monotonic' });
    if (previous) {
      ensure(entry.start_offset_ms >= previous.end_offset_ms, 'requests overlap or run out of sequence.');
      if (start < Date.parse(previous.finished_at)) clockWarnings.push({ sequence_index: index, kind: 'utc_sequence_moves_backwards' });
      if (Math.abs(start - Date.parse(previous.started_at) - (entry.start_offset_ms - previous.start_offset_ms)) > 3) clockWarnings.push({ sequence_index: index, kind: 'utc_sequence_differs_from_monotonic' });
    }
    previous = entry;
    const requestKey = `${entry.directory}/${entry.request_id}`;
    ensure(!seen.has(requestKey), 'duplicate sequence request.');
    seen.add(requestKey);
    const items = context.batches[Number(entry.request_id.slice(1))].items;
    const built = buildBatch(items);
    ensure(request.repeat === (entry.phase === 'warmup' ? -1 : 0), 'invalid request repeat.');
    ensure(request.question_count === built.request.questions.length, 'request question count differs from logical input.');
    if (entry.backend === 'jev') {
      const wire = buildJevRequest(built.request, { model: context.manifest.backend.requested_model, scoreLevels: scoreLevels(items, built.mapping) });
      const expectedHash = hash(JSON.stringify(wire));
      ensure(request.wire_request_sha256 === expectedHash, 'native wire request SHA-256 mismatch.');
      if (request.status === 'ok') {
        ensure(request.native?.wire_request_sha256 === expectedHash, 'returned native wire request SHA-256 mismatch.');
        let normalized;
        try { normalized = normalizeJevAnswers(built.request, { answers: request.native.answers }); }
        catch { fail('native Jev answers are invalid.'); }
        ensure(equal(normalized, request.results), 'native Jev answers do not match normalized results.');
      } else ensure(request.native === undefined, 'failed request cannot contain successful native answers.');
    }
  }
  ensure([...children.values()].reduce((total, context) => total + context.requests.length, 0) === sequence.length, 'backend requests are missing from the paired sequence.');
  if (manifest.status === 'planned') ensure(sequence.length === 0, 'planned comparison contains executed calls.');
  if (sequence.length < schedule.length && manifest.status !== 'planned') ensure(typeof manifest.stop_reason === 'string' && manifest.stop_reason.length > 0, 'partial sequence requires an explicit stop reason.');

  const modes = {};
  for (const size of sizes) {
    const backends = {};
    for (const backend of ['agy', 'jev']) {
      const context = children.get(`b${size}/${backend}`);
      const report = await generateReport(context.path);
      const measured = context.requests.filter(request => request.phase === 'measure');
      backends[backend] = {
        status: report.status,
        requested_model: context.manifest.backend.requested_model,
        quality: report.quality,
        requests: { ...report.requests, all_attempt_latency_ms: stats(measured) },
      };
    }
    const agy = children.get(`b${size}/agy`).requests.filter(request => request.phase === 'measure');
    const jevByPair = new Map(children.get(`b${size}/jev`).requests.filter(request => request.phase === 'measure').map(request => [request.pair_index, request]));
    const pairRatios = agy.flatMap(request => {
      const jev = jevByPair.get(request.pair_index);
      const value = jev?.status === 'ok' && request.status === 'ok' ? ratio(request.elapsed_ms, jev.elapsed_ms) : null;
      return value === null ? [] : [value];
    });
    const a = backends.agy.requests;
    const j = backends.jev.requests;
    modes[`b${size}`] = {
      batch_size: size, backends,
      speed_ratio: {
        definition: 'AGY elapsed time divided by Jev elapsed time, within the same batch mode; above 1 means AGY took longer.',
        success_p50_agy_over_jev: ratio(a.success_latency_ms.p50, j.success_latency_ms.p50),
        success_p95_agy_over_jev: ratio(a.success_latency_ms.p95, j.success_latency_ms.p95),
        success_mean_agy_over_jev: ratio(a.success_latency_ms.mean, j.success_latency_ms.mean),
        all_attempt_p50_agy_over_jev: ratio(a.all_attempt_latency_ms.p50, j.all_attempt_latency_ms.p50),
        matched_success_pair_count: pairRatios.length,
        median_paired_agy_over_jev: percentile(pairRatios, 50),
      },
    };
  }
  const failures = sequence.filter(entry => entry.status === 'error').length;
  const status = manifest.status === 'planned' ? 'planned' : sequence.length < schedule.length ? (sequence.some(entry => entry.phase === 'measure') ? 'partial' : 'blocked') : failures ? 'completed_with_errors' : 'completed';
  const evaluatorFiles = {};
  for (const name of ['experiments/compare-report.mjs', 'experiments/report.mjs', 'experiments/lib/jev-openrouter.mjs', 'experiments/lib/suite.mjs', 'experiments/lib/metrics.mjs']) evaluatorFiles[name] = hash(await readFile(join(root, name)));
  const report = {
    schema_version: 1, generated_at: new Date().toISOString(), status, recorded_status: manifest.status,
    dataset_sha256: manifest.dataset.sha256,
    sequence: { planned_calls_including_warmup: schedule.length, attempted_calls_including_warmup: sequence.length, failed_calls_including_warmup: failures, complete_prefix: true, serial: true },
    modes,
    integrity: { artifact_sha256: artifactHashes, reporting_source_files: evaluatorFiles, clock_warnings: clockWarnings,
      clock_policy: 'Finite, nonnegative UTC durations and monotonic offsets are required. Monotonic timing controls elapsed time and overlap checks. UTC drift or offset differences above 3 ms are recorded as warnings, since the system clock can adjust independently.',
      checks: ['same frozen dataset, source, case order and grouping', 'recorded source digest consistency', 'independently reconstructed alternating paired schedule', 'complete execution prefix without missing or duplicate requests', 'nonnegative UTC and monotonic timing, exact monotonic durations, no overlap', 'native Jev wire request hashes and answer normalization', 'backend reports rescored from frozen labels and raw typed results'],
    },
    interpretation: 'One paired serial comparison on previously observed synthetic cases. Backend failures count against end-to-end accuracy; unrun cases remain visible. Native Jev confidence and AGY self-reported confidence are not compared. Timings measure different end-to-end integration pathways, not isolated model compute. Batch amortization is not individual response latency. Hashes and timestamps establish internal consistency, not independent provenance.',
  };
  await writeFile(join(path, 'comparison.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(path, 'comparison.md'), renderMarkdown(report));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] === '--help') {
    console.log('Usage: node experiments/compare-report.mjs DIRECTORY\nVerify and recompute a matched AGY versus native Jev comparison without model calls.');
    process.exitCode = process.argv[2] === '--help' ? 0 : 1;
  } else {
    try {
      const report = await generateComparisonReport(process.argv[2]);
      console.log(JSON.stringify({ status: report.status, reports: ['comparison.json', 'comparison.md'] }));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
