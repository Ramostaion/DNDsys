import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { inspectDatabaseRuntime, prepareDatabaseRuntime } from './launcher-database-runtime.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dnd-runtime-'));
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
function runtime(folder, complete = true) {
  const dev = join(folder, 'node_modules/@prisma/dev'),
    pg = join(folder, 'node_modules/@electric-sql/pglite');
  mkdirSync(join(dev, 'dist'), { recursive: true });
  mkdirSync(join(pg, 'dist'), { recursive: true });
  writeFileSync(join(dev, 'package.json'), JSON.stringify({ version: '0.25.2', type: 'module' }));
  writeFileSync(join(pg, 'package.json'), JSON.stringify({ version: '0.4.3', type: 'module' }));
  for (const name of complete ? ['pglite.wasm', 'initdb.wasm', 'pglite.data'] : ['pglite.data'])
    writeFileSync(join(pg, 'dist', name), 'valid-core');
  // Bundled Prisma assets can be complete even when PGlite's own native files are missing.
  writeFileSync(join(dev, 'dist/pglite.wasm'), 'bundled-core');
  writeFileSync(
    join(dev, 'dist/index.js'),
    `import {fileURLToPath} from 'node:url'; export const getPrismaDevRuntimeAssetManifest=()=>[{fileName:'pglite.wasm',sourcePath:fileURLToPath(new URL('./pglite.wasm',import.meta.url))}];`,
  );
}
test('rejects missing native WASM despite a valid bundled Prisma manifest', async (t) => {
  const root = fixture(t);
  runtime(root, false);
  assert.equal((await inspectDatabaseRuntime(root)).ready, false);
  assert.match((await inspectDatabaseRuntime(root)).reason, /pglite.wasm/);
});
test('recovers an older complete cache and reuses it independently of future daily caches', async (t) => {
  const root = fixture(t),
    cache = join(root, 'cache');
  runtime(join(cache, 'cli-dev@latest-100'), true);
  runtime(join(cache, 'cli-dev@latest-200'), false);
  const result = await prepareDatabaseRuntime(root, cache);
  assert.equal(result.ready, true);
  assert.equal(result.recovered, true);
  assert.ok(result.modulePath.startsWith(join(root, '.launcher/runtime/database')));
  const reused = await prepareDatabaseRuntime(root, join(root, 'missing-cache'));
  assert.equal(reused.reused, true);
});
test('no valid cache requests a pinned installation without changing game data', async (t) => {
  const root = fixture(t),
    cache = join(root, 'cache');
  runtime(join(cache, 'cli-dev@latest-300'), false);
  const data = join(root, '.local-database/keep');
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, 'save'), 'existing-room');
  const result = await prepareDatabaseRuntime(root, cache);
  assert.equal(result.ready, false);
  assert.equal(result.needsInstall, true);
  assert.equal(readFileSync(join(data, 'save'), 'utf8'), 'existing-room');
  assert.equal(existsSync(join(result.folder, 'node_modules')), false);
});
test('repairs a partial project runtime and preserves the incomplete folder for diagnosis', async (t) => {
  const root = fixture(t),
    cache = join(root, 'cache');
  runtime(join(root, '.launcher/runtime/database'), false);
  runtime(join(cache, 'cli-dev@latest-100'), true);
  assert.equal((await prepareDatabaseRuntime(root, cache)).ready, true);
});
