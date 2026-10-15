import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function findLauncherDatabase(db, projectAppData, windowsAppData) {
  // Once relocated, use that database exclusively. Falling back could load stale data.
  if (existsSync(join(projectAppData, 'prisma-dev-nodejs', 'Data'))) return findLocalDatabase(db, projectAppData);
  return findLocalDatabase(db, undefined, windowsAppData);
}

export function findLocalDatabase(db, localAppData, homeAppData = join(homedir(), 'AppData', 'Local')) {
  const candidates = [
    ...new Set(localAppData === undefined ? [process.env.LOCALAPPDATA || homeAppData, homeAppData] : [localAppData]),
  ];
  let firstResult;
  for (const candidate of candidates) {
    const result = inspectLocalDatabase(db, candidate);
    if (result.localServer) return { ...result, localDatabaseAppData: candidate };
    firstResult ??= result;
  }
  return firstResult;
}

function inspectLocalDatabase(db, localAppData) {
  if (!['localhost', '127.0.0.1', '::1'].includes(db.host))
    return { localServer: null, databaseStateDir: null, localDatabaseIssue: null };
  // Read existing registrations only; do not create a replacement database.
  const state = join(localAppData, 'prisma-dev-nodejs', 'Data');
  const result = { localServer: null, databaseStateDir: state, localDatabaseIssue: null };
  const issues = [];
  let entries;
  try {
    entries = readdirSync(state, { withFileTypes: true });
  } catch (error) {
    return {
      ...result,
      localDatabaseIssue:
        error.code === 'ENOENT'
          ? '本地数据库登记目录不存在。'
          : `无法读取本地数据库登记目录（${error.code || '未知错误'}）。`,
      localDatabaseIssueCode: error.code || 'UNKNOWN',
    };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const registration = join(state, entry.name, 'server.json');
    if (!existsSync(registration)) continue;
    try {
      const server = JSON.parse(readFileSync(registration, 'utf8').replace(/^\uFEFF/, ''));
      if (
        !/^[\w-]+$/.test(server.name) ||
        entry.name !== server.name ||
        ![server.port, server.databasePort, server.shadowDatabasePort].every(
          (p) => Number.isInteger(p) && p > 0 && p < 65536,
        )
      ) {
        issues.push(`${entry.name} 的数据库登记信息不完整。`);
        continue;
      }
      if (server.databasePort !== db.port) {
        issues.push(`${server.name} 登记端口为 ${server.databasePort}，配置端口为 ${db.port}。`);
        continue;
      }
      result.localServer = {
        name: server.name,
        port: server.port,
        databasePort: server.databasePort,
        shadowDatabasePort: server.shadowDatabasePort,
      };
      return result;
    } catch {
      issues.push(`${entry.name} 的 server.json 无法读取或解析。`);
    }
  }
  return { ...result, localDatabaseIssue: issues.join(' ') || '没有找到已登记的本地数据库。' };
}

export function readLauncherConfig(env, projectRoot = root, windowsAppData) {
  const mode = env.DND_RUN_MODE || 'production';
  if (!['production', 'development'].includes(mode)) throw new Error('DND_RUN_MODE 只能为 production 或 development。');
  const url = new URL(env.DATABASE_URL);
  const port = Number(env.PORT || 3001),
    origin = new URL(env.WEB_ORIGIN || 'http://localhost:5242');
  if (port !== 3001)
    throw new Error('开发模式后台端口使用 3001，请将 apps/api/.env 中的 PORT 设为 3001。正式运行使用 WEB_PORT。');
  if (
    !['http:', 'https:'].includes(origin.protocol) ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  )
    throw new Error('WEB_ORIGIN 必须是完整的 HTTP 或 HTTPS 访问源，不含路径。');
  const webPort = Number(env.WEB_PORT || origin.port || 5242);
  if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535 || webPort === port)
    throw new Error('WEB_PORT 必须是 1–65535 的整数，且不能与后台端口相同。');
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error('本地启动需要直接 PostgreSQL DATABASE_URL，请按启动说明设置本地数据库连接。');
  const db = { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || 5432) };
  return {
    mode,
    apiPort: mode === 'production' ? webPort : port,
    webPort,
    webOrigin: origin.origin,
    db,
    nodeHeapMb: integerSetting(env.DND_NODE_HEAP_MB, 4096, 512, 16384, 'DND_NODE_HEAP_MB'),
    workerThreads: integerSetting(env.DND_WORKER_THREADS, 8, 1, 32, 'DND_WORKER_THREADS'),
    ...findLauncherDatabase(db, join(projectRoot, '.local-database'), windowsAppData),
  };
}

function integerSetting(value, fallback, min, max, name) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error(`${name} 必须为 ${min}–${max} 的整数。`);
  return number;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  try {
    const env = parseEnv(readFileSync(join(root, 'apps/api/.env'), 'utf8'));
    if (process.argv.includes('--development')) env.DND_RUN_MODE = 'development';
    // Return paths and port metadata only, never connection credentials.
    const folderArg = process.argv.indexOf('--local-app-data');
    const windowsAppData = folderArg === -1 ? undefined : process.argv[folderArg + 1];
    if (folderArg !== -1 && !windowsAppData) throw new Error('缺少 Windows 本地用户目录参数。');
    console.log(JSON.stringify(readLauncherConfig(env, root, windowsAppData)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
