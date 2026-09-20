import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { AgyError, runAgy, probeAgy } from '../src/agy.mjs';

const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };

test('provides conventional CLI exit codes for AGY errors', () => {
  assert.equal(new AgyError('AGY_TIMEOUT', 'timeout').exitCode, 124);
  assert.equal(new AgyError('ABORTED', 'canceled').exitCode, 130);
  assert.equal(new AgyError('AGY_CONFIG', 'config').exitCode, 2);
  assert.equal(new AgyError('AGY_FAILED', 'backend').exitCode, 1);
});

async function fixture(t, config = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fast-jev-test-agy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const binary = join(dir, 'fake agy; literal.mjs');
  await writeFile(binary, `#!${process.execPath}\n
import { readFileSync } from 'node:fs';
const config = ${JSON.stringify(config)};
const args = process.argv.slice(2);
const emit = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
if (args[0] === config.probeFailure) { console.error(config.stderr); process.exit(1); }
if (args[0] === '--version') { console.log('1.2.3'); process.exit(0); }
if (args[0] === '--help') { console.error('Usage:\\n  --input-format Format\\n  --output-format Format\\n  --json-schema Schema\\n  --agent Agent\\n  --disable-slash-commands Disable'); process.exit(0); }
if (args[0] === 'models') { console.log('gemini-3.8-flash-low\\tGemini 3.8 Flash (Low)\\ngemini-3.8-flash-high\\tGemini 3.8 Flash (High)'); process.exit(0); }
if (config.mode === 'hang') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
else {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  if (config.mode === 'malformed') { console.log('not json'); process.exit(0); }
  if (config.mode === 'oversized') { process.stdout.write('x'.repeat(10000)); process.exit(0); }
  if (config.mode === 'stderr-failure') { console.error(config.stderr ?? 'authentication required'); process.exit(1); }
  emit({ event: 'init', init: { tools: config.tools ?? [], model: args[args.indexOf('--model') + 1] } });
  const payload = config.inspect ? {
    args, input: JSON.parse(input), cwd: process.cwd(),
    schema: JSON.parse(readFileSync(args[args.indexOf('--json-schema') + 1], 'utf8')),
  } : { ok: true };
  const result = { status: config.status ?? 'SUCCESS', duration_seconds: 1.25, usage: config.usage ?? { input_tokens: 12, output_tokens: 7 }, response: '{"ok":true}' };
  if (config.mode !== 'missing-structured') result.structured_output = payload;
  if (config.status && config.status !== 'SUCCESS') result.error = config.error ?? 'explicit backend failure';
  emit({ event: 'result', result });
  if (config.mode === 'multiple-results') emit({ event: 'result', result });
  process.exit(config.exitCode ?? 0);
}
`, { mode: 0o700 });
  await chmod(binary, 0o700);
  return binary;
}

test('uses literal argv, stdin, private workspace/schema and native plan/sandbox flags', async (t) => {
  const agyBin = await fixture(t, { inspect: true });
  const prompt = '中文 $(touch /tmp/do-not-create-fast-jev) `echo surprise`;\n/private/context';
  const result = await runAgy({ agyBin, prompt, schema });
  assert.equal(result.model, 'gemini-3.8-flash-low');
  assert.equal(result.backendDurationMs, 1250);
  assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 7 });
  assert.deepEqual(result.data.input, { event: 'user', message: { content: prompt } });
  assert.deepEqual(result.data.schema, schema);
  assert.ok(!result.data.args.some((arg) => arg.includes(prompt)));
  assert.ok(!result.data.args.includes('--dangerously-skip-permissions'));
  assert.ok(!result.data.args.includes('--effort'));
  assert.ok(result.data.args.includes('--disable-slash-commands'));
  assert.equal(result.data.args[result.data.args.indexOf('--mode') + 1], 'plan');
  assert.ok(result.data.args.includes('--sandbox'));
  assert.notEqual(result.data.cwd, process.cwd());
  await assert.rejects(access(result.data.cwd), { code: 'ENOENT' });
});

test('forwards an explicit model/effort and resolves relative executable paths', async (t) => {
  const binary = await fixture(t, { inspect: true });
  const result = await runAgy({ agyBin: relative(process.cwd(), binary), prompt: 'ok', schema, model: 'gemini-3.8-flash-high', effort: 'high' });
  assert.equal(result.model, 'gemini-3.8-flash-high');
  const index = result.data.args.indexOf('--effort');
  assert.equal(result.data.args[index + 1], 'high');
});

test('probe reads version, model slugs and help written to stderr without inference', async (t) => {
  const agyBin = await fixture(t);
  assert.deepEqual(await probeAgy({ agyBin }), {
    version: '1.2.3',
    models: ['gemini-3.8-flash-low', 'gemini-3.8-flash-high'],
    capabilities: ['--agent', '--disable-slash-commands', '--input-format', '--json-schema', '--output-format'],
  });
});

for (const status of ['ERROR', 'WAITING', 'CANCELED', 'INTERRUPTED', 'INVALID', 'RUNNING']) {
  test(`rejects backend ${status} even with exit code zero`, async (t) => {
    const agyBin = await fixture(t, { status });
    await assert.rejects(runAgy({ agyBin, prompt: 'ok', schema }), { code: 'AGY_FAILED', message: 'AGY failed. Run fast-jev doctor and check AGY directly for details.' });
  });
}

test('rejects nonzero exits even if the JSON status says SUCCESS', async (t) => {
  const agyBin = await fixture(t, { exitCode: 7 });
  await assert.rejects(runAgy({ agyBin, prompt: 'ok', schema }), { code: 'AGY_FAILED' });
});

test('reports authentication failures from stderr', async (t) => {
  const agyBin = await fixture(t, { mode: 'stderr-failure' });
  await assert.rejects(runAgy({ agyBin, prompt: 'ok', schema }), { code: 'AGY_FAILED', message: /requires authentication/ });
});

for (const [label, diagnostic, advice] of [
  ['authentication', 'authentication required', 'Sign in to AGY'],
  ['quota', 'resource_exhausted 429', 'Check usage limits'],
  ['timeout', 'request timed out', 'increase --timeout'],
  ['unknown', 'unexpected backend failure', 'check AGY directly'],
]) {
  test(`AGY ${label} diagnostics return safe advice without echoing stderr`, async (t) => {
    const canary = 'private-backend-canary';
    const agyBin = await fixture(t, { mode: 'stderr-failure', stderr: `${diagnostic}; credential=${canary}; prompt=${canary}` });
    await assert.rejects(runAgy({ agyBin, prompt: 'ok', schema }), (error) => {
      assert.equal(error.code, 'AGY_FAILED');
      assert.ok(error.message.includes(advice));
      assert.ok(!error.message.includes(canary), 'Backend stderr must stay private.');
      assert.equal(error.cause, undefined);
      return true;
    });
  });
}

test('AGY result envelopes cannot inject diagnostics or status into errors', async (t) => {
  const canary = 'private-result-canary';
  const agyBin = await fixture(t, { status: canary, error: { message: `authentication required; ${canary}`, code: canary } });
  await assert.rejects(runAgy({ agyBin, prompt: 'ok', schema }), (error) => {
    assert.equal(error.code, 'AGY_FAILED');
    assert.ok(error.message.includes('Sign in to AGY'));
    assert.ok(!error.message.includes(canary), 'Backend envelope must stay private.');
    return true;
  });
});

test('probe failures keep backend diagnostics private', async (t) => {
  const canary = 'private-probe-canary';
  const agyBin = await fixture(t, { probeFailure: 'models', stderr: `authorization failed; ${canary}` });
  await assert.rejects(probeAgy({ agyBin }), (error) => {
    assert.equal(error.code, 'AGY_FAILED');
    assert.ok(error.message.includes('AGY models check failed'));
    assert.ok(!error.message.includes(canary), 'Probe stderr must stay private.');
    return true;
  });
});

test('AGY usage preserves numeric counts and excludes arbitrary backend metadata', async (t) => {
  const canary = 'private-usage-canary';
  const agyBin = await fixture(t, { usage: {
    input_tokens: 12, output_tokens: 7, thinking_tokens: 0, cache_read_tokens: 2,
    total_tokens: canary, secret: canary, prompt_tokens_details: { cached_tokens: 2, note: canary },
  } });
  const result = await runAgy({ agyBin, prompt: 'ok', schema });
  assert.ok(!JSON.stringify(result.usage).includes(canary), 'Usage metadata must contain token counts only.');
  assert.deepEqual(result.usage, { input_tokens: 12, output_tokens: 7, thinking_tokens: 0, cache_read_tokens: 2, prompt_tokens_details: { cached_tokens: 2 } });
});

test('missing executable diagnostics omit private paths and native error causes', async () => {
  const canary = 'private-executable-canary';
  await assert.rejects(runAgy({ agyBin: `/nonexistent/${canary}`, prompt: 'ok', schema }), (error) => {
    assert.equal(error.code, 'AGY_NOT_FOUND');
    assert.ok(!error.message.includes(canary), 'Executable paths must stay private.');
    assert.equal(error.cause, undefined);
    return true;
  });
});

for (const mode of ['missing-structured', 'malformed', 'multiple-results']) {
  test(`rejects ${mode} protocol output`, async (t) => {
    const agyBin = await fixture(t, { mode });
    await assert.rejects(runAgy({ agyBin, prompt: 'ok', schema }), { code: 'AGY_PROTOCOL' });
  });
}

test('accepts the tool registry exposed by AGY 1.2.3 in its init metadata', async (t) => {
  const agyBin = await fixture(t, { tools: ['run_command'] });
  assert.deepEqual((await runAgy({ agyBin, prompt: 'ok', schema })).data, { ok: true });
});

test('kills a process that ignores SIGTERM after its timeout', async (t) => {
  const agyBin = await fixture(t, { mode: 'hang' });
  const started = Date.now();
  await assert.rejects(runAgy({ agyBin, prompt: 'ok', schema, timeoutMs: 120 }), { code: 'AGY_TIMEOUT' });
  assert.ok(Date.now() - started < 2000);
});

test('supports cancellation while a process is running', async (t) => {
  const agyBin = await fixture(t, { mode: 'hang' });
  const controller = new AbortController();
  const pending = runAgy({ agyBin, prompt: 'ok', schema, signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  await assert.rejects(pending, { code: 'ABORTED' });
});

test('does not launch a process for an already canceled request', async () => {
  await assert.rejects(runAgy({ agyBin: '/nonexistent/agy', prompt: 'ok', schema, signal: AbortSignal.abort() }), { code: 'ABORTED' });
});

test('limits combined backend output', async (t) => {
  const agyBin = await fixture(t, { mode: 'oversized' });
  await assert.rejects(runAgy({ agyBin, prompt: 'ok', schema, maxBuffer: 1024 }), { code: 'AGY_OUTPUT_LIMIT' });
});

test('reports a missing executable clearly', async () => {
  await assert.rejects(runAgy({ agyBin: '/nonexistent/fast-jev-agy', prompt: 'ok', schema }), { code: 'AGY_NOT_FOUND', message: /Install AGY/ });
});
