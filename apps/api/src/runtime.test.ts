import { it, expect, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { PrismaClient } from '@prisma/client';
import { createApplication } from './app.js';
import { startServer } from './bootstrap.js';
import { readConfig } from './config.js';

it('健康状态真实反映数据库故障、恢复和停止，组装应用不读取或修改数据', async () => {
  const query = vi.fn().mockResolvedValue([{ value: 1 }]);
  const runtime = createApplication({ $queryRaw: query } as unknown as PrismaClient, readConfig());
  expect(query).not.toHaveBeenCalled();
  await new Promise<void>((resolve) => runtime.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}`;
  try {
    expect((await fetch(url + '/api/health')).status).toBe(200);
    query.mockRejectedValue(new Error('database offline'));
    expect((await fetch(url + '/api/health')).status).toBe(503);
    expect((await fetch(url + '/api/live')).status).toBe(200);
    query.mockResolvedValue([{ value: 1 }]);
    expect((await fetch(url + '/api/health')).status).toBe(200);
    runtime.beginShutdown();
    expect((await fetch(url + '/api/health')).status).toBe(503);
    expect((await fetch(url + '/api/live')).status).toBe(200);
    expect((await fetch(url + '/api/rooms')).status).toBe(503);
  } finally {
    await new Promise<void>((resolve) => runtime.io.close(() => resolve()));
  }
});

it('启动验证上传目录，停止等待已接收请求完成后再断开数据库，重复停止安全', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dnd-runtime-'));
  const disconnect = vi.fn().mockResolvedValue(undefined);
  const db = {
    $connect: vi.fn().mockResolvedValue(undefined),
    $disconnect: disconnect,
    character: { findMany: vi.fn().mockResolvedValue([]) },
  } as unknown as PrismaClient;
  const runtime = await startServer(db, { ...readConfig(), port: 0, host: '127.0.0.1', uploadDir: directory });
  let began!: () => void;
  const entered = new Promise<void>((resolve) => {
    began = resolve;
  });
  runtime.app.get('/test-drain', (_req, res) => {
    began();
    setTimeout(() => res.json({ saved: true }), 100);
  });
  try {
    expect(await readdir(directory)).toEqual([]);
    const pending = fetch(`http://127.0.0.1:${(runtime.server.address() as AddressInfo).port}/test-drain`);
    await entered;
    const closing = runtime.close();
    expect(disconnect).not.toHaveBeenCalled();
    expect(await (await pending).json()).toEqual({ saved: true });
    await closing;
    await runtime.close();
    expect(disconnect).toHaveBeenCalledTimes(1);
  } finally {
    await runtime.close();
    await rm(directory, { recursive: true, force: true });
  }
});
