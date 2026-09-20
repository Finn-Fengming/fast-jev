import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateReport } from '../experiments/report.mjs';
import { buildBatch, hash, loadSuite, unpackResults } from '../experiments/lib/suite.mjs';

const cases = [true, false].map((answer, index) => ({
  id: `case-${index}`,
  split: 'test',
  category: 'policy',
  language: index === 0 ? 'en' : 'zh',
  request: { state: { allowed: answer }, questions: [{ id: 'decision', type: 'boolean', prompt: 'Is allowed true?' }] },
  expected: { decision: answer },
}));

const jsonl = rows => `${rows.map(row => JSON.stringify(row)).join('\n')}${rows.length ? '\n' : ''}`;

async function fixture(t, { batchSize = 2, status = 'ok', measured = true, selected = cases, datasetHash } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'fast-jev-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const manifest = {
    schema_version: 1,
    status: measured ? 'completed' : 'blocked',
    dataset: {
      sha256: datasetHash ?? hash(jsonl(selected)),
      snapshot_sha256: hash(jsonl(selected)),
      total_cases: selected.length,
      eligible_cases: selected.length,
      selected_cases: selected.length,
      selected_ids: selected.map(item => item.id),
      split: 'test',
    },
    backend: { provider: 'agy', requested_model: 'gemini-test' },
    protocol: {
      repeats: 1,
      batch_size: batchSize,
      excluded_warmup_requests: 1,
      planned_measured_cases: selected.length,
      planned_measured_requests: Math.ceil(selected.length / batchSize),
      score_tolerance: 0.5,
      concurrency: 1,
    },
    order: [{ repeat: 0, case_ids: selected.map(item => item.id) }],
  };
  const requests = [];
  const records = [];
  if (measured) {
    for (let index = 0; index < selected.length; index += batchSize) {
      const items = selected.slice(index, index + batchSize);
      const built = buildBatch(items);
      const results = built.mapping.map(item => ({
        id: item.id,
        type: items.find(row => row.id === item.case_id).request.questions.find(question => question.id === item.original_id).type,
        value: items.find(row => row.id === item.case_id).expected[item.original_id],
        confidence: 0.9,
        status: 'ok',
      }));
      const request = {
        request_id: `r${index}`,
        phase: 'measure',
        repeat: 0,
        case_ids: items.map(item => item.id),
        question_count: built.request.questions.length,
        request_sha256: hash(JSON.stringify(built.request)),
        status,
        elapsed_ms: 200,
        ...(status === 'ok' ? { results } : { error: { code: 'BACKEND_ERROR' } }),
      };
      requests.push(request);
      for (const item of items) {
        records.push({
          request_id: request.request_id,
          phase: 'measure',
          repeat: 0,
          case_id: item.id,
          category: item.category,
          language: item.language,
          kind: item.request.questions[0].type,
          status,
          elapsed_ms: 200,
          ...(status === 'ok' ? {
            results: unpackResults(results, built.mapping, item.id),
            // Deliberately false scores prove the reporter does not trust this field.
            score: { valid: false, correct: false, questions: [] },
          } : { error: { code: 'BACKEND_ERROR' } }),
        });
      }
    }
  } else {
    for (const item of selected) {
      records.push({
        phase: 'measure', repeat: 0, case_id: item.id,
        category: item.category, language: item.language, kind: item.request.questions[0].type,
        status: 'not_run', elapsed_ms: null, reason: 'warmup_backend_or_output',
      });
    }
    requests.push({ request_id: 'warmup', phase: 'warmup', repeat: -1, case_ids: ['dev-case'], question_count: 1, status: 'error', elapsed_ms: 5, error: { code: 'AGY_FAILED' } });
    records.push({ request_id: 'warmup', phase: 'warmup', repeat: -1, case_id: 'dev-case', status: 'error', elapsed_ms: 5, error: { code: 'AGY_FAILED' } });
  }
  const save = async () => {
    await Promise.all([
      writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest)),
      writeFile(join(directory, 'cases.jsonl'), jsonl(selected)),
      writeFile(join(directory, 'requests.jsonl'), jsonl(requests)),
      writeFile(join(directory, 'records.jsonl'), jsonl(records)),
    ]);
  };
  await save();
  return { directory, manifest, requests, records, selected, save };
}

test('successful batch is rescored from raw outputs and each request duration is counted once', async t => {
  const state = await fixture(t);
  await writeFile(join(state.directory, 'summary.json'), 'original summary sentinel');
  const report = await generateReport(state.directory);
  assert.equal(report.status, 'completed');
  assert.equal(report.quality.primary.end_to_end_correct_rate, 1);
  assert.equal(report.requests.attempted, 1);
  assert.equal(report.requests.success_latency_ms.sample_count, 1);
  assert.equal(report.requests.success_latency_ms.p50, 200);
  assert.equal(report.requests.successful_amortized_ms_per_case, 100);
  assert.equal(report.requests.successful_cases_per_second, 10);
  assert.equal(report.integrity.snapshot_sha256, state.manifest.dataset.snapshot_sha256);
  assert.equal(await readFile(join(state.directory, 'summary.json'), 'utf8'), 'original summary sentinel');
  const saved = JSON.parse(await readFile(join(state.directory, 'report.json'), 'utf8'));
  assert.equal(saved.quality.primary.correct_count, 2);
  assert.match(await readFile(join(state.directory, 'report.md'), 'utf8'), /not individual response latency/);
});

test('fabricated stored scores cannot hide a wrong raw prediction', async t => {
  const state = await fixture(t);
  state.requests[0].results[0].value = false;
  state.records[0].results[0].value = false;
  state.records[0].score = { valid: true, correct: true, questions: [] };
  await state.save();
  const report = await generateReport(state.directory);
  assert.equal(report.quality.primary.end_to_end_correct_rate, 0.5);
  assert.equal(report.quality.primary.choice_bool_accuracy, 0.5);
});

test('blocked warmup retains null accuracy and latency, and reports N/A rather than invented observations', async t => {
  const state = await fixture(t, { measured: false });
  const report = await generateReport(state.directory);
  assert.equal(report.status, 'blocked');
  assert.equal(report.quality.primary.end_to_end_correct_rate, null);
  assert.equal(report.quality.primary.observed_success_accuracy, null);
  assert.equal(report.quality.coverage.attempted_case_rate, 0);
  assert.equal(report.requests.attempted, 0);
  assert.equal(report.requests.warmup_attempts, 1);
  assert.equal(report.requests.success_latency_ms.p50, null);
  assert.equal(report.requests.successful_cases_per_second, null);
  assert.match(await readFile(join(state.directory, 'report.md'), 'utf8'), /Accuracy among successful backend responses \| N\/A/);
});

test('backend errors affect end-to-end accuracy without pretending to measure successful inference latency', async t => {
  const state = await fixture(t, { status: 'error' });
  const report = await generateReport(state.directory);
  assert.equal(report.status, 'completed_with_errors');
  assert.equal(report.quality.primary.end_to_end_correct_rate, 0);
  assert.equal(report.quality.primary.observed_success_accuracy, null);
  assert.equal(report.requests.success_latency_ms.p95, null);
  assert.equal(report.requests.error_latency_ms.p95, 200);
  assert.equal(report.requests.successful_amortized_ms_per_case, null);
  assert.equal(report.requests.successful_cases_per_second, null);
});

test('missing required artifact rejects report generation', async t => {
  const state = await fixture(t);
  await rm(join(state.directory, 'requests.jsonl'));
  await assert.rejects(generateReport(state.directory), { code: 'ENOENT' });
});

test('snapshot hash and manifest selected counts must match the frozen evidence', async t => {
  const state = await fixture(t);
  state.manifest.dataset.snapshot_sha256 = 'wrong';
  await state.save();
  await assert.rejects(generateReport(state.directory), /snapshot SHA-256/);
  state.manifest.dataset.snapshot_sha256 = hash(jsonl(state.selected));
  state.manifest.dataset.selected_cases = 3;
  await state.save();
  await assert.rejects(generateReport(state.directory), /selected case count/);
});

test('missing or duplicate case/repeat evidence is rejected rather than biasing accuracy', async t => {
  const state = await fixture(t);
  const removed = state.records.pop();
  await state.save();
  await assert.rejects(generateReport(state.directory), /missing measured case\/repeat/);
  state.records.push(removed, structuredClone(removed));
  await state.save();
  await assert.rejects(generateReport(state.directory), /duplicate measured case\/repeat/);
});

test('unknown cases and duplicate request references cannot inflate throughput', async t => {
  const state = await fixture(t);
  state.requests.push(structuredClone(state.requests[0]));
  await state.save();
  await assert.rejects(generateReport(state.directory), /duplicate or missing request ID/);
  state.requests[1].request_id = 'copy-with-new-id';
  await state.save();
  await assert.rejects(generateReport(state.directory), /duplicate measured batch/);
  state.requests.pop();
  state.records[0].case_id = 'unknown';
  await state.save();
  await assert.rejects(generateReport(state.directory), /unexpected measured case ID/);
});

test('case timing and values must agree with the unique underlying request', async t => {
  const state = await fixture(t);
  state.records[0].elapsed_ms = 1;
  await state.save();
  await assert.rejects(generateReport(state.directory), /elapsed_ms differ/);
  state.records[0].elapsed_ms = state.requests[0].elapsed_ms;
  state.records[0].results[0].value = false;
  await state.save();
  await assert.rejects(generateReport(state.directory), /case results differ/);
});

test('provider request hashes and planned batch order are verified', async t => {
  const state = await fixture(t);
  state.requests[0].request_sha256 = 'wrong';
  await state.save();
  await assert.rejects(generateReport(state.directory), /provider request SHA-256/);
  state.requests[0].case_ids.reverse();
  await state.save();
  await assert.rejects(generateReport(state.directory), /planned batch order/);
});

test('matching built-in suite hash also requires matching frozen labels', async t => {
  const suite = await loadSuite(new URL('../experiments/data/decision-suite.jsonl', import.meta.url));
  const selected = structuredClone(suite.cases.filter(item => item.split === 'test' && item.request.questions[0].type === 'boolean').slice(0, 2));
  assert.equal(selected.length, 2);
  selected[0].expected[selected[0].request.questions[0].id] = !selected[0].expected[selected[0].request.questions[0].id];
  const state = await fixture(t, { selected, datasetHash: suite.sha256 });
  await assert.rejects(generateReport(state.directory), /snapshot differs from the matching bundled dataset/);
});

test('CLI produces report paths on success and exits nonzero for corrupt evidence', async t => {
  const state = await fixture(t);
  const output = execFileSync(process.execPath, ['experiments/report.mjs', state.directory], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(output).reports, ['report.json', 'report.md']);
  state.records[0].elapsed_ms = 0;
  await state.save();
  assert.throws(() => execFileSync(process.execPath, ['experiments/report.mjs', state.directory], { encoding: 'utf8', stdio: 'pipe' }), error => error.status === 1 && /elapsed_ms differ/.test(error.stderr));
});
