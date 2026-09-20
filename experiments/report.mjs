#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { buildBatch, hash, loadSuite, unpackResults } from './lib/suite.mjs';
import { percentile, scoreCase, summarize } from './lib/metrics.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (message) => { throw new Error(`Invalid experiment artifacts: ${message}`); };
const ensure = (condition, message) => { if (!condition) fail(message); };
const integer = (value, min = 0) => Number.isInteger(value) && value >= min;
const keyFor = (repeat, id) => JSON.stringify([repeat, id]);
const setEqual = (a, b) => a.size === b.size && [...a].every(value => b.has(value));
const sortedResults = results => [...results].sort((a, b) => a.id.localeCompare(b.id));

function jsonLines(bytes, filename) {
  return bytes.toString('utf8').split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try { return [JSON.parse(line)]; } catch { fail(`${filename}:${index + 1} is not valid JSON.`); }
  });
}

function checkResults(results, expectedIds, label) {
  ensure(Array.isArray(results), `${label} must contain results.`);
  ensure(results.every(result => result && typeof result.id === 'string'), `${label} has malformed results.`);
  const ids = new Set(results.map(result => result.id));
  ensure(ids.size === results.length, `${label} has duplicate result IDs.`);
  ensure(setEqual(ids, new Set(expectedIds)), `${label} has missing or unexpected result IDs.`);
}

function latencyStats(requests) {
  const values = requests.map(request => request.elapsed_ms);
  return {
    sample_count: values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
  };
}

function requestSummary(requests, planned) {
  const measured = requests.filter(request => request.phase === 'measure');
  const successful = measured.filter(request => request.status === 'ok');
  const failed = measured.filter(request => request.status === 'error');
  const measuredTime = measured.reduce((sum, request) => sum + request.elapsed_ms, 0);
  const successfulTime = successful.reduce((sum, request) => sum + request.elapsed_ms, 0);
  const successfulCases = successful.reduce((sum, request) => sum + request.case_ids.length, 0);
  return {
    planned,
    attempted: measured.length,
    successful: successful.length,
    failed: failed.length,
    not_run: planned - measured.length,
    warmup_attempts: requests.filter(request => request.phase === 'warmup').length,
    success_latency_ms: latencyStats(successful),
    error_latency_ms: latencyStats(failed),
    measured_request_time_ms: measuredTime,
    successful_cases_per_second: measuredTime > 0 && successful.length > 0 ? successfulCases / (measuredTime / 1000) : null,
    successful_amortized_ms_per_case: successfulCases > 0 ? successfulTime / successfulCases : null,
  };
}

function formatNumber(value, digits = 2) {
  return value === null || value === undefined ? 'N/A' : Number(value).toFixed(digits);
}

function formatRate(value) {
  return value === null || value === undefined ? 'N/A' : `${(value * 100).toFixed(2)}%`;
}

function markdown(report) {
  const quality = report.quality.primary;
  const requests = report.requests;
  const interval = quality.accuracy_wilson95;
  return `# Recomputed experiment report

- Status: ${report.status}
- Provider: ${report.backend.provider}; requested model: ${report.backend.requested_model}
- Dataset snapshot SHA-256: \`${report.integrity.snapshot_sha256}\`
- Source SHA-256 recorded at run time: \`${report.integrity.recorded_source_sha256 ?? 'N/A'}\`
- Built-in dataset cross-check: ${report.integrity.bundled_suite_matches ? 'matched; selected cases and labels verified' : 'different/custom suite; frozen snapshot verified'}
- Planned cases: ${report.quality.coverage.planned_case_count}; repeats: ${report.protocol.repeats}; batch size: ${report.protocol.batch_size}

| Quality (first measured repeat) | Result |
| --- | ---: |
| Attempted cases | ${quality.attempted_count} |
| Successful backend responses | ${quality.success_count} |
| Valid result rate, including backend errors in denominator | ${formatRate(quality.valid_rate)} |
| End-to-end correct rate, including backend errors | ${formatRate(quality.end_to_end_correct_rate)} |
| Accuracy among successful backend responses | ${formatRate(quality.observed_success_accuracy)} |
| Choice/boolean accuracy among scored responses | ${formatRate(quality.choice_bool_accuracy)} |
| Score MAE, valid numeric outputs only | ${formatNumber(quality.score_mae, 4)} |
| Score normalized MAE, valid numeric outputs only | ${formatNumber(quality.score_normalized_mae, 4)} |
| Score exact match among scored responses | ${formatRate(quality.score_exact_match)} |
| Score within absolute error ≤ 0.5 (inclusive) | ${formatRate(quality.score_within_tolerance)} |
| Wilson 95% interval, first-repeat end-to-end rate | ${interval ? `${formatRate(interval.lower)} – ${formatRate(interval.upper)}` : 'N/A'} |
| Attempted unique-case coverage across repeats | ${formatRate(report.quality.coverage.attempted_case_rate)} |
| Exact consistency across complete valid repeats | ${formatRate(report.quality.repeat_consistency.consistency_rate)} |

| Request-level performance (all measured repeats, warmup excluded) | Result |
| --- | ---: |
| Planned / attempted / successful / failed / not run | ${requests.planned} / ${requests.attempted} / ${requests.successful} / ${requests.failed} / ${requests.not_run} |
| Successful request latency p50 (ms) | ${formatNumber(requests.success_latency_ms.p50)} |
| Successful request latency p95 (ms) | ${formatNumber(requests.success_latency_ms.p95)} |
| Successful request latency mean (ms) | ${formatNumber(requests.success_latency_ms.mean)} |
| Successful amortized milliseconds per case | ${formatNumber(requests.successful_amortized_ms_per_case)} |
| Successful cases / second of measured request time, including failed request time | ${formatNumber(requests.successful_cases_per_second)} |

Every request is counted once. A batch's duration divided by its case count is amortized cost, **not individual response latency**. Failed request timings are not successful inference timings. Throughput excludes warmup, probing, artifact I/O and other between-request overhead, so it is not whole-run wall-clock throughput.

Scores were recomputed from the frozen case labels and raw result values; stored \`record.score\` fields were ignored. Missing, abstained and invalid predictions count as incorrect. Unrun cases are excluded from accuracy denominators and exposed by coverage. N/A means the relevant observations are absent, not 0% accuracy.

The first-repeat Wilson interval does not make a small synthetic suite representative of production work. Repeated runs are dependent observations. Published Jev results use different tasks and environments; this report does not establish superiority over Jev.

Integrity checks detect inconsistent or accidentally modified artifacts; hashes stored alongside editable files are not a cryptographic proof of provenance. See \`report.json\` for all metrics, breakdowns, recorded metadata, and reporting-code hashes. The original \`summary.json\` is unchanged.
`;
}

export async function generateReport(directory) {
  const path = resolve(directory);
  const filenames = ['manifest.json', 'cases.jsonl', 'records.jsonl', 'requests.jsonl'];
  const bytes = await Promise.all(filenames.map(name => readFile(join(path, name))));
  let manifest;
  try { manifest = JSON.parse(bytes[0].toString('utf8')); } catch { fail('manifest.json is not valid JSON.'); }
  ensure(manifest && manifest.schema_version === 1, 'unsupported manifest schema.');
  const snapshotHash = hash(bytes[1]);
  const recordedSnapshotHash = manifest.dataset?.snapshot_sha256 ?? manifest.snapshot_sha256;
  ensure(typeof recordedSnapshotHash === 'string' && recordedSnapshotHash === snapshotHash, 'case snapshot SHA-256 mismatch or missing snapshot_sha256.');
  const { cases } = await loadSuite(join(path, 'cases.jsonl'));
  const records = jsonLines(bytes[2], 'records.jsonl');
  const requests = jsonLines(bytes[3], 'requests.jsonl');
  const ids = new Set(cases.map(item => item.id));
  const byId = new Map(cases.map(item => [item.id, item]));
  const dataset = manifest.dataset;
  const protocol = manifest.protocol;
  ensure(dataset && protocol, 'dataset and protocol are required.');
  ensure(integer(dataset.selected_cases, 1) && dataset.selected_cases === cases.length, 'selected case count does not match snapshot.');
  ensure(integer(dataset.eligible_cases, cases.length) && integer(dataset.total_cases, dataset.eligible_cases), 'inconsistent dataset counts.');
  ensure(Array.isArray(dataset.selected_ids) && dataset.selected_ids.length === cases.length
    && setEqual(new Set(dataset.selected_ids), ids), 'selected_ids do not match snapshot.');
  ensure(['dev', 'test', 'all'].includes(dataset.split), 'invalid dataset split.');
  ensure(cases.every(item => dataset.split === 'all' || item.split === dataset.split), 'snapshot includes cases outside selected split.');
  ensure(integer(protocol.repeats, 1) && integer(protocol.batch_size, 1), 'invalid repeats or batch size.');
  ensure(integer(protocol.excluded_warmup_requests), 'invalid warmup count.');
  const plannedRequests = protocol.repeats * Math.ceil(cases.length / protocol.batch_size);
  ensure(protocol.planned_measured_cases === cases.length * protocol.repeats, 'planned measured case count is inconsistent.');
  ensure(protocol.planned_measured_requests === plannedRequests, 'planned measured request count is inconsistent.');
  ensure(protocol.score_tolerance === 0.5, 'unsupported score tolerance.');
  ensure(protocol.concurrency === 1, 'report throughput requires serial requests.');
  ensure(Array.isArray(manifest.order) && manifest.order.length === protocol.repeats, 'missing measured repeat order.');
  const plannedBatches = new Map();
  const repeatsSeen = new Set();
  for (const order of manifest.order) {
    ensure(integer(order.repeat) && order.repeat < protocol.repeats && !repeatsSeen.has(order.repeat), 'duplicate or unexpected repeat in order.');
    repeatsSeen.add(order.repeat);
    ensure(Array.isArray(order.case_ids) && order.case_ids.length === cases.length
      && setEqual(new Set(order.case_ids), ids), 'repeat order must contain each selected case exactly once.');
    for (let index = 0; index < order.case_ids.length; index += protocol.batch_size) {
      const batch = order.case_ids.slice(index, index + protocol.batch_size);
      plannedBatches.set(keyFor(order.repeat, batch[0]), batch);
    }
  }
  let bundledMatches = false;
  try {
    const bundled = await loadSuite(join(root, 'experiments/data/decision-suite.jsonl'));
    bundledMatches = bundled.sha256 === dataset.sha256;
    if (bundledMatches) {
      const originals = new Map(bundled.cases.map(item => [item.id, item]));
      ensure(cases.every(item => isDeepStrictEqual(item, originals.get(item.id))), 'snapshot differs from the matching bundled dataset.');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const requestById = new Map();
  const measuredBatches = new Set();
  const measuredCaseKeys = new Set();
  for (const request of requests) {
    ensure(request && typeof request.request_id === 'string' && request.request_id.length > 0
      && !requestById.has(request.request_id), 'duplicate or missing request ID.');
    requestById.set(request.request_id, request);
    ensure(['measure', 'warmup'].includes(request.phase), 'unexpected request phase.');
    ensure(['ok', 'error'].includes(request.status), 'unexpected request status.');
    ensure(Number.isFinite(request.elapsed_ms) && request.elapsed_ms >= 0, 'request elapsed_ms must be nonnegative and finite.');
    ensure(Array.isArray(request.case_ids) && request.case_ids.length > 0
      && request.case_ids.every(id => typeof id === 'string' && id.length > 0)
      && new Set(request.case_ids).size === request.case_ids.length, 'missing or duplicate case IDs in request.');
    ensure(integer(request.question_count, 1), 'invalid request question count.');
    if (request.status === 'error') ensure(request.results === undefined, 'failed request cannot have successful results.');
    if (request.phase === 'warmup') {
      ensure(Number.isInteger(request.repeat) && request.repeat < 0, 'warmup repeat must be negative.');
      continue;
    }
    ensure(integer(request.repeat) && request.repeat < protocol.repeats, 'unexpected measured request repeat.');
    ensure(request.case_ids.every(id => ids.has(id)), 'unexpected measured request case ID.');
    const batchKey = keyFor(request.repeat, request.case_ids[0]);
    ensure(!measuredBatches.has(batchKey), 'duplicate measured batch request.');
    ensure(isDeepStrictEqual(request.case_ids, plannedBatches.get(batchKey)), 'measured request does not match planned batch order.');
    measuredBatches.add(batchKey);
    for (const id of request.case_ids) {
      const key = keyFor(request.repeat, id);
      ensure(!measuredCaseKeys.has(key), 'case repeated in multiple measured requests.');
      measuredCaseKeys.add(key);
    }
    const built = buildBatch(request.case_ids.map(id => byId.get(id)));
    ensure(request.request_sha256 === hash(JSON.stringify(built.request)), 'measured provider request SHA-256 mismatch.');
    ensure(request.question_count === built.request.questions.length, 'request question count mismatch.');
    if (request.status === 'ok') checkResults(request.results, built.mapping.map(item => item.id), `request ${request.request_id}`);
  }
  ensure(requests.filter(request => request.phase === 'warmup').length <= protocol.excluded_warmup_requests, 'more warmup requests than planned.');
  const measured = [];
  const seenRecords = new Set();
  const recordsByRequest = new Map();
  for (const record of records) {
    ensure(record && ['measure', 'warmup'].includes(record.phase), 'unexpected case record phase.');
    ensure(['ok', 'error', 'not_run'].includes(record.status), 'unexpected case record status.');
    if (record.phase === 'measure') {
      ensure(ids.has(record.case_id), 'unexpected measured case ID.');
      ensure(integer(record.repeat) && record.repeat < protocol.repeats, 'unexpected measured case repeat.');
      const key = keyFor(record.repeat, record.case_id);
      ensure(!seenRecords.has(key), 'duplicate measured case/repeat.');
      seenRecords.add(key);
      const item = byId.get(record.case_id);
      ensure(record.category === item.category && record.language === item.language
        && record.kind === item.request.questions[0].type, 'case metadata differs from snapshot.');
      if (record.status === 'not_run') {
        ensure(record.request_id === undefined && record.results === undefined
          && (record.elapsed_ms === null || record.elapsed_ms === undefined), 'not_run case contains request evidence.');
        ensure(!measuredCaseKeys.has(key), 'not_run case belongs to an attempted request.');
      }
      measured.push({ ...record, score: record.status === 'ok' ? scoreCase(item, record.results) : undefined });
    }
    if (record.status === 'not_run') {
      ensure(record.phase === 'measure', 'warmup records cannot be not_run.');
      continue;
    }
    const request = requestById.get(record.request_id);
    ensure(request && request.case_ids.includes(record.case_id), 'case references missing or unrelated request.');
    ensure(request.phase === record.phase && request.repeat === record.repeat
      && request.status === record.status, 'case and request phase/repeat/status differ.');
    ensure(record.elapsed_ms === request.elapsed_ms, 'case and request elapsed_ms differ.');
    if (!recordsByRequest.has(record.request_id)) recordsByRequest.set(record.request_id, new Map());
    const mapped = recordsByRequest.get(record.request_id);
    ensure(!mapped.has(record.case_id), 'duplicate case reference within a request.');
    mapped.set(record.case_id, record);
    if (record.status === 'error') ensure(record.results === undefined, 'failed case contains successful results.');
    if (record.phase === 'measure' && record.status === 'ok') {
      const built = buildBatch(request.case_ids.map(id => byId.get(id)));
      const unpacked = unpackResults(request.results, built.mapping, record.case_id);
      checkResults(record.results, unpacked.map(result => result.id), `case ${record.case_id}`);
      ensure(isDeepStrictEqual(sortedResults(record.results), sortedResults(unpacked)), 'case results differ from raw request results.');
    }
  }
  ensure(seenRecords.size === protocol.planned_measured_cases, 'missing measured case/repeat records (use explicit not_run records for unrun cases).');
  for (const request of requests) {
    const mapped = recordsByRequest.get(request.request_id);
    ensure(mapped?.size === request.case_ids.length, 'request is missing its case records.');
    if (request.phase === 'warmup' && request.status === 'ok') {
      const unpacked = request.case_ids.flatMap(id => {
        const results = mapped.get(id).results;
        ensure(Array.isArray(results), 'successful warmup case is missing results.');
        return results;
      }).map((result, index) => request.case_ids.length === 1 ? result : { ...result, id: `q${index}` });
      checkResults(request.results, unpacked.map(result => result.id), 'warmup request');
      ensure(unpacked.length === request.question_count && isDeepStrictEqual(sortedResults(request.results), sortedResults(unpacked)), 'warmup request results differ from its case records.');
    }
  }
  const quality = summarize(measured, { plannedCases: cases, expectedRepeats: protocol.repeats });
  const requestMetrics = requestSummary(requests, plannedRequests);
  const status = requestMetrics.attempted === 0
    ? manifest.status === 'planned' ? 'planned' : 'blocked'
    : requestMetrics.not_run > 0 ? 'partial' : requestMetrics.failed > 0 ? 'completed_with_errors' : 'completed';
  const evaluatorFiles = {};
  for (const filename of ['experiments/report.mjs', 'experiments/lib/metrics.mjs', 'experiments/lib/suite.mjs']) {
    evaluatorFiles[filename] = hash(await readFile(join(root, filename)));
  }
  const report = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    status,
    recorded_status: manifest.status,
    backend: manifest.backend ?? {},
    protocol,
    integrity: {
      snapshot_sha256: snapshotHash,
      bundled_suite_matches: bundledMatches,
      recorded_source_sha256: manifest.source?.sha256 ?? null,
      reporting_source_files: evaluatorFiles,
      artifact_sha256: Object.fromEntries(filenames.map((filename, index) => [filename, hash(bytes[index])])),
      checks: ['snapshot hash', 'selected case IDs and counts', 'planned order and full measured record coverage', 'unique requests and case/repeat records', 'request reconstruction hashes', 'raw request/case output and duration agreement', 'scores recomputed from frozen labels'],
    },
    quality,
    requests: requestMetrics,
    interpretation: 'Only successful model outputs measure conditional prediction quality. Error timings are not successful inference latency. External Jev figures are not directly comparable. Stored record.score values were ignored. Artifact hashes verify internal consistency, not independent provenance.',
  };
  await writeFile(join(path, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(path, 'report.md'), markdown(report));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] === '--help') {
    console.log('Usage: node experiments/report.mjs DIRECTORY\nRecompute verified metrics from manifest.json, cases.jsonl, records.jsonl and requests.jsonl.');
    process.exitCode = process.argv[2] === '--help' ? 0 : 1;
  } else {
    try {
      const report = await generateReport(process.argv[2]);
      console.log(JSON.stringify({ directory: resolve(process.argv[2]), status: report.status, reports: ['report.json', 'report.md'] }));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
