import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const databaseVersions = { dev: '0.25.2', pglite: '0.4.3' };
export async function inspectDatabaseRuntime(folder) {
  try {
    for (const [name, version] of [
      ['@prisma/dev', databaseVersions.dev],
      ['@electric-sql/pglite', databaseVersions.pglite],
    ]) {
      const pkg = JSON.parse(readFileSync(join(folder, 'node_modules', name, 'package.json'), 'utf8'));
      if (pkg.version !== version) return { ready: false, reason: `${name} 版本不匹配` };
    }
    // PGlite also loads these directly; Prisma's bundled-asset manifest does not cover them.
    for (const name of ['pglite.wasm', 'initdb.wasm', 'pglite.data']) {
      const file = join(folder, 'node_modules/@electric-sql/pglite/dist', name);
      if (!existsSync(file) || !statSync(file).isFile() || statSync(file).size === 0)
        return { ready: false, reason: `数据库核心文件缺失：${name}` };
    }
    const modulePath = join(folder, 'node_modules/@prisma/dev/dist/index.js');
    const runtime = await import(pathToFileURL(modulePath).href);
    const assets = runtime.getPrismaDevRuntimeAssetManifest();
    if (!assets.some((asset) => asset.fileName === 'pglite.wasm'))
      return { ready: false, reason: '数据库核心文件清单不完整' };
    for (const asset of assets)
      if (!statSync(asset.sourcePath).isFile() || statSync(asset.sourcePath).size === 0)
        return { ready: false, reason: `数据库核心文件缺失：${asset.fileName}` };
    return { ready: true, modulePath, assets: assets.length };
  } catch (error) {
    return { ready: false, reason: `数据库运行环境不完整（${error.code || '加载失败'}）` };
  }
}

export async function prepareDatabaseRuntime(root, cacheRoot = join(tmpdir(), '@prisma')) {
  const folder = join(root, '.launcher/runtime/database');
  const current = await inspectDatabaseRuntime(folder);
  if (current.ready) return { ...current, folder, reused: true };
  const candidates = existsSync(cacheRoot)
    ? readdirSync(cacheRoot)
        .filter((name) => /^cli-dev@latest-\d+$/.test(name))
        .sort()
        .reverse()
    : [];
  for (const name of candidates) {
    const source = join(cacheRoot, name);
    if (!(await inspectDatabaseRuntime(source)).ready) continue;
    mkdirSync(dirname(folder), { recursive: true });
    const staging = `${folder}.preparing-${process.pid}`;
    cpSync(join(source, 'node_modules'), join(staging, 'node_modules'), { recursive: true });
    const copied = await inspectDatabaseRuntime(staging);
    if (!copied.ready) throw new Error('复制数据库运行环境后完整性检查失败，未启动数据库。');
    // Keep any incomplete runtime for diagnosis; never touch the game's data directory.
    if (existsSync(folder)) renameSync(folder, `${folder}.incomplete-${Date.now()}`);
    renameSync(staging, folder);
    return { ...(await inspectDatabaseRuntime(folder)), folder, recovered: true };
  }
  if (existsSync(folder)) renameSync(folder, `${folder}.incomplete-${Date.now()}`);
  return { ready: false, needsInstall: true, folder, reason: current.reason };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const folder = join(root, '.launcher/runtime/database');
    console.log(
      JSON.stringify(
        process.argv.includes('--check')
          ? { ...(await inspectDatabaseRuntime(folder)), folder }
          : await prepareDatabaseRuntime(root),
      ),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
