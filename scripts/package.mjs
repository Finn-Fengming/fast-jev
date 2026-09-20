import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'dist');
const staging = await mkdtemp(join(tmpdir(), 'fast-jev-package-'));
const allowed = new Set([
  'package.json', 'README.md', 'README.zh-CN.md', 'bin/fast-jev.mjs',
  'src/agy.mjs', 'src/cli.mjs', 'src/config.mjs', 'src/decision.mjs',
  'src/errors.mjs', 'src/providers.mjs', 'src/privacy.mjs', 'scripts/benchmark.mjs',
  'examples/config.json', 'examples/decisions.json', 'examples/items.json',
  'docs/architecture.md', 'docs/research-jev.md', 'docs/validation.md',
  'docs/distribution.md', 'docs/security.md',
]);

try {
  const [pack] = JSON.parse(execFileSync('npm', [
    'pack', '--json', '--offline', '--ignore-scripts', '--pack-destination', staging,
    '--cache', join(staging, 'cache'),
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  assert.equal(pack.name, 'fast-jev');
  assert.deepEqual(new Set(pack.files.map(file => file.path)), allowed, 'Unexpected package contents; review the release allowlist.');
  const tarball = await readFile(join(staging, pack.filename));
  const sha256 = createHash('sha256').update(tarball).digest('hex');
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, 'fast-jev.tgz.tmp'), tarball);
  await rename(join(destination, 'fast-jev.tgz.tmp'), join(destination, 'fast-jev.tgz'));
  await writeFile(join(destination, 'SHA256SUMS'), `${sha256}  fast-jev.tgz\n`);
  console.log(`Packed ${pack.name}@${pack.version}: dist/fast-jev.tgz (${tarball.length} bytes, ${pack.files.length} files)`);
  console.log(`SHA256 ${sha256}`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
