import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runComparison, batchScoreLevels, COMPARISON_MODELS } from '../experiments/compare.mjs';
import { buildJevRequest, normalizeJevAnswers } from '../experiments/lib/jev-openrouter.mjs';
import { buildBatch, hash } from '../experiments/lib/suite.mjs';

const readJSON = async path => JSON.parse(await readFile(path, 'utf8'));
const readJSONL = async path => (await readFile(path, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
const levels = ['No supplied evidence.', 'Some supplied evidence.', 'All required evidence.'];
const cases = [
  ['dev-boolean', 'dev', 'boolean', true],
  ['dev-score', 'dev', 'score', 1],
  ['test-choice', 'test', 'choice', 'a'],
  ['test-boolean', 'test', 'boolean', false],
  ['test-score', 'test', 'score', 2],
  ['test-boolean-2', 'test', 'boolean', true],
].map(([id, split, type, value]) => ({
  id, split, category: type, language: 'en',
  request: {
    state: { fact: value },
    questions: [{ id: 'decision', type, prompt: 'Read the supplied fact.', ...(type === 'choice' ? { options: ['a', 'b'] } : type === 'score' ? { min: 0, max: 2 } : {}) }],
  },
  expected: { decision: value },
  rationale: 'This is a synthetic orchestration fixture, never sent to the provider.',
  ...(type === 'score' ? { score_levels: { decision: levels } } : {}),
}));

async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'fast-jev-compare-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const suite = join(temporary, 'suite.jsonl');
  await writeFile(suite, `${cases.map(item => JSON.stringify(item)).join('\n')}\n`);
  return { temporary, suite, out: join(temporary, 'results') };
}

function adapters(overrides = {}) {
  const calls = [];
  let probes = 0;
  const resultFor = (request, index) => request.state.inputs ? request.state.inputs[index].fact : request.state.fact;
  return {
    calls,
    get probes() { return probes; },
    dependencies: {
      buildJevRequest,
      onProgress: () => {},
      probeAgy: async () => { probes += 1; return { version: 'agy 1.2.7', models: [COMPARISON_MODELS.agy], capabilities: [] }; },
      callAgy: async (request, options) => {
        calls.push({ backend: 'agy', request, options });
        if (overrides.agy) await overrides.agy(request, options, calls);
        assert.equal(options.model, COMPARISON_MODELS.agy);
        assert.equal(options.effort, undefined);
        assert.equal(options.apiKey, undefined);
        return {
          results: request.questions.map((question, index) => ({ id: question.id, type: question.type, value: resultFor(request, index), status: 'ok', confidence: 0.9 })),
          meta: { model: COMPARISON_MODELS.agy, provider: 'agy' },
        };
      },
      callJev: async (request, options) => {
        calls.push({ backend: 'jev', request, options });
        if (overrides.jev) await overrides.jev(request, options, calls);
        assert.equal(options.model, COMPARISON_MODELS.jev);
        const answers = Object.fromEntries(request.questions.map((question, index) => {
          const value = resultFor(request, index);
          return [question.id, question.type === 'boolean' ? { type: 'noul', noul: value ? 0.8 : 0.2 } : { type: question.type, [question.type]: value }];
        }));
        return {
          results: normalizeJevAnswers(request, { answers }),
          meta: { provider: 'jev-openrouter', model: COMPARISON_MODELS.jev },
          native: { answers, wire_request_sha256: hash(JSON.stringify(buildJevRequest(request, options))) },
        };
      },
      // The independent comparison reporter has its own integration tests.
      generateComparisonReport: async directory => ({ status: (await readJSON(join(directory, 'manifest.json'))).status }),
    },
  };
}

test('paired comparison alternates backend order, uses identical cases and keeps every child report recomputable', async t => {
  const f = await fixture(t);
  const mock = adapters();
  const secret = 'offline-test-credential-not-for-public-artifacts';
  const dependencies = { ...mock.dependencies };
  delete dependencies.generateComparisonReport;
  const result = await runComparison({ ...f, apiKey: secret, limit: 3 }, dependencies);
  assert.equal(result.status, 'completed');
  assert.equal(mock.calls.length, 12);
  assert.equal(mock.probes, 1);
  assert.equal(result.sequence.complete_prefix, true);
  assert.equal(result.sequence.serial, true);
  const manifest = await readJSON(join(f.out, 'manifest.json'));
  const sequence = await readJSONL(join(f.out, 'sequence.jsonl'));
  assert.equal(manifest.schedule.length, 12);
  assert.equal(sequence.length, 12);
  assert.equal(manifest.protocol.automatic_retries, 0);
  for (let pair = 0; pair < 6; pair++) {
    const rows = sequence.slice(pair * 2, pair * 2 + 2);
    assert.deepEqual(rows.map(row => row.backend), pair % 2 ? ['jev', 'agy'] : ['agy', 'jev']);
    assert.deepEqual(rows[0].case_ids, rows[1].case_ids);
    assert.equal(rows[0].request_sha256, rows[1].request_sha256);
    assert.ok(rows[0].end_offset_ms <= rows[1].start_offset_ms);
    for (const row of rows) {
      assert.ok(Number.isFinite(Date.parse(row.started_at)));
      assert.ok(Number.isFinite(Date.parse(row.finished_at)));
      assert.ok(Math.abs(row.elapsed_ms - (row.end_offset_ms - row.start_offset_ms)) < 0.003);
    }
  }
  assert.equal(manifest.warmup_snapshot_sha256, hash(await readFile(join(f.out, 'warmup-cases.jsonl'))));
  for (const { directory } of manifest.runs) {
    const report = await readJSON(join(f.out, directory, 'report.json'));
    assert.equal(report.quality.primary.attempted_count, 3);
    assert.equal(report.quality.primary.correct_count, 3);
    assert.equal(report.requests.warmup_attempts, 1);
    assert.equal(report.quality.repeat_consistency.expected_repeats, 1);
    for (const filename of ['manifest.json', 'requests.jsonl', 'records.jsonl', 'summary.json', 'report.json']) {
      assert.ok(!(await readFile(join(f.out, directory, filename), 'utf8')).includes(secret));
    }
  }
  assert.ok(mock.calls.every(call => !JSON.stringify(call.request).includes('rationale')));
  assert.ok(mock.calls.every(call => !JSON.stringify(call.request).includes('expected')));
});

test('plan writes a complete schedule with not_run records and performs no calls or probes without a credential', async t => {
  const f = await fixture(t);
  const mock = adapters();
  const result = await runComparison({ ...f, apiKey: '', plan: true }, mock.dependencies);
  assert.equal(result.status, 'planned');
  assert.equal(mock.calls.length, 0);
  assert.equal(mock.probes, 0);
  const manifest = await readJSON(join(f.out, 'manifest.json'));
  assert.equal(manifest.schedule.length, 14);
  assert.equal((await readJSONL(join(f.out, 'sequence.jsonl'))).length, 0);
  for (const { directory } of manifest.runs) {
    const records = await readJSONL(join(f.out, directory, 'records.jsonl'));
    assert.equal(records.length, 4);
    assert.ok(records.every(record => record.status === 'not_run' && record.reason === 'plan_only'));
    const report = await readJSON(join(f.out, directory, 'report.json'));
    assert.equal(report.quality.primary.end_to_end_correct_rate, null);
    assert.equal(report.requests.success_latency_ms.p50, null);
  }
});

test('missing credentials fail before creating the output directory', async t => {
  const f = await fixture(t);
  const mock = adapters();
  await assert.rejects(runComparison({ ...f, apiKey: '' }, mock.dependencies), /OPENAI_API_KEY/);
  await assert.rejects(access(f.out), { code: 'ENOENT' });
  assert.equal(mock.calls.length, 0);
});

test('existing evidence is never overwritten', async t => {
  const f = await fixture(t);
  await mkdir(f.out);
  await writeFile(join(f.out, 'sentinel'), 'preserve');
  const mock = adapters();
  await assert.rejects(runComparison({ ...f, apiKey: 'fixture' }, mock.dependencies), { code: 'EEXIST' });
  assert.equal(await readFile(join(f.out, 'sentinel'), 'utf8'), 'preserve');
  assert.equal(mock.calls.length, 0);
});

test('a failed warmup stops immediately and preserves all unrun formal cases in all modes', async t => {
  const f = await fixture(t);
  const mock = adapters({ agy: async () => { throw Object.assign(new Error('Do not publish this secret detail.'), { code: 'AGY_FAILED' }); } });
  const result = await runComparison({ ...f, apiKey: 'fixture' }, mock.dependencies);
  assert.equal(result.status, 'blocked');
  assert.equal(mock.calls.length, 1);
  const manifest = await readJSON(join(f.out, 'manifest.json'));
  assert.equal(manifest.stop_reason, 'warmup_agy_backend_or_output');
  assert.equal((await readJSONL(join(f.out, 'sequence.jsonl'))).length, 1);
  for (const { directory } of manifest.runs) {
    const report = await readJSON(join(f.out, directory, 'report.json'));
    assert.equal(report.requests.attempted, 0);
    assert.equal(report.quality.primary.not_run_count, 4);
    assert.equal(report.quality.primary.end_to_end_correct_rate, null);
    assert.ok(!(await readFile(join(f.out, directory, 'requests.jsonl'), 'utf8')).includes('secret detail'));
  }
});

test('three consecutive measured errors of either backend stop both and count failed attempts accurately', async t => {
  const f = await fixture(t);
  let agyCalls = 0;
  const mock = adapters({ agy: async () => { if (++agyCalls > 1) throw Object.assign(new Error('Timeout.'), { code: 'AGY_TIMEOUT' }); } });
  const result = await runComparison({ ...f, apiKey: 'fixture' }, mock.dependencies);
  assert.equal(result.status, 'partial');
  assert.equal(mock.calls.length, 8);
  assert.equal((await readJSON(join(f.out, 'manifest.json'))).stop_reason, 'consecutive_agy_timeout');
  const agy = await readJSON(join(f.out, 'b1/agy/report.json'));
  const jev = await readJSON(join(f.out, 'b1/jev/report.json'));
  assert.equal(agy.requests.failed, 3);
  assert.equal(agy.quality.primary.attempted_count, 3);
  assert.equal(agy.quality.primary.not_run_count, 1);
  assert.equal(agy.quality.primary.end_to_end_correct_rate, 0);
  assert.equal(jev.quality.primary.correct_count, 3);
  assert.equal((await readJSON(join(f.out, 'b8/agy/report.json'))).requests.attempted, 0);
});

test('aborting after the first call stops without issuing the other paired request', async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const mock = adapters({ agy: async () => controller.abort() });
  const result = await runComparison({ ...f, apiKey: 'fixture', signal: controller.signal }, mock.dependencies);
  assert.equal(result.status, 'blocked');
  assert.equal(mock.calls.length, 1);
  assert.equal((await readJSON(join(f.out, 'manifest.json'))).stop_reason, 'canceled');
});

test('consecutive measured failures remain visible across modes and are not reset by a successful warmup', async t => {
  const f = await fixture(t);
  let agyCalls = 0;
  const mock = adapters({ agy: async () => {
    if ([4, 5, 7].includes(++agyCalls)) throw Object.assign(new Error('Timeout.'), { code: 'AGY_TIMEOUT' });
  } });
  const result = await runComparison({ ...f, apiKey: 'fixture' }, mock.dependencies);
  assert.equal(result.status, 'partial');
  assert.equal(mock.calls.length, 13);
  assert.equal((await readJSON(join(f.out, 'manifest.json'))).stop_reason, 'consecutive_agy_timeout');
  assert.equal((await readJSON(join(f.out, 'b8/agy/report.json'))).requests.failed, 1);
  assert.equal((await readJSON(join(f.out, 'b8/jev/report.json'))).requests.attempted, 0);
});

test('native score criteria use the remapped batch ID and never borrow labels or rationales', () => {
  const items = [cases[0], cases[4]];
  const built = buildBatch(items);
  const mapped = batchScoreLevels(items, built.mapping);
  assert.deepEqual(mapped, { q1: levels });
  mapped.q1[0] = 'Changed local copy.';
  assert.equal(cases[4].score_levels.decision[0], levels[0]);
  assert.throws(() => batchScoreLevels([{ ...cases[4], score_levels: undefined }], buildBatch([cases[4]]).mapping), /score_levels/);
});

test('invalid native rubrics are rejected before any artifact or provider call', async t => {
  const f = await fixture(t);
  const invalid = cases.map(item => item.request.questions[0].type === 'score' ? { ...item, score_levels: undefined } : item);
  await writeFile(f.suite, `${invalid.map(item => JSON.stringify(item)).join('\n')}\n`);
  const mock = adapters();
  await assert.rejects(runComparison({ ...f, apiKey: 'fixture' }, mock.dependencies), /score_levels/);
  await assert.rejects(access(f.out), { code: 'ENOENT' });
  assert.equal(mock.calls.length, 0);
});

test('duplicate or nonintegral batch sizes fail before artifact creation', async t => {
  const f = await fixture(t);
  const mock = adapters();
  await assert.rejects(runComparison({ ...f, plan: true, batchSizes: [1, '1'] }, mock.dependencies), /duplicates/);
  await assert.rejects(runComparison({ ...f, plan: true, batchSizes: [1.5] }, mock.dependencies), /integer/);
  await assert.rejects(access(f.out), { code: 'ENOENT' });
});
