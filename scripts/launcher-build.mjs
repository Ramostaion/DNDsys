import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('../', import.meta.url)));
const inputs = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'apps/api/package.json',
  'apps/api/tsconfig.json',
  'apps/api/prisma/schema.prisma',
  'apps/web/package.json',
  'apps/web/tsconfig.json',
  'apps/web/vite.config.ts',
  'apps/web/index.html',
  'packages/shared/package.json',
  'packages/shared/tsconfig.json',
  'scripts/prepare-web-assets.mjs',
  'apps/api/src',
  'apps/web/src',
  'apps/web/public',
  'packages/shared/src',
];
const outputs = ['apps/api/dist', 'apps/web/dist', 'packages/shared/dist'];
function files(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path)
    .sort()
    .flatMap((name) => files(join(path, name)));
}
function fingerprint(root) {
  const hash = createHash('sha256').update(JSON.stringify({ root, node: process.version, arch: process.arch }));
  for (const input of inputs)
    for (const file of files(join(root, input))) {
      hash.update(relative(root, file));
      hash.update(readFileSync(file));
    }
  return hash.digest('hex');
}
export function inspectBuild(root = projectRoot) {
  try {
    const saved = JSON.parse(readFileSync(join(root, '.launcher/production-build.json'), 'utf8'));
    if (saved.fingerprint !== fingerprint(root)) return { ready: false, reason: '源码或运行环境已更新' };
    for (const output of saved.outputs) {
      const current = statSync(join(root, output.path));
      if (current.size !== output.size || current.mtimeMs !== output.mtimeMs)
        return { ready: false, reason: '构建文件已改变' };
    }
    return { ready: true };
  } catch {
    return { ready: false, reason: '尚无完整的正式构建' };
  }
}
export function recordBuild(root = projectRoot) {
  for (const file of ['apps/api/dist/index.js', 'apps/web/dist/index.html', 'packages/shared/dist/index.js']) {
    if (!existsSync(join(root, file))) throw new Error(`构建不完整：${file}`);
  }
  const manifest = outputs
    .flatMap((folder) => files(join(root, folder)))
    .map((file) => {
      const stat = statSync(file);
      return { path: relative(root, file), size: stat.size, mtimeMs: stat.mtimeMs };
    });
  const stamp = join(root, '.launcher/production-build.json');
  mkdirSync(dirname(stamp), { recursive: true });
  writeFileSync(stamp, JSON.stringify({ fingerprint: fingerprint(root), outputs: manifest }, null, 2));
  return { ready: true };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(process.argv.includes('--record') ? recordBuild() : inspectBuild()));
}
