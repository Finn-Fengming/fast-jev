import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.mjs';

const directory = await mkdtemp(join(tmpdir(), 'fast-jev-cli-test-'));
after(() => rm(directory, { recursive: true, force: true }));
const baseEnv = { XDG_CONFIG_HOME: directory };
const openai = ['--provider', 'openai', '--model', 'test-model'];
const binary = fileURLToPath(new URL('../bin/fast-jev.mjs', import.meta.url));

async function invoke(args, { input = '', tty = true, env = {}, signal } = {}) {
  const stdin = Readable.from([Buffer.from(input)]);
  stdin.isTTY = tty;
  let stdout = '';
  let stderr = '';
  const previousCode = process.exitCode;
  try {
    const code = await main(args, {
      stdin, stdout: { write: text => { stdout += text; } }, stderr: { write: text => { stderr += text; } },
      env: { ...baseEnv, ...env }, signal,
    });
    return { code, stdout, stderr };
  } finally { process.exitCode = previousCode; }
}

function model(t, results, usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }) {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), headers: options.headers });
    return new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ results }) } }], usage,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

test('help and version work without model credentials or installed backends', async () => {
  for (const args of [[], ['--help'], ['choose', '--help']]) {
    const output = await invoke(args);
    assert.equal(output.code, 0);
    assert.match(output.stdout, /fast-jev.*typed decisions/);
    assert.equal(output.stderr, '');
  }
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal((await invoke(['--version'])).stdout, `${version}\n`);
});

test('dry-run creates exact choice requests without calling a provider', async (t) => {
  const calls = model(t, []);
  const output = await invoke(['choose', '发货还是等待？', '--option', '发货', '--option', '等待', '--context', '库存不足', '--dry-run']);
  assert.equal(output.code, 0);
  const plan = JSON.parse(output.stdout);
  assert.equal(plan.provider, 'agy');
  assert.deepEqual(plan.request, {
    state: '库存不足', questions: [{ id: 'decision', type: 'choice', prompt: '发货还是等待？', options: ['发货', '等待'] }],
  });
  assert.equal(calls.length, 0);
});

test('classify accepts JSON options and piped text; score accepts a custom range', async () => {
  const choice = await invoke(['classify', 'Queue?', '--options', '["billing","bug"]', '--dry-run'], { input: 'charged twice', tty: false });
  assert.equal(choice.code, 0);
  assert.equal(JSON.parse(choice.stdout).request.state, 'charged twice');
  const score = await invoke(['score', 'Priority?', '--min=-5', '--max', '5', '--context', 'urgent', '--dry-run']);
  assert.equal(score.code, 0);
  assert.equal(JSON.parse(score.stdout).request.questions[0].min, -5);
  assert.equal(JSON.parse(score.stdout).request.questions[0].max, 5);
});

test('context combines explicit text and file content without consuming unused stdin', async () => {
  const path = join(directory, 'context.txt');
  await writeFile(path, 'file evidence');
  const output = await invoke(['check', 'OK?', '--context', 'text evidence', '--file', path, '--dry-run'], { input: 'unused', tty: false });
  assert.equal(output.code, 0);
  assert.equal(JSON.parse(output.stdout).request.state, 'text evidence\n\nfile evidence');
});

test('batch accepts typed JSON from stdin and enforces unknown-field validation', async () => {
  const request = { state: { count: 7 }, questions: [{ id: 'ok', type: 'boolean', prompt: 'Count positive?' }] };
  const output = await invoke(['batch', '--input', '-', '--dry-run'], { input: JSON.stringify(request), tty: false });
  assert.equal(output.code, 0);
  assert.deepEqual(JSON.parse(output.stdout).request, request);
  const invalid = await invoke(['decide', '--dry-run'], { input: JSON.stringify({ ...request, typo: true }), tty: false });
  assert.equal(invalid.code, 2);
  assert.equal(JSON.parse(invalid.stderr).error.code, 'INVALID_REQUEST');
});

test('rejects malformed flags and incompatible command options before provider calls', async (t) => {
  const calls = model(t, []);
  const cases = [
    ['unknown'], ['check'], ['check', 'OK?', 'extra'], ['check', 'OK?', '--top', '1'],
    ['check', 'OK?', '--pretty', '--text'], ['check', 'OK?', '--unknown'],
    ['check', 'OK?', '--model', 'a', '--model', 'b'],
    ['choose', 'Pick?', '--option', 'a'],
    ['choose', 'Pick?', '--options', 'not-json'],
    ['choose', 'Pick?', '--option', 'a', '--option', 'b', '--options', '["a","b"]'],
    ['score', 'Rate?', '--min', '2', '--max', '1'],
    ['score', 'Rate?', '--max', 'NaN'],
    ['check', 'OK?', '--min-confidence', '1.1'],
    ['config', '--context', 'no'], ['doctor', '--dry-run'],
    ['rank', 'Rank?', '--top', '1.5'],
    ['check', 'OK?', '--base-url', 'https://example.invalid/v1'],
    ['check', 'OK?', '--response-format', 'text'],
    ['check', 'OK?', '--max-tokens', '10'],
    ['check', 'OK?', ...openai, '--agy-bin', 'agy'],
    ['check', 'OK?', '--agy-bin', 'bad\0path'],
  ];
  for (const args of cases) {
    const output = await invoke(args, { input: '["a","b"]', tty: false });
    assert.equal(output.code, 2, `${JSON.stringify(args)}: ${output.stderr}`);
    assert.equal(output.stdout, '');
    assert.ok(JSON.parse(output.stderr).error.message);
  }
  assert.equal(calls.length, 0);
});

test('rejects oversized stdin, nonregular files, malformed JSON, and absent JSON input', async () => {
  const cases = [
    [ ['check', 'OK?', '--dry-run'], { input: 'x'.repeat(256 * 1024 + 1), tty: false } ],
    [ ['check', 'OK?', '--file', directory, '--dry-run'], {} ],
    [ ['check', 'OK?', '--file', join(directory, 'missing'), '--dry-run'], {} ],
    [ ['decide', '--dry-run'], { input: '{', tty: false } ],
    [ ['decide', '--dry-run'], {} ],
    [ ['rank', 'Rank?', '--dry-run'], { input: '[]', tty: false } ],
    [ ['filter', 'Keep?', '--dry-run'], { input: '{}', tty: false } ],
  ];
  for (const [args, options] of cases) {
    const output = await invoke(args, options);
    assert.equal(output.code, 2, output.stderr);
    assert.equal(output.stdout, '');
  }
});

test('config output excludes configured API keys and reports their presence', async () => {
  const output = await invoke(['config', ...openai], { env: { OPENAI_API_KEY: 'sensitive-test-key' } });
  assert.equal(output.code, 0);
  assert.equal(JSON.parse(output.stdout).apiKeyConfigured, true);
  assert.equal(JSON.parse(output.stdout).apiKey, undefined);
  assert.ok(!output.stdout.includes('sensitive-test-key'));
  assert.equal(output.stderr, '');
});

test('doctor can validate an OpenAI-compatible configuration without a request', async (t) => {
  const calls = model(t, []);
  const output = await invoke(['doctor', ...openai]);
  assert.equal(output.code, 0);
  assert.equal(JSON.parse(output.stdout).status, 'configuration_checked');
  assert.equal(calls.length, 0);
});

test('single decisions use one provider call and preserve meta and exact string output', async (t) => {
  const calls = model(t, [{ id: 'decision', type: 'choice', value: 'hold', confidence: 0.8 }]);
  const output = await invoke(['choose', 'Next?', '--option', 'ship', '--option', 'hold', '--context', 'Tests failed', ...openai]);
  assert.equal(output.code, 0, output.stderr);
  assert.equal(calls.length, 1);
  const value = JSON.parse(output.stdout);
  assert.equal(value.result.value, 'hold');
  assert.equal(value.result.status, 'ok');
  assert.equal(value.meta.provider, 'openai');
  assert.equal(value.meta.model, 'test-model');
  assert.equal(value.meta.confidence_kind, 'self_reported');
  assert.equal(value.meta.calibrated, false);
  assert.equal(value.meta.usage.total_tokens, 15);
  assert.equal(calls[0].body.response_format.json_schema.strict, true);
});

test('boolean false remains a successful result in text mode', async (t) => {
  model(t, [{ id: 'decision', type: 'boolean', value: false, confidence: 0.9 }]);
  const output = await invoke(['check', 'Healthy?', '--context', 'Down', '--text', ...openai]);
  assert.equal(output.code, 0, output.stderr);
  assert.equal(output.stdout, 'false\n');
});

test('abstention nulls values, preserves explanations, and exits with 4', async (t) => {
  model(t, [{ id: 'decision', type: 'boolean', value: false, confidence: 0.2, reason: 'Evidence is incomplete.' }]);
  const output = await invoke(['check', 'Healthy?', '--context', 'Unknown', '--min-confidence', '0.8', '--explain', ...openai]);
  assert.equal(output.code, 4);
  const result = JSON.parse(output.stdout).result;
  assert.equal(result.value, null);
  assert.equal(result.status, 'abstained');
  assert.equal(result.reason, 'Evidence is incomplete.');
});

test('ranking handles reordered model results, stable ties, top limits, and abstentions', async (t) => {
  model(t, [
    { id: '3', type: 'score', value: 0.9, confidence: 0.2 },
    { id: '2', type: 'score', value: 0.8, confidence: 0.9 },
    { id: '1', type: 'score', value: 0.8, confidence: 0.9 },
    { id: '0', type: 'score', value: 0.4, confidence: 0.9 },
  ]);
  const output = await invoke(['rank', 'Best?', '--top', '2', '--min-confidence', '0.8', ...openai], { input: '["a","b","c","d"]', tty: false });
  assert.equal(output.code, 4, output.stderr);
  const data = JSON.parse(output.stdout);
  assert.deepEqual(data.result.map(entry => entry.item), ['b', 'c']);
  assert.deepEqual(data.result.map(entry => entry.index), [1, 2]);
  assert.deepEqual(data.abstained.map(entry => entry.item), ['d']);
});

test('filter text output returns only matching items', async (t) => {
  model(t, [
    { id: '0', type: 'boolean', value: false, confidence: 0.9 },
    { id: '1', type: 'boolean', value: true, confidence: 0.9 },
  ]);
  const output = await invoke(['filter', 'Keep?', '--text', ...openai], { input: '[{"name":"a"},{"name":"b"}]', tty: false });
  assert.equal(output.code, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout), [{ name: 'b' }]);
});

test('invalid model output is rejected without retries or partial stdout', async (t) => {
  const calls = model(t, [{ id: 'decision', type: 'boolean', value: 'true', confidence: 0.9 }]);
  const output = await invoke(['check', 'Healthy?', '--context', 'OK', ...openai]);
  assert.equal(output.code, 1);
  assert.equal(output.stdout, '');
  assert.equal(JSON.parse(output.stderr).error.code, 'INVALID_OUTPUT');
  assert.equal(calls.length, 1);
});

test('node executable produces documented success and input-error exit codes', () => {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, XDG_CONFIG_HOME: directory };
  const good = spawnSync(process.execPath, [binary, 'check', 'OK?', '--context', 'yes', '--dry-run'], { encoding: 'utf8', env });
  assert.equal(good.status, 0, good.stderr);
  assert.equal(JSON.parse(good.stdout).request.questions[0].type, 'boolean');
  const bad = spawnSync(process.execPath, [binary, 'score', 'Rate?', '--min', '10', '--max', '0'], { encoding: 'utf8', env, input: '' });
  assert.equal(bad.status, 2, bad.stderr);
  assert.equal(bad.stdout, '');
  assert.ok(JSON.parse(bad.stderr).error.message);
});

test('agy process deadlines produce the documented timeout exit code', async () => {
  const path = join(directory, 'hanging-agy.mjs');
  await writeFile(path, '#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n', { mode: 0o755 });
  const output = await invoke(['check', 'Healthy?', '--context', 'OK', '--agy-bin', path, '--timeout', '30']);
  assert.equal(output.code, 124, output.stderr);
  assert.equal(output.stdout, '');
  assert.equal(JSON.parse(output.stderr).error.code, 'AGY_TIMEOUT');
});
