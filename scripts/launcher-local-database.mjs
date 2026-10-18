import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { readLauncherConfig } from './launcher-config.mjs';
import { inspectDatabaseRuntime } from './launcher-database-runtime.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const config = readLauncherConfig(parseEnv(readFileSync(join(root, 'apps/api/.env'), 'utf8')));
  const server = config.localServer;
  if (
    !server ||
    !config.localDatabaseAppData ||
    !existsSync(join(config.databaseStateDir, server.name, '.pglite/PG_VERSION'))
  )
    throw new Error('已有本地数据库文件不完整，未创建替代数据库。');
  process.env.LOCALAPPDATA = config.localDatabaseAppData;
  const runtime = await inspectDatabaseRuntime(join(root, '.launcher/runtime/database'));
  if (!runtime.ready) throw new Error(runtime.reason);
  const { startPrismaDevServer } = await import(pathToFileURL(runtime.modulePath).href);
  const database = await startPrismaDevServer({
    name: server.name,
    persistenceMode: 'stateful',
    port: server.port,
    databasePort: server.databasePort,
    shadowDatabasePort: server.shadowDatabasePort,
  });
  console.log(`本地数据库 ${server.name} 已就绪（${server.databasePort}）。`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await database.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
} catch (error) {
  // Do not print connection strings, credentials, or raw Prisma server objects.
  console.error(`本地数据库启动失败：${error.code ? `${error.code} ` : ''}${error.message}`);
  process.exitCode = 1;
}
