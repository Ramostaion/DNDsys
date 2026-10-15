import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Update known paths in both registrations, never database contents.
export function relocateDatabasePaths(projectAppData, name) {
  if (!/^[\w-]+$/.test(name)) throw new Error('数据库名称无效。');
  const state = join(resolve(projectAppData), 'prisma-dev-nodejs', 'Data');
  const registration = join(state, name, 'server.json');
  const server = JSON.parse(readFileSync(registration, 'utf8').replace(/^\uFEFF/, ''));
  if (server.name !== name) throw new Error('数据库登记名称不一致，未修改。');
  if (!existsSync(join(state, name, '.pglite', 'PG_VERSION')))
    throw new Error('复制的数据库不完整，请复制整个 .local-database 文件夹；未创建空数据库。');
  const sqlite = join(state, 'durable-streams', name, 'durable-streams.sqlite');
  const registrations = [{ file: registration, data: server, changed: false }];
  const streamRegistration = join(state, 'durable-streams', name, 'server.json');
  if (existsSync(streamRegistration))
    registrations.push({
      file: streamRegistration,
      data: JSON.parse(readFileSync(streamRegistration, 'utf8').replace(/^\uFEFF/, '')),
      changed: false,
    });
  let changed = 0;
  const paths = [
    ['sqlitePath', server.experimental?.queryInsights, registrations[0]],
    ['sqlitePath', server.experimental?.streams, registrations[0]],
    ['path', registrations[1]?.data.sqlite, registrations[1]],
  ];
  for (const [field, settings, owner] of paths) {
    if (!settings?.[field] || resolve(settings[field]) === sqlite) continue;
    const previous = settings[field].replaceAll('\\', '/');
    if (!previous.endsWith(`/durable-streams/${name}/durable-streams.sqlite`))
      throw new Error('发现自定义数据库日志路径，未自动修改，请检查登记文件。');
    if (!existsSync(sqlite)) throw new Error('复制的数据库日志文件不完整，请复制整个 .local-database 文件夹。');
    settings[field] = sqlite;
    owner.changed = true;
    changed++;
  }
  for (const entry of registrations.filter((item) => item.changed)) {
    const backup = entry.file + '.before-relocation';
    if (!existsSync(backup)) copyFileSync(entry.file, backup);
    writeFileSync(entry.file, JSON.stringify(entry.data, null, 2) + '\n');
  }
  return { changed, backupCreated: changed > 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  try {
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    console.log(JSON.stringify(relocateDatabasePaths(join(projectRoot, '.local-database'), process.argv[2])));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
