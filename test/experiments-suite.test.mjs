import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadSuite, buildBatch, unpackResults, shuffle } from '../experiments/lib/suite.mjs';

const executeFile = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const bundledPath = join(root, 'experiments/data/decision-suite.jsonl');
const runner = join(root, 'experiments/run.mjs');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const jsonl = rows => `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
const parseJsonl = text => text.trim() ? text.trimEnd().split('\n').map(JSON.parse) : [];

function example(overrides = {}) {
  return {
    id: 'fixture-case', split: 'test', category: 'fixture', language: 'en',
    request: { state: { record: 'The service is not available.' }, questions: [
      { id: 'decision', type: 'boolean', prompt: 'Does the record establish that service is available?' },
    ] },
    expected: { decision: false }, rationale: 'The record explicitly denies availability.',
    ...overrides,
  };
}

async function workspace(t) {
  const directory = await mkdtemp(join(tmpdir(), 'fast-jev-experiments-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function run(directory, args) {
  const config = join(directory, 'config.json');
  await writeFile(config, '{}\n');
  // Isolate tests from the developer's configured credentials and provider.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !key.startsWith('FAST_JEV_') && !key.startsWith('OPENAI_')));
  env.XDG_CONFIG_HOME = directory;
  return executeFile(process.execPath, [runner, '--config', config, ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
  });
}

test('bundled suite keeps its fixed bytes, 96 cases, language balance and splits', async () => {
  const bytes = await readFile(bundledPath);
  const loaded = await loadSuite(bundledPath);
  assert.equal(loaded.sha256, sha256(bytes));
  assert.equal(loaded.sha256, 'f0bfdd47121bf16ee1600583ea06aa58a69aeecd8e5d679560dc1447ba696e2c');
  assert.equal(loaded.bytes, bytes.length);
  assert.equal(loaded.cases.length, 96);
  assert.equal(new Set(loaded.cases.map(row => row.id)).size, 96);
  assert.equal(new Set(loaded.cases.map(row => JSON.stringify(row.request))).size, 96);
  for (const category of ['routing_choice', 'grounded_boolean', 'rubric_score', 'policy_choice']) {
    for (const language of ['en', 'zh']) {
      const rows = loaded.cases.filter(row => row.category === category && row.language === language);
      assert.equal(rows.length, 12, `${category}/${language}`);
      assert.equal(rows.filter(row => row.split === 'dev').length, 4);
      assert.equal(rows.filter(row => row.split === 'test').length, 8);
    }
  }
  for (const row of loaded.cases) {
    assert.equal(row.request.questions.length, 1);
    const question = row.request.questions[0];
    assert.equal(question.id, 'decision');
    assert.ok(row.rationale.length > 0);
    if (question.type === 'score') {
      assert.equal(question.min, 0);
      assert.equal(question.max, 2);
      assert.ok([0, 1, 2].includes(row.expected.decision));
      assert.equal(row.score_levels.decision.length, 3);
      for (const [index, level] of row.score_levels.decision.entries()) {
        assert.ok(question.prompt.includes(`${index}: ${level}`));
      }
    }
  }
});

test('suite rejects invalid JSON, empty data, repeated IDs and invalid splits', async (t) => {
  const directory = await workspace(t);
  const path = join(directory, 'invalid.jsonl');
  const cases = [
    ['{\n', /Invalid dataset JSON/],
    ['\n\n', /dataset is empty/],
    [jsonl([example(), example()]), /IDs must be unique/],
    [jsonl([example({ id: ' ' })]), /IDs must be unique nonempty/],
    [jsonl([example({ split: 'validation' })]), /Invalid split\/language\/category/],
    [jsonl([example({ language: 'fr' })]), /Invalid split\/language\/category/],
  ];
  for (const [text, message] of cases) {
    await writeFile(path, text);
    await assert.rejects(loadSuite(path), message);
  }
});

test('suite rejects missing, extraneous, mistyped and out-of-range gold', async (t) => {
  const directory = await workspace(t);
  const path = join(directory, 'invalid-gold.jsonl');
  const choice = { state: {}, questions: [{ id: 'decision', type: 'choice', prompt: 'Choose.', options: ['a', 'b'] }] };
  const score = { state: {}, questions: [{ id: 'decision', type: 'score', prompt: 'Rate.', min: 0, max: 2 }] };
  const cases = [
    [example({ expected: undefined }), /Expected labels missing/],
    [example({ expected: [] }), /Expected labels missing/],
    [example({ expected: {} }), /Gold label count mismatch/],
    [example({ expected: { decision: false, extra: true } }), /Gold label count mismatch/],
    [example({ expected: { other: false } }), /Missing gold label/],
    [example({ expected: { decision: 'false' } }), /Invalid boolean gold/],
    [example({ request: choice, expected: { decision: 'c' } }), /Invalid choice gold/],
    [example({ request: score, expected: { decision: 3 } }), /Invalid score gold/],
    [example({ request: score, expected: { decision: -1 } }), /Invalid score gold/],
    [example({ request: score, expected: { decision: '1' } }), /Invalid score gold/],
    [example({ request: score, expected: { decision: null } }), /Invalid score gold/],
  ];
  for (const [row, message] of cases) {
    await writeFile(path, jsonl([row]));
    await assert.rejects(loadSuite(path), message);
  }
});

test('single and batched provider requests exclude reference labels, rationale and metadata', () => {
  const rows = [example({
    id: 'PRIVATE_CASE_ID_A', category: 'PRIVATE_CATEGORY', split: 'dev',
    expected: { decision: 'PRIVATE_GOLD' }, rationale: 'PRIVATE_RATIONALE',
    meta: { secret: 'PRIVATE_META' }, score_levels: { decision: ['PRIVATE_LEVEL'] },
  }), example({
    id: 'PRIVATE_CASE_ID_B', language: 'zh',
    request: { state: { record: 'A distinct second piece of evidence.' }, questions: [
      { id: 'decision', type: 'boolean', prompt: 'Is a second record present?' },
    ] },
  })];
  const before = structuredClone(rows);
  for (const selected of [[rows[0]], rows]) {
    const { request } = buildBatch(selected);
    const serialized = JSON.stringify(request);
    for (const token of ['PRIVATE_CASE_ID', 'PRIVATE_CATEGORY', 'PRIVATE_GOLD', 'PRIVATE_RATIONALE', 'PRIVATE_META', 'PRIVATE_LEVEL']) {
      assert.ok(!serialized.includes(token), token);
    }
    assert.deepEqual(Object.keys(request).sort(), ['questions', 'state']);
    assert.ok(request.questions.every(question => !Object.hasOwn(question, 'expected')));
  }
  const single = buildBatch([rows[0]]);
  assert.deepEqual(single.request, rows[0].request);
  assert.deepEqual(single.mapping, [{ id: 'decision', case_id: 'PRIVATE_CASE_ID_A', original_id: 'decision' }]);
  const batch = buildBatch(rows);
  assert.deepEqual(batch.request.state, { inputs: rows.map(row => row.request.state) });
  assert.match(batch.request.questions[0].prompt, /Use ONLY state\.inputs\[0\]/);
  assert.match(batch.request.questions[1].prompt, /Use ONLY state\.inputs\[1\]/);
  assert.deepEqual(rows, before, 'constructing a request must not mutate its audit data');
  assert.throws(() => buildBatch([]), /empty batch/);
});

test('batch answers are remapped by ID after response reordering and missing answers fail', () => {
  const first = example({ id: 'case-a' });
  const second = example({ id: 'case-b', request: { state: {}, questions: [
    { id: 'decision', type: 'boolean', prompt: 'First?' },
    { id: 'additional', type: 'score', prompt: 'Second?', min: 0, max: 2 },
  ] } });
  const { mapping } = buildBatch([first, second]);
  const results = [
    { id: 'q2', type: 'score', value: 1.75, confidence: 0.7 },
    { id: 'q0', type: 'boolean', value: false, confidence: 0.9 },
    { id: 'q1', type: 'boolean', value: true, confidence: 0.8 },
  ];
  const before = structuredClone(results);
  assert.deepEqual(unpackResults(results, mapping, 'case-a'), [
    { id: 'decision', type: 'boolean', value: false, confidence: 0.9 },
  ]);
  assert.deepEqual(unpackResults(results, mapping, 'case-b'), [
    { id: 'decision', type: 'boolean', value: true, confidence: 0.8 },
    { id: 'additional', type: 'score', value: 1.75, confidence: 0.7 },
  ]);
  assert.deepEqual(results, before);
  assert.throws(() => unpackResults(results.slice(1), mapping, 'case-b'), /Missing batch answer: q2/);
});

test('seeded shuffle has stable order, changes with seed and preserves its input', () => {
  const values = Array.from({ length: 10 }, (_, index) => index);
  const first = shuffle(values, 20260920);
  assert.deepEqual(first, [5, 6, 7, 3, 0, 4, 9, 8, 2, 1]);
  assert.deepEqual(shuffle(values, 20260920), first);
  assert.notDeepEqual(shuffle(values, 20260921), first);
  assert.deepEqual([...first].sort((a, b) => a - b), values);
  assert.deepEqual(values, Array.from({ length: 10 }, (_, index) => index));
});

test('runner --plan needs no backend and finishes with manifest, snapshot and complete summary artifacts', async (t) => {
  const directory = await workspace(t);
  const out = join(directory, 'plan');
  const { stdout, stderr } = await run(directory, [
    '--plan', '--provider', 'agy', '--agy-bin', join(directory, 'does-not-exist'),
    '--split', 'test', '--limit', '5', '--repeats', '2', '--batch-size', '2', '--warmup', '1', '--out', out,
  ]);
  assert.equal(stderr, '');
  const reported = JSON.parse(stdout);
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  const summary = JSON.parse(await readFile(join(out, 'summary.json'), 'utf8'));
  const snapshotBytes = await readFile(join(out, 'cases.jsonl'));
  const snapshot = parseJsonl(snapshotBytes.toString('utf8'));
  const records = parseJsonl(await readFile(join(out, 'records.jsonl'), 'utf8'));
  assert.equal(manifest.status, 'planned');
  assert.ok(manifest.finished_at);
  assert.equal(manifest.dataset.selected_cases, 5);
  assert.equal(manifest.dataset.eligible_cases, 64);
  assert.equal(manifest.dataset.is_subset, true);
  assert.equal(manifest.dataset.snapshot_sha256, sha256(snapshotBytes));
  assert.equal(snapshot.length, 5);
  assert.ok(snapshot.every(row => row.split === 'test'));
  assert.deepEqual(snapshot.map(row => row.id), manifest.dataset.selected_ids);
  assert.equal(records.length, 10);
  assert.ok(records.every(row => row.status === 'not_run' && row.reason === 'plan_only'));
  assert.equal(await readFile(join(out, 'requests.jsonl'), 'utf8'), '');
  assert.equal(summary.status, 'planned');
  assert.equal(summary.requests.planned, 6);
  assert.equal(summary.requests.attempted, 0);
  assert.equal(summary.requests.not_run, 6);
  assert.equal(summary.quality.not_run_count, 10);
  assert.equal(summary.quality.primary.end_to_end_correct_rate, null);
  assert.equal(summary.requests.success_latency_ms.p50, null);
  assert.equal(reported.output, out);
  assert.equal(reported.quality.not_run_count, 10);
  await assert.rejects(run(directory, ['--plan', '--provider', 'agy', '--out', out]), /EEXIST/);
  assert.deepEqual(JSON.parse(await readFile(join(out, 'summary.json'), 'utf8')), summary);
});

test('runner measures a local fake agy end to end, preserves numeric predictions and excludes warmup', async (t) => {
  const directory = await workspace(t);
  const suitePath = join(directory, 'fixture.jsonl');
  const binary = join(directory, 'fake-agy.mjs');
  const capture = join(directory, 'provider-inputs.jsonl');
  const out = join(directory, 'results');
  const rows = [
    example({ id: 'fixture-dev', split: 'dev' }),
    example({ id: 'fixture-bool', rationale: 'PRIVATE_RATIONALE_BOOLEAN' }),
    example({ id: 'fixture-choice', request: { state: { shipment_ready: true }, questions: [
      { id: 'decision', type: 'choice', prompt: 'ship = ready; hold = not ready.', options: ['ship', 'hold'] },
    ] }, expected: { decision: 'ship' }, rationale: 'PRIVATE_RATIONALE_CHOICE' }),
    example({ id: 'fixture-score', request: { state: { completed_checks: 2 }, questions: [
      { id: 'decision', type: 'score', prompt: 'Score the completed checks from 0 to 2.', min: 0, max: 2 },
    ] }, expected: { decision: 2 }, rationale: 'PRIVATE_RATIONALE_SCORE' }),
  ];
  await writeFile(suitePath, jsonl(rows));
  // This deterministic fixture validates plumbing; it does not perform model inference.
  // In particular, its boolean answer is intentionally wrong and its score is fractional.
  await writeFile(binary, `#!${process.execPath}\n
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('AGY 1.2.7'); process.exit(0); }
if (args[0] === '--help') { console.log('  --json-schema Schema\\n  --private-option Private'); process.exit(0); }
if (args[0] === 'models') { console.log('gemini-3.8-flash-low Fixture\\nPRIVATE_MODEL Fixture'); process.exit(0); }
let input = '';
for await (const chunk of process.stdin) input += chunk;
const prompt = JSON.parse(input).message.content;
appendFileSync(${JSON.stringify(capture)}, JSON.stringify({ prompt }) + '\\n');
const request = JSON.parse(prompt.split('<request-json>\\n')[1].split('\\n</request-json>')[0]);
const results = request.questions.map(question => ({
  id: question.id, type: question.type, confidence: 0.9,
  value: question.type === 'boolean' ? true : question.type === 'choice' ? question.options[0] : 1.5,
})).reverse();
console.log(JSON.stringify({ event: 'init', init: { tools: [], model: 'gemini-3.8-flash-low' } }));
console.log(JSON.stringify({ event: 'result', result: {
  status: 'SUCCESS', structured_output: { results }, duration_seconds: 0.001,
  usage: { input_tokens: 10, output_tokens: 5 },
} }));
`, { mode: 0o700 });
  const { stdout } = await run(directory, [
    '--provider', 'agy', '--agy-bin', binary, '--suite', suitePath, '--split', 'test',
    '--repeats', '2', '--batch-size', '2', '--warmup', '1', '--out', out,
  ]);
  const summary = JSON.parse(await readFile(join(out, 'summary.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  const records = parseJsonl(await readFile(join(out, 'records.jsonl'), 'utf8'));
  const requests = parseJsonl(await readFile(join(out, 'requests.jsonl'), 'utf8'));
  const inputs = parseJsonl(await readFile(capture, 'utf8'));
  assert.equal(JSON.parse(stdout).status, 'completed');
  assert.equal(manifest.status, 'completed');
  assert.equal(manifest.backend.agy_version, '1.2.7');
  assert.equal(manifest.backend.requested_model_listed, true);
  const probe = JSON.parse(await readFile(join(out, 'probe.json'), 'utf8'));
  assert.deepEqual(probe.models, ['gemini-3.8-flash-low']);
  assert.deepEqual(probe.capabilities, ['--json-schema']);
  assert.equal(probe.metadata_scope, 'sanitized_to_tested_backend');
  assert.equal(manifest.dataset.snapshot_sha256, sha256(await readFile(join(out, 'cases.jsonl'))));
  assert.equal(summary.requests.planned, 4);
  assert.equal(summary.requests.attempted, 4);
  assert.equal(summary.requests.successful, 4);
  assert.equal(summary.requests.warmup_attempts, 1);
  assert.equal(inputs.length, 5);
  assert.equal(requests.length, 5);
  assert.equal(records.filter(row => row.phase === 'warmup').length, 1);
  assert.equal(records.filter(row => row.phase === 'measure').length, 6);
  assert.equal(summary.quality.primary.record_count, 3);
  assert.equal(summary.quality.repeated.record_count, 6);
  assert.equal(summary.quality.primary.correct_count, 2);
  assert.equal(summary.quality.primary.choice_bool_accuracy, 0.5);
  assert.equal(summary.quality.primary.score_mae, 0.5);
  assert.equal(summary.quality.primary.score_exact_match, 0);
  assert.equal(summary.quality.repeat_consistency.consistency_rate, 1);
  for (const record of records.filter(row => row.phase === 'measure')) {
    assert.equal(record.status, 'ok');
    assert.equal(record.results.length, 1);
    assert.equal(record.results[0].id, 'decision');
    if (record.case_id === 'fixture-score') assert.equal(record.results[0].value, 1.5);
    if (record.case_id === 'fixture-bool') assert.equal(record.score.correct, false);
  }
  for (const { prompt } of inputs) {
    assert.ok(!prompt.includes('PRIVATE_RATIONALE'));
    for (const row of rows) assert.ok(!prompt.includes(row.id));
    assert.ok(!prompt.includes('"expected"'));
    assert.ok(!prompt.includes('"rationale"'));
  }
});
