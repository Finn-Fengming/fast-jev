import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateComparisonReport } from '../experiments/compare-report.mjs';
import { buildBatch, hash, unpackResults } from '../experiments/lib/suite.mjs';
import { buildJevRequest, normalizeJevAnswers } from '../experiments/lib/jev-openrouter.mjs';

const jsonl = rows => rows.length ? `${rows.map(row => JSON.stringify(row)).join('\n')}\n` : '';
const bool = (id, split, expected) => ({ id, split, category: 'boolean', language: 'en',
  request: { state: { allowed: expected }, questions: [{ id: 'decision', type: 'boolean', prompt: 'Is allowed true?' }] },
  expected: { decision: expected } });
const cases = [
  bool('boolean-case', 'test', false),
  { id: 'choice-case', split: 'test', category: 'routing', language: 'zh',
    request: { state: 'Ready to ship.', questions: [{ id: 'decision', type: 'choice', prompt: 'Ready means ship.', options: ['ship', 'hold'] }] },
    expected: { decision: 'ship' } },
  { id: 'score-case', split: 'test', category: 'rubric', language: 'en',
    request: { state: 'One condition holds.', questions: [{ id: 'decision', type: 'score', prompt: '0: Neither condition.\n1: One condition.\n2: Both conditions.', min: 0, max: 2 }] },
    expected: { decision: 1 }, score_levels: { decision: ['Neither condition.', 'One condition.', 'Both conditions.'] } },
];

// These are constructed offline artifacts, not model measurements.
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'fast-jev-compare-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const warmup = [bool('warmup-case', 'dev', true)];
  const created = '2026-01-01T00:00:00.000Z';
  const epoch = Date.parse(created);
  const protocol = { repeats: 1, concurrency: 1, automatic_retries: 0, excluded_warmup_requests: 1, score_tolerance: 0.5, seed: 20260920 };
  const dataset = { sha256: hash(jsonl([...warmup, ...cases])), snapshot_sha256: hash(jsonl(cases)),
    total_cases: 4, eligible_cases: 3, selected_cases: 3, selected_ids: cases.map(item => item.id), split: 'test' };
  const runs = [1, 2].flatMap(batch_size => ['agy', 'jev'].map(backend => ({ directory: `b${batch_size}/${backend}`, backend, batch_size })));
  const manifest = { schema_version: 1, experiment: 'paired-jev-agy-v1', created_at: created, status: 'completed',
    source: { sha256: hash(JSON.stringify({})), files: {} }, git_commit: null, dataset,
    models: { agy: 'gemini-3.8-flash-low', jev: 'typesafe/jev-1.13' },
    protocol: { ...protocol, batch_sizes: [1, 2], planned_total_requests_including_warmup: 14 },
    runs, warmup_snapshot_sha256: hash(jsonl(warmup)), schedule: [], stop_reason: null };
  const children = new Map();
  for (const run of runs) {
    await mkdir(join(directory, run.directory), { recursive: true });
    children.set(run.directory, { requests: [], records: [], cases: structuredClone(cases), manifest: {
      schema_version: 1, status: 'completed', source: manifest.source, git_commit: null, dataset: structuredClone(dataset),
      backend: { provider: run.backend, requested_model: manifest.models[run.backend], timeout_ms: 30000 },
      protocol: { ...protocol, batch_size: run.batch_size, planned_measured_cases: 3, planned_measured_requests: Math.ceil(3 / run.batch_size) },
      order: [{ repeat: 0, case_ids: cases.map(item => item.id) }],
    } });
  }
  const sequence = [];
  let offset = 0;
  let pairIndex = 0;
  for (const size of [1, 2]) {
    const batches = [{ phase: 'warmup', items: warmup }, ...Array.from({ length: Math.ceil(cases.length / size) }, (_, index) => ({ phase: 'measure', items: cases.slice(index * size, (index + 1) * size) }))];
    for (const [index, batch] of batches.entries()) {
      const built = buildBatch(batch.items);
      const levels = Object.fromEntries(built.mapping.flatMap(field => {
        const value = batch.items.find(item => item.id === field.case_id).score_levels?.[field.original_id];
        return value ? [[field.id, value]] : [];
      }));
      const backendOrder = pairIndex % 2 === 0 ? ['agy', 'jev'] : ['jev', 'agy'];
      for (const backend of backendOrder) {
        const wireHash = backend === 'jev' ? hash(JSON.stringify(buildJevRequest(built.request, { scoreLevels: levels }))) : undefined;
        const scheduled = { sequence_index: sequence.length, pair_index: pairIndex, backend_order: backendOrder,
          directory: `b${size}/${backend}`, backend, batch_size: size, request_id: `r${index}`, phase: batch.phase,
          case_ids: batch.items.map(item => item.id), request_sha256: hash(JSON.stringify(built.request)),
          ...(wireHash ? { wire_request_sha256: wireHash } : {}) };
        manifest.schedule.push(scheduled);
        const elapsed = backend === 'agy' ? 200 : 100;
        const entry = { ...structuredClone(scheduled), status: 'ok', elapsed_ms: elapsed,
          started_at: new Date(epoch + offset).toISOString(), finished_at: new Date(epoch + offset + elapsed).toISOString(),
          start_offset_ms: offset, end_offset_ms: offset + elapsed };
        sequence.push(entry);
        offset += elapsed + 5;
        const answers = Object.fromEntries(built.request.questions.map(question => [question.id,
          question.type === 'boolean' ? { type: 'noul', noul: 0.5 }
            : question.type === 'choice' ? { type: 'choice', choice: question.options[0] }
              : { type: 'score', score: 1.4 }]));
        const results = backend === 'jev' ? normalizeJevAnswers(built.request, { answers })
          : built.request.questions.map(question => ({ id: question.id, type: question.type,
            value: question.type === 'boolean' ? false : question.type === 'choice' ? question.options[0] : 1,
            confidence: 0.9, status: 'ok' }));
        const request = { ...entry, repeat: batch.phase === 'warmup' ? -1 : 0, question_count: built.request.questions.length,
          results, ...(backend === 'jev' ? { native: { answers, wire_request_sha256: wireHash } } : {}) };
        const child = children.get(scheduled.directory);
        child.requests.push(request);
        for (const item of batch.items) child.records.push({ request_id: request.request_id, phase: request.phase, repeat: request.repeat,
          case_id: item.id, category: item.category, language: item.language, kind: item.request.questions[0].type,
          status: 'ok', elapsed_ms: elapsed, results: unpackResults(results, built.mapping, item.id),
          score: { correct: false, valid: false, questions: [] } });
      }
      pairIndex += 1;
    }
  }
  manifest.elapsed_run_ms = offset;
  manifest.finished_at = new Date(epoch + offset).toISOString();
  const save = async () => {
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(directory, 'warmup-cases.jsonl'), jsonl(warmup));
    await writeFile(join(directory, 'sequence.jsonl'), jsonl(sequence));
    for (const [relative, child] of children) {
      await writeFile(join(directory, relative, 'manifest.json'), JSON.stringify(child.manifest));
      await writeFile(join(directory, relative, 'cases.jsonl'), jsonl(child.cases));
      await writeFile(join(directory, relative, 'requests.jsonl'), jsonl(child.requests));
      await writeFile(join(directory, relative, 'records.jsonl'), jsonl(child.records));
    }
  };
  await save();
  return { directory, manifest, children, sequence, warmup, save };
}

test('comparison recomputes quality, continuous scores and paired request speed without trusting stored scores', async t => {
  const state = await fixture(t);
  const report = await generateComparisonReport(state.directory);
  assert.equal(report.status, 'completed');
  assert.equal(report.sequence.attempted_calls_including_warmup, 14);
  for (const mode of ['b1', 'b2']) {
    const { agy, jev } = report.modes[mode].backends;
    assert.equal(agy.quality.primary.end_to_end_correct_rate, 1);
    assert.equal(jev.quality.primary.end_to_end_correct_rate, 2 / 3);
    assert.ok(Math.abs(jev.quality.primary.score_mae - 0.4) < 1e-12);
    assert.equal(jev.quality.primary.score_exact_match, 0);
    assert.equal(jev.quality.by_category.boolean.correct_count, 0);
    assert.equal(jev.quality.by_language.zh.correct_count, 1);
    assert.equal(jev.requests.success_latency_ms.p50, 100);
    assert.equal(agy.requests.all_attempt_latency_ms.p95, 200);
    assert.equal(report.modes[mode].speed_ratio.success_p50_agy_over_jev, 2);
    assert.equal(report.modes[mode].speed_ratio.median_paired_agy_over_jev, 2);
  }
  assert.equal(report.modes.b1.backends.jev.requests.success_latency_ms.sample_count, 3);
  assert.equal(report.modes.b2.backends.jev.requests.success_latency_ms.sample_count, 2);
  assert.equal(report.modes.b2.backends.jev.requests.successful_amortized_ms_per_case, 200 / 3);
  assert.match(await readFile(join(state.directory, 'comparison.md'), 'utf8'), /not individual response latency/);
  assert.match(await readFile(join(state.directory, 'comparison.md'), 'utf8'), /confidence are not compared/);
});

test('failure counts reduce end-to-end accuracy and have their own all-attempt latency denominator', async t => {
  const state = await fixture(t);
  const child = state.children.get('b1/jev');
  const request = child.requests.find(row => row.case_ids[0] === 'score-case');
  request.status = 'error'; request.error = { code: 'TIMEOUT' }; delete request.results; delete request.native;
  const sequence = state.sequence.find(row => row.sequence_index === request.sequence_index);
  sequence.status = 'error';
  const record = child.records.find(row => row.request_id === request.request_id);
  record.status = 'error'; record.error = { code: 'TIMEOUT' }; delete record.results; delete record.score;
  await state.save();
  const report = await generateComparisonReport(state.directory);
  const jev = report.modes.b1.backends.jev;
  assert.equal(report.status, 'completed_with_errors');
  assert.equal(jev.quality.primary.end_to_end_correct_rate, 1 / 3);
  assert.equal(jev.quality.primary.valid_rate, 2 / 3);
  assert.equal(jev.requests.failed, 1);
  assert.equal(jev.requests.success_latency_ms.sample_count, 2);
  assert.equal(jev.requests.all_attempt_latency_ms.sample_count, 3);
  assert.equal(report.modes.b1.speed_ratio.matched_success_pair_count, 2);
});

test('tampered native boolean mapping is rejected even when request and case outputs agree', async t => {
  const state = await fixture(t);
  const child = state.children.get('b1/jev');
  const request = child.requests[1];
  request.results[0].value = false;
  child.records.find(row => row.request_id === request.request_id).results[0].value = false;
  await state.save();
  await assert.rejects(generateComparisonReport(state.directory), /native Jev answers do not match/);
});

test('native score remains continuous and cannot be silently rounded', async t => {
  const state = await fixture(t);
  const child = state.children.get('b1/jev');
  const request = child.requests.find(row => row.case_ids[0] === 'score-case');
  request.results[0].value = 1;
  child.records.find(row => row.request_id === request.request_id).results[0].value = 1;
  await state.save();
  await assert.rejects(generateComparisonReport(state.directory), /native Jev answers do not match/);
});

test('native wire hash is independently reconstructed for successful and failed calls', async t => {
  const state = await fixture(t);
  const request = state.children.get('b1/jev').requests[1];
  request.wire_request_sha256 = 'tampered';
  await state.save();
  await assert.rejects(generateComparisonReport(state.directory), /native wire request SHA-256 mismatch/);
});

test('both backends must use byte-identical frozen cases, order and grouping', async t => {
  const state = await fixture(t);
  state.children.get('b2/jev').manifest.order[0].case_ids.reverse();
  await state.save();
  await assert.rejects(generateComparisonReport(state.directory), /case order differs/);
});

test('changing the recorded schedule cannot hide a skipped paired call', async t => {
  const state = await fixture(t);
  state.manifest.schedule.splice(3, 1);
  await state.save();
  await assert.rejects(generateComparisonReport(state.directory), /frozen schedule does not match/);
});

test('missing or duplicate sequence rows cannot selectively omit backend outcomes', async t => {
  const state = await fixture(t);
  const row = state.sequence.splice(3, 1)[0];
  await state.save();
  await assert.rejects(generateComparisonReport(state.directory), /complete prefix/);
  state.sequence.splice(3, 0, row, structuredClone(row));
  await state.save();
  await assert.rejects(generateComparisonReport(state.directory), /more sequence calls than planned|complete prefix/);
});

test('negative, mismatched and overlapping timing evidence is rejected', async t => {
  const state = await fixture(t);
  const entry = state.sequence[1];
  const request = state.children.get(entry.directory).requests[0];
  const original = structuredClone(entry);
  entry.start_offset_ms = -1; request.start_offset_ms = -1;
  await state.save();
  await assert.rejects(generateComparisonReport(state.directory), /negative or invalid monotonic/);
  Object.assign(entry, original); Object.assign(request, original);
  entry.elapsed_ms = 99; request.elapsed_ms = 99;
  await state.save();
  await assert.rejects(generateComparisonReport(state.directory), /monotonic duration differs/);
  Object.assign(entry, original); Object.assign(request, original);
  entry.start_offset_ms -= 10; entry.end_offset_ms -= 10;
  entry.started_at = new Date(Date.parse(entry.started_at) - 10).toISOString();
  entry.finished_at = new Date(Date.parse(entry.finished_at) - 10).toISOString();
  Object.assign(request, entry);
  await state.save();
  await assert.rejects(generateComparisonReport(state.directory), /overlap/);
});

test('warmup snapshots are hashed and native warmup answers are also audited', async t => {
  const state = await fixture(t);
  state.warmup[0].request.state.allowed = false;
  await state.save();
  await assert.rejects(generateComparisonReport(state.directory), /warmup snapshot SHA-256/);
  state.warmup[0].request.state.allowed = true;
  state.children.get('b1/jev').requests[0].native.answers.decision.noul = 0.4;
  await state.save();
  await assert.rejects(generateComparisonReport(state.directory), /native Jev answers do not match/);
});

test('a plan has complete not-run records, null quality and no invented speed ratio', async t => {
  const state = await fixture(t);
  state.manifest.status = 'planned';
  state.sequence.length = 0;
  for (const child of state.children.values()) {
    child.manifest.status = 'planned';
    child.requests.length = 0;
    child.records = cases.map(item => ({ phase: 'measure', repeat: 0, case_id: item.id,
      category: item.category, language: item.language, kind: item.request.questions[0].type,
      status: 'not_run', elapsed_ms: null, reason: 'plan_only' }));
  }
  await state.save();
  const report = await generateComparisonReport(state.directory);
  assert.equal(report.status, 'planned');
  assert.equal(report.modes.b1.backends.jev.quality.primary.end_to_end_correct_rate, null);
  assert.equal(report.modes.b1.backends.jev.quality.coverage.attempted_case_count, 0);
  assert.equal(report.modes.b1.speed_ratio.success_p50_agy_over_jev, null);
  assert.equal(report.modes.b1.backends.jev.requests.all_attempt_latency_ms.sample_count, 0);
});

test('recorded source metadata must have an internally consistent digest', async t => {
  const state = await fixture(t);
  state.manifest.source.sha256 = '0'.repeat(64);
  await state.save();
  await assert.rejects(generateComparisonReport(state.directory), /recorded source hash is inconsistent/);
});

test('system-clock drift is disclosed without rewriting monotonic request latency', async t => {
  const state = await fixture(t);
  const entry = state.sequence[1];
  entry.finished_at = new Date(Date.parse(entry.finished_at) + 4).toISOString();
  state.children.get(entry.directory).requests[0].finished_at = entry.finished_at;
  await state.save();
  const report = await generateComparisonReport(state.directory);
  assert.deepEqual(report.integrity.clock_warnings, [{ sequence_index: 1, kind: 'utc_duration_differs_from_monotonic' }]);
  assert.equal(report.modes.b1.backends.jev.requests.success_latency_ms.p50, 100);
  assert.match(await readFile(join(state.directory, 'comparison.md'), 'utf8'), /UTC clock warnings: 1/);
});

test('an interrupted half-pair retains asymmetric coverage and explicit unrun cases', async t => {
  const state = await fixture(t);
  // Both warmups completed; Jev attempted the first measured case before cancellation.
  state.sequence.splice(3);
  state.manifest.status = 'partial';
  state.manifest.stop_reason = 'canceled';
  for (const [directory, child] of state.children) {
    const retained = new Set(state.sequence.filter(row => row.directory === directory).map(row => row.request_id));
    child.requests = child.requests.filter(row => retained.has(row.request_id));
    child.records = child.records.filter(row => retained.has(row.request_id));
    const attempted = new Set(child.records.filter(row => row.phase === 'measure').map(row => row.case_id));
    for (const item of cases.filter(item => !attempted.has(item.id))) child.records.push({ phase: 'measure', repeat: 0, case_id: item.id,
      category: item.category, language: item.language, kind: item.request.questions[0].type,
      status: 'not_run', elapsed_ms: null, reason: 'canceled' });
    child.manifest.status = attempted.size ? 'partial' : 'blocked';
  }
  await state.save();
  const report = await generateComparisonReport(state.directory);
  assert.equal(report.status, 'partial');
  assert.equal(report.modes.b1.backends.jev.quality.coverage.attempted_case_count, 1);
  assert.equal(report.modes.b1.backends.agy.quality.coverage.attempted_case_count, 0);
  assert.equal(report.modes.b1.backends.jev.quality.primary.not_run_count, 2);
  assert.equal(report.modes.b1.backends.agy.quality.primary.end_to_end_correct_rate, null);
  assert.equal(report.modes.b1.backends.jev.quality.primary.end_to_end_correct_rate, 0);
  assert.equal(report.modes.b1.speed_ratio.matched_success_pair_count, 0);
});
