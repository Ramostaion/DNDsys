import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { readLauncherConfig } from './launcher-config.mjs';
import { relocateDatabasePaths } from './launcher-database.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dnd-portability-'));
  t.after(() => {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep));
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
const env = { DATABASE_URL: 'postgresql://dnd:test@db.example:5432/dnd', WEB_ORIGIN: 'http://localhost:5242' };
test('launcher supports 5242 and does not expose credentials', () => {
  const config = readLauncherConfig(env);
  assert.equal(config.webPort, 5242);
  assert.equal(config.apiPort, 5242);
  assert.equal(config.mode, 'production');
  assert.ok(!JSON.stringify(config).includes('postgresql://'));
});
test('development mode keeps the original two ports and hardware settings can be overridden', () => {
  const config = readLauncherConfig({
    ...env,
    DND_RUN_MODE: 'development',
    DND_NODE_HEAP_MB: '2048',
    DND_WORKER_THREADS: '6',
  });
  assert.equal(config.apiPort, 3001);
  assert.equal(config.webPort, 5242);
  assert.equal(config.nodeHeapMb, 2048);
  assert.equal(config.workerThreads, 6);
  assert.throws(() => readLauncherConfig({ ...env, DND_NODE_HEAP_MB: 'NaN' }));
  assert.throws(() => readLauncherConfig({ ...env, DND_WORKER_THREADS: '0' }));
  assert.throws(() => readLauncherConfig({ ...env, DND_RUN_MODE: 'invalid' }));
});
test('keeps explicit legacy ports and separates HTTPS origin from backend port', () => {
  assert.equal(readLauncherConfig({ ...env, WEB_ORIGIN: 'http://localhost:5173' }).webPort, 5173);
  const config = readLauncherConfig({ ...env, WEB_ORIGIN: 'https://trpg.example.com', WEB_PORT: '5242' });
  assert.equal(config.webPort, 5242);
  assert.equal(config.webOrigin, 'https://trpg.example.com');
});
test('rejects invalid ports, API collisions and non-origin URLs', () => {
  for (const WEB_PORT of ['0', '65536', 'NaN', '3001', '12.5'])
    assert.throws(() => readLauncherConfig({ ...env, WEB_PORT }));
  for (const WEB_ORIGIN of [
    'file:///tmp',
    'http://example.com/login',
    'http://u:p@example.com',
    'http://example.com/?x=1',
  ])
    assert.throws(() => readLauncherConfig({ ...env, WEB_ORIGIN }));
});
function databaseFixture(t, hasSqlite = true) {
  const root = fixture(t);
  const state = join(root, 'prisma-dev-nodejs', 'Data');
  mkdirSync(join(state, 'projectdnd', '.pglite'), { recursive: true });
  writeFileSync(join(state, 'projectdnd', '.pglite', 'PG_VERSION'), '17');
  const registration = join(state, 'projectdnd', 'server.json');
  const sqlite = join(state, 'durable-streams', 'projectdnd', 'durable-streams.sqlite');
  if (hasSqlite) {
    mkdirSync(join(state, 'durable-streams', 'projectdnd'), { recursive: true });
    writeFileSync(sqlite, 'preserved-stream-data');
  }
  const old =
    'C:\\OldComputer\\projectDND\\.local-database\\prisma-dev-nodejs\\Data\\durable-streams\\projectdnd\\durable-streams.sqlite';
  const data = {
    name: 'projectdnd',
    pid: 42,
    databasePort: 51214,
    experimental: { queryInsights: { sqlitePath: old }, streams: { sqlitePath: old } },
    exports: { DATABASE_URL: 'preserve-connection' },
  };
  const original = JSON.stringify(data, null, 2);
  writeFileSync(registration, original);
  return { root, registration, sqlite, data, original };
}
test('moving a project changes only stream paths, backs up metadata, and is repeatable', (t) => {
  const f = databaseFixture(t);
  assert.deepEqual(relocateDatabasePaths(f.root, 'projectdnd'), { changed: 2, backupCreated: true });
  assert.equal(readFileSync(f.sqlite, 'utf8'), 'preserved-stream-data');
  assert.equal(readFileSync(f.registration + '.before-relocation', 'utf8'), f.original);
  const relocated = JSON.parse(readFileSync(f.registration, 'utf8'));
  assert.equal(relocated.experimental.streams.sqlitePath, f.sqlite);
  assert.equal(relocated.experimental.queryInsights.sqlitePath, f.sqlite);
  assert.deepEqual({ ...relocated, experimental: f.data.experimental }, f.data);
  assert.equal(relocateDatabasePaths(f.root, 'projectdnd').changed, 0);
});
test('an incomplete database copy is rejected without overwriting original registration', (t) => {
  const f = databaseFixture(t, false);
  assert.throws(() => relocateDatabasePaths(f.root, 'projectdnd'), /不完整/);
  assert.equal(readFileSync(f.registration, 'utf8'), f.original);
  assert.equal(existsSync(f.registration + '.before-relocation'), false);
});
test('relocates the separate durable-stream registration without changing metadata', (t) => {
  const f = databaseFixture(t);
  const registration = join(f.root, 'prisma-dev-nodejs', 'Data', 'durable-streams', 'projectdnd', 'server.json');
  const original = JSON.stringify({
    name: 'projectdnd',
    pid: 77,
    sqlite: { path: f.data.experimental.streams.sqlitePath },
    http: { port: 51213 },
  });
  writeFileSync(registration, original);
  assert.equal(relocateDatabasePaths(f.root, 'projectdnd').changed, 3);
  assert.deepEqual(JSON.parse(readFileSync(registration, 'utf8')), {
    name: 'projectdnd',
    pid: 77,
    sqlite: { path: f.sqlite },
    http: { port: 51213 },
  });
  assert.equal(readFileSync(registration + '.before-relocation', 'utf8'), original);
  assert.equal(relocateDatabasePaths(f.root, 'projectdnd').changed, 0);
});
test('missing PGlite contents are rejected without creating an empty database', (t) => {
  const f = databaseFixture(t);
  rmSync(join(f.root, 'prisma-dev-nodejs', 'Data', 'projectdnd', '.pglite', 'PG_VERSION'));
  assert.throws(() => relocateDatabasePaths(f.root, 'projectdnd'), /未创建空数据库/);
  assert.equal(readFileSync(f.registration, 'utf8'), f.original);
});
test('custom data locations are left untouched and invalid names are rejected', (t) => {
  const f = databaseFixture(t);
  f.data.experimental.streams.sqlitePath = 'D:\\custom\\events.sqlite';
  writeFileSync(f.registration, JSON.stringify(f.data));
  assert.throws(() => relocateDatabasePaths(f.root, 'projectdnd'), /自定义/);
  assert.equal(
    JSON.parse(readFileSync(f.registration, 'utf8')).experimental.queryInsights.sqlitePath,
    f.data.experimental.queryInsights.sqlitePath,
  );
  assert.throws(() => relocateDatabasePaths(f.root, '../other'), /名称/);
});
