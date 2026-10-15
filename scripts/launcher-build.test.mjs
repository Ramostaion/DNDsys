import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { recordBuild, inspectBuild } from './launcher-build.mjs';

test('formal builds are reused, changed source and missing outputs force a rebuild', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dnd-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, text = 'fixture') => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  for (const file of [
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
    'apps/api/src/index.ts',
    'apps/web/src/App.tsx',
    'apps/web/public/icon.svg',
    'packages/shared/src/index.ts',
    'apps/api/dist/index.js',
    'apps/web/dist/index.html',
    'packages/shared/dist/index.js',
  ])
    write(file);
  assert.equal(inspectBuild(root).ready, false);
  recordBuild(root);
  assert.equal(inspectBuild(root).ready, true);
  write('apps/web/src/App.tsx', 'changed source');
  assert.equal(inspectBuild(root).ready, false);
  recordBuild(root);
  assert.equal(inspectBuild(root).ready, true);
  write('apps/web/src/new-feature.ts', 'new source');
  assert.equal(inspectBuild(root).ready, false);
  recordBuild(root);
  rmSync(join(root, 'apps/api/dist/index.js'));
  assert.equal(inspectBuild(root).ready, false);
});
