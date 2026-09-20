import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const tarball = join(root, 'dist', 'fast-jev.tgz');
const expected = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const digest = createHash('sha256').update(await readFile(tarball)).digest('hex');
assert.equal(await readFile(join(root, 'dist', 'SHA256SUMS'), 'utf8'), `${digest}  fast-jev.tgz\n`);
const temporary = await mkdtemp(join(tmpdir(), 'fast-jev-installed-'));
const prefix = join(temporary, 'install');
const cwd = join(temporary, 'unrelated-directory');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:FAST_JEV_|OPENAI_)/.test(key)));
env.XDG_CONFIG_HOME = join(temporary, 'config');

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options,
  });
}

try {
  await mkdir(cwd, { recursive: true });
  await mkdir(prefix);
  run('npm', ['install', '--prefix', prefix, '--offline', '--ignore-scripts',
    '--no-audit', '--no-fund', '--no-package-lock', '--no-save',
    '--cache', join(temporary, 'cache'), tarball]);
  const installed = JSON.parse(await readFile(join(prefix, 'node_modules', 'fast-jev', 'package.json'), 'utf8'));
  assert.equal(installed.name, expected.name);
  assert.equal(installed.version, expected.version);
  for (const alias of ['fast-jev', 'fjev']) {
    const binary = join(prefix, 'node_modules', '.bin', alias);
    assert.equal(run(binary, ['--version']), `${expected.version}\n`);
    assert.match(run(binary, ['--help']), /typed decisions/);
    const decision = JSON.parse(run(binary, ['choose', 'Next step?', '--option', 'ship',
      '--option', 'investigate', '--context', 'Tests failed.', '--dry-run']));
    assert.deepEqual(decision.request.questions[0].options, ['ship', 'investigate']);
    assert.equal(decision.request.state, 'Tests failed.');
    const request = { state: 'HTTP 200 OK', questions: [{ id: 'healthy', type: 'boolean', prompt: 'Healthy?' }] };
    const batch = JSON.parse(run(binary, ['batch', '--input', '-', '--dry-run'], { input: JSON.stringify(request) }));
    assert.deepEqual(batch.request, request);
  }
  const api = run(process.execPath, ['--input-type=module', '-e', `
    import { buildDecision } from 'fast-jev';
    const plan = buildDecision({ state: 'OK', questions: [{ id: 'ok', type: 'boolean', prompt: 'OK?' }] });
    console.log(JSON.stringify(plan.request));
  `], { cwd: prefix });
  assert.equal(JSON.parse(api).questions[0].id, 'ok');
  console.log(`Verified fast-jev@${expected.version}: checksum, offline archive installation, both aliases, stdin, dry runs and package API.`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
