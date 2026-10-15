import { readFileSync, writeFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stamp = join(root, '.launcher', 'dependencies.json');
const fingerprint = createHash('sha256').update(
  JSON.stringify({ root, node: process.version, platform: process.platform, arch: process.arch }),
);
for (const file of [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/shared/package.json',
])
  if (file.endsWith('package.json')) {
    const { dependencies, devDependencies, packageManager } = JSON.parse(readFileSync(join(root, file), 'utf8'));
    fingerprint.update(JSON.stringify({ dependencies, devDependencies, packageManager }));
  } else fingerprint.update(readFileSync(join(root, file)));
const expected = fingerprint.digest('hex');
let issue = null;
try {
  if (
    !process.argv.includes('--record') &&
    existsSync(stamp) &&
    JSON.parse(readFileSync(stamp, 'utf8')).version === 2 &&
    JSON.parse(readFileSync(stamp, 'utf8')).fingerprint !== expected
  )
    issue = '项目目录、依赖配置或运行环境已改变';
  for (const folder of ['.', 'apps/api', 'apps/web', 'packages/shared']) {
    const manifest = JSON.parse(readFileSync(join(root, folder, 'package.json'), 'utf8'));
    for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
      const location = realpathSync(join(root, folder, 'node_modules', name, 'package.json')).toLowerCase();
      if (!location.startsWith((root + sep).toLowerCase())) throw new Error('依赖仍指向原电脑目录');
    }
  }
  for (const [folder, modules] of [
    ['apps/api', ['prisma/package.json', '@prisma/client', 'tsx', 'express', 'dotenv', 'sharp']],
    ['apps/web', ['vite', 'typescript']],
    ['packages/shared', ['typescript']],
  ]) {
    const require = createRequire(join(root, folder, 'package.json'));
    for (const name of modules) {
      const location = require.resolve(name).toLowerCase();
      if (!location.startsWith((root + sep).toLowerCase())) throw new Error('依赖仍指向原电脑目录');
    }
    if (folder === 'apps/api') require('sharp');
  }
} catch {
  issue = '依赖缺失、复制链接失效或本机模块不可用';
}
if (process.argv.includes('--record') || !issue) {
  if (issue && process.argv.includes('--record')) throw new Error('依赖安装后仍不可用，请查看安装日志。');
  mkdirSync(dirname(stamp), { recursive: true });
  writeFileSync(
    stamp,
    JSON.stringify({ version: 2, fingerprint: expected, root, node: process.version, arch: process.arch }, null, 2) +
      '\n',
  );
}
console.log(JSON.stringify({ ready: issue === null, reason: issue }));
