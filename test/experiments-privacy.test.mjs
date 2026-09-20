import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { publicAgyProbe } from '../experiments/lib/privacy.mjs';

test('public AGY metadata omits unrelated model inventory, flags and extra diagnostics', () => {
  const probe = {
    version: 'AGY 1.2.7\nPRIVATE_DIAGNOSTIC',
    models: ['selected-model', 'PRIVATE_MODEL'],
    capabilities: ['--sandbox', '--private-option', '--mode', '--effort', '--sandbox'],
    account: 'PRIVATE_ACCOUNT',
  };
  const original = structuredClone(probe);
  const output = publicAgyProbe(probe, 'selected-model');
  assert.equal(output.version, '1.2.7');
  assert.deepEqual(output.models, ['selected-model']);
  assert.deepEqual(output.capabilities, ['--mode', '--sandbox']);
  assert.equal(output.metadata_scope, 'sanitized_to_tested_backend');
  assert.ok(!JSON.stringify(output).includes('PRIVATE_'));
  assert.deepEqual(probe, original);
});

test('public AGY metadata does not invent unavailable models, flags or versions', () => {
  const output = publicAgyProbe({ version: 'PRIVATE_DIAGNOSTIC', models: ['other'], capabilities: [] }, 'selected-model');
  assert.equal(output.version, null);
  assert.deepEqual(output.models, []);
  assert.deepEqual(output.capabilities, []);
});

test('public AGY metadata retains the effort flag only for an effort-configured run', () => {
  const output = publicAgyProbe({ version: 'v1.2.7', models: ['selected-model'], capabilities: ['--effort'] }, 'selected-model', 'low');
  assert.equal(output.version, '1.2.7');
  assert.deepEqual(output.capabilities, ['--effort']);
});

test('compatible experiment manifests omit the configured endpoint host and path', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'fast-jev-privacy-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, 'config.json');
  await writeFile(config, '{}\n');
  const out = join(directory, 'results');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('FAST_JEV_') && !key.startsWith('OPENAI_')));
  env.XDG_CONFIG_HOME = directory;
  await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../experiments/run.mjs', import.meta.url)),
    '--config', config, '--plan', '--provider', 'openai', '--model', 'fixture-model',
    '--base-url', 'https://private-endpoint.invalid/private-route', '--limit', '1', '--out', out,
  ], { env, timeout: 15_000 });
  const text = await readFile(join(out, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(text);
  assert.equal(manifest.backend.endpoint_configured, true);
  assert.equal(manifest.backend.endpoint, undefined);
  assert.ok(!text.includes('private-endpoint'));
  assert.ok(!text.includes('private-route'));
});
