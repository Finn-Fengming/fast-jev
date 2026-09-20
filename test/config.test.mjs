import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from '../src/config.mjs';

const directory = await mkdtemp(join(tmpdir(), 'fast-jev-config-test-'));
after(() => rm(directory, { recursive: true, force: true }));
let sequence = 0;

async function config(value) {
  const path = join(directory, `config-${sequence++}.json`);
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
  return path;
}

test('defaults to agy without reading project-local configuration', async () => {
  const options = await resolveConfig({}, { XDG_CONFIG_HOME: join(directory, 'missing') });
  assert.equal(options.provider, 'agy');
  assert.equal(options.model, 'gemini-3.8-flash-low');
  assert.equal(options.agyBin, 'agy');
  assert.equal(options.timeoutMs, 60_000);
});

test('loads the XDG configuration location and resolves provider-specific settings', async () => {
  const root = join(directory, 'xdg');
  await mkdir(join(root, 'fast-jev'), { recursive: true });
  await writeFile(join(root, 'fast-jev', 'config.json'), JSON.stringify({ provider: 'agy', agy: { model: 'local-flash', agyBin: '/custom/agy', effort: 'low' } }));
  const options = await resolveConfig({}, { XDG_CONFIG_HOME: root });
  assert.equal(options.model, 'local-flash');
  assert.equal(options.agyBin, '/custom/agy');
  assert.equal(options.effort, 'low');
});

test('flags override environment variables, which override file configuration', async () => {
  const path = await config({
    provider: 'agy', timeoutMs: 123,
    agy: { model: 'file-agy', effort: 'low' },
    openai: { model: 'file-model', baseUrl: 'https://file.invalid/v1', responseFormat: 'text', effort: 'low', maxTokens: 10, apiKeyEnv: 'CUSTOM_KEY' },
  });
  const env = {
    FAST_JEV_CONFIG: path, FAST_JEV_PROVIDER: 'openai', FAST_JEV_MODEL: 'env-model',
    FAST_JEV_TIMEOUT_MS: '456', FAST_JEV_EFFORT: 'medium', OPENAI_BASE_URL: 'https://env.invalid/v1',
    FAST_JEV_RESPONSE_FORMAT: 'json_object', CUSTOM_KEY: 'custom-key', OPENAI_API_KEY: 'unused-key',
  };
  const fromEnv = await resolveConfig({}, env);
  assert.equal(fromEnv.provider, 'openai');
  assert.equal(fromEnv.model, 'env-model');
  assert.equal(fromEnv.timeoutMs, 456);
  assert.equal(fromEnv.baseUrl, 'https://env.invalid/v1');
  assert.equal(fromEnv.responseFormat, 'json_object');
  assert.equal(fromEnv.effort, 'medium');
  assert.equal(fromEnv.maxTokens, 10);
  assert.equal(fromEnv.apiKey, 'custom-key');
  const fromFlags = await resolveConfig({
    model: 'flag-model', timeout: '789', effort: 'high', 'base-url': 'https://flag.invalid/v1',
    'response-format': 'json_schema', 'max-tokens': '20',
  }, { ...env, FAST_JEV_API_KEY: 'preferred-key' });
  assert.equal(fromFlags.model, 'flag-model');
  assert.equal(fromFlags.timeoutMs, 789);
  assert.equal(fromFlags.baseUrl, 'https://flag.invalid/v1');
  assert.equal(fromFlags.responseFormat, 'json_schema');
  assert.equal(fromFlags.effort, 'high');
  assert.equal(fromFlags.maxTokens, 20);
  assert.equal(fromFlags.apiKey, 'preferred-key');
});

test('explicit config flags override FAST_JEV_CONFIG', async () => {
  const first = await config({ agy: { model: 'first' } });
  const second = await config({ agy: { model: 'second' } });
  const options = await resolveConfig({ config: first }, { FAST_JEV_CONFIG: second });
  assert.equal(options.model, 'first');
});

test('agy executable resolution obeys flags, environment, and provider selection', async () => {
  const path = await config({ agy: { agyBin: '/file/agy' }, openai: { model: 'http-model' } });
  const env = { FAST_JEV_CONFIG: path, FAST_JEV_AGY_BIN: '/env/agy' };
  assert.equal((await resolveConfig({}, env)).agyBin, '/env/agy');
  assert.equal((await resolveConfig({ 'agy-bin': '/flag/agy' }, env)).agyBin, '/flag/agy');
  const http = await resolveConfig({ provider: 'openai' }, env);
  assert.equal(http.model, 'http-model');
  assert.equal(http.agyBin, undefined);
});

test('missing explicit files and malformed JSON fail instead of silently defaulting', async () => {
  await assert.rejects(resolveConfig({ config: join(directory, 'does-not-exist.json') }, {}), { code: 'INVALID_INPUT', exitCode: 2 });
  await assert.rejects(resolveConfig({ config: await config('{bad json') }, {}), /invalid JSON/);
});

test('rejects unknown configuration fields, including credentials stored inline', async () => {
  for (const value of [
    [], null, { typo: true }, { timeout: 100 }, { agy: { typo: true } },
    { openai: { apiKey: 'inline-secret' } }, { openai: [] }, { agy: null },
  ]) {
    await assert.rejects(resolveConfig({ config: await config(value) }, {}), { code: 'INVALID_INPUT', exitCode: 2 });
  }
});

test('invalid backend configuration fails before issuing requests', async () => {
  for (const value of [
    { provider: 'other' }, { timeoutMs: '100' }, { timeoutMs: 0 },
    { agy: { model: '' } }, { agy: { effort: 'maximum' } },
    { provider: 'openai' }, { provider: 'openai', openai: { model: 'model', maxTokens: 0 } },
    { provider: 'openai', openai: { model: 'model', responseFormat: 'xml' } },
    { provider: 'openai', openai: { model: 'model', apiKeyEnv: 'INVALID NAME' } },
    { provider: 'openai', openai: { model: 'model', baseUrl: 'https://user:secret@example.invalid/v1' } },
  ]) {
    await assert.rejects(resolveConfig({ config: await config(value) }, {}), { code: 'INVALID_INPUT', exitCode: 2 });
  }
});

test('supports anonymous local compatible servers and never puts the key in the URL', async () => {
  const options = await resolveConfig({ provider: 'openai', model: 'local', 'base-url': 'http://127.0.0.1:8080/v1/' }, { XDG_CONFIG_HOME: join(directory, 'absent') });
  assert.equal(options.apiKey, undefined);
  assert.equal(options.url, 'http://127.0.0.1:8080/v1/chat/completions');
  assert.equal(options.responseFormat, 'json_schema');
});

test('rejects flags for the wrong backend instead of silently ignoring them', async () => {
  const env = { XDG_CONFIG_HOME: join(directory, 'absent') };
  for (const flags of [
    { 'base-url': 'https://example.invalid/v1' },
    { 'response-format': 'text' },
    { 'max-tokens': '10' },
    { provider: 'openai', model: 'test-model', 'agy-bin': '/custom/agy' },
  ]) {
    await assert.rejects(resolveConfig(flags, env), { code: 'INVALID_INPUT', exitCode: 2 });
  }
  const path = await config({ provider: 'openai', openai: { model: 'file-model' } });
  await assert.rejects(resolveConfig({ config: path, 'agy-bin': 'agy' }, {}), /does not apply to provider openai/);
  await assert.rejects(resolveConfig({ 'agy-bin': 'agy' }, { ...env, FAST_JEV_PROVIDER: 'openai', FAST_JEV_MODEL: 'env-model' }), /does not apply to provider openai/);
});

test('validates all configured string fields even in the inactive backend scope', async () => {
  const fields = {
    agy: ['model', 'agyBin', 'effort'],
    openai: ['model', 'baseUrl', 'apiKeyEnv', 'responseFormat', 'effort'],
  };
  for (const [scope, names] of Object.entries(fields)) {
    for (const name of names) {
      for (const value of [null, 17, false, '', '  ']) {
        const path = await config({ [scope]: { [name]: value } });
        await assert.rejects(resolveConfig({ config: path }, {}), { code: 'INVALID_INPUT', exitCode: 2 }, `${scope}.${name} = ${JSON.stringify(value)}`);
      }
    }
  }
});

test('rejects invalid agy executable settings before starting a process', async () => {
  const env = { XDG_CONFIG_HOME: join(directory, 'absent') };
  for (const agyBin of ['', ' ', 'agy\0suffix', 7]) {
    await assert.rejects(resolveConfig({ 'agy-bin': agyBin }, env), { code: 'INVALID_INPUT', exitCode: 2 });
  }
  await assert.rejects(resolveConfig({}, { ...env, FAST_JEV_AGY_BIN: 'bad\0path' }), { code: 'INVALID_INPUT', exitCode: 2 });
  await assert.rejects(resolveConfig({ config: await config({ agy: { agyBin: 'bad\0path' } }) }, {}), { code: 'INVALID_INPUT', exitCode: 2 });
});
