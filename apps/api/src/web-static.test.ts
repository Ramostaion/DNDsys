import { it, expect } from 'vitest';
import express from 'express';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { registerWebRoutes } from './web-static.js';

it('正式静态资源支持 Brotli/gzip 协商和长期缓存，HTML 更新及 API 不被 SPA 兜底遮蔽', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dnd-static-'));
  const script = 'export const value = 42;';
  await mkdir(join(root, 'assets'));
  await Promise.all([
    writeFile(join(root, 'index.html'), '<h1>Production page</h1>'),
    writeFile(join(root, 'assets/app-hash.js'), script),
    writeFile(join(root, 'assets/app-hash.js.br'), brotliCompressSync(script)),
    writeFile(join(root, 'assets/app-hash.js.gz'), gzipSync(script)),
  ]);
  const app = express();
  app.get('/api/sample', (_req, res) => res.json({ ok: true }));
  registerWebRoutes(app, root);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const encoding of ['br', 'gzip', 'identity', 'gzip;q=0,br;q=0,identity;q=1']) {
      const response = await fetch(url + '/assets/app-hash.js', { headers: { 'Accept-Encoding': encoding } });
      expect(await response.text()).toBe(script);
      expect(response.headers.get('Content-Encoding')).toBe(['br', 'gzip'].includes(encoding) ? encoding : null);
      expect(response.headers.get('Cache-Control')).toContain('immutable');
    }
    for (const page of ['/', '/login', '/rooms/fixture', '/index.html']) {
      const response = await fetch(url + page);
      expect(await response.text()).toContain('Production page');
      expect(response.headers.get('Cache-Control')).toBe('no-cache');
    }
    expect(await (await fetch(url + '/api/sample')).json()).toEqual({ ok: true });
    for (const path of ['/api/missing', '/uploads/private.png', '/assets/missing.js']) {
      const response = await fetch(url + path);
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('Production page');
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
