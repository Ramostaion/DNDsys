import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { resolve, sep, dirname } from 'node:path';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

config({ path: 'apps/api/.env' });

test('Windows Server 正式单端口网页、压缩资源与联机，重启后账号人物特性和图片保留', async ({ browser }) => {
  test.setTimeout(90_000);
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  const origin = `http://127.0.0.1:${port}`,
    db = new PrismaClient(),
    context = await browser.newContext();
  const prefix = `e2e-server-${randomUUID().slice(0, 8)}`;
  let child: ChildProcess | undefined, room: any, user: any;
  async function start() {
    child = spawn(process.execPath, ['dist/index.js'], {
      cwd: resolve('apps/api'),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        JWT_SECRET: 'windows-runtime-test-secret-32-characters',
        WEB_ORIGIN: origin,
        PORT: String(port),
        HOST: '127.0.0.1',
        WEB_STATIC_DIR: resolve('apps/web/dist'),
        UV_THREADPOOL_SIZE: '8',
        NODE_OPTIONS: '--max-old-space-size=4096',
      },
      windowsHide: true,
      stdio: 'ignore',
    });
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(origin + '/api/health')).ok;
          } catch {
            return false;
          }
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      child!.once('exit', () => resolve());
      child!.kill();
    });
  }
  async function post(path: string, data: unknown) {
    const response = await context.request.post(origin + '/api' + path, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  try {
    await start();
    const login = await context.request.get(origin + '/login');
    expect(login.status()).toBe(200);
    expect(login.headers()['cache-control']).toBe('no-cache');
    const html = await login.text(),
      script = html.match(/src="([^"]+\.js)"/)![1];
    const asset = await context.request.get(origin + script, { headers: { 'Accept-Encoding': 'br' } });
    expect(asset.headers()['content-encoding']).toBe('br');
    expect(asset.headers()['cache-control']).toContain('immutable');
    const page = await context.newPage();
    await page.goto(origin + '/login');
    await expect(page.getByRole('button', { name: '进入冒险' })).toBeVisible();
    const registration = await context.request.post(origin + '/api/auth/register', {
      data: { username: prefix, password: randomUUID() },
    });
    expect(registration.ok(), await registration.text()).toBe(true);
    expect(registration.headers()['set-cookie']).not.toMatch(/;\s*Secure(?:;|$)/i);
    user = await registration.json();
    room = await post('/rooms', { name: prefix });
    await page.goto(`${origin}/rooms/${room.id}`);
    await expect(page.locator('.game-rail')).toBeVisible();
    await expect(page.locator('.party-panel [title="已连接"]')).toBeVisible();
    const character = await post(`/rooms/${room.id}/operations`, {
      id: randomUUID(),
      type: 'character.create',
      payload: { name: '重启保留的角色' },
    });
    const template = await post(`/rooms/${room.id}/operations`, {
      id: randomUUID(),
      type: 'template.create',
      payload: { kind: 'TRAIT', name: '重启保留的特性', description: '仍然属于原角色' },
    });
    await post(`/rooms/${room.id}/operations`, {
      id: randomUUID(),
      type: 'template.apply',
      payload: { characterId: character.id, templateId: template.id, shared: true },
    });
    const image = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#895532' } })
      .png()
      .toBuffer();
    const uploaded = await context.request.post(`${origin}/api/rooms/${room.id}/upload`, {
      multipart: { file: { name: '持久图片.png', mimeType: 'image/png', buffer: image } },
    });
    expect(uploaded.status(), await uploaded.text()).toBe(201);
    const picture = await uploaded.json(),
      before = await context.request.get(origin + picture.url);
    expect(before.ok()).toBe(true);
    const bytes = await before.body();
    await stop();
    await start();
    await page.reload();
    await expect(page.locator('.party-panel [title="已连接"]')).toBeVisible();
    const identity = await context.request.get(origin + '/api/auth/me');
    expect(identity.ok()).toBe(true);
    expect((await identity.json()).id).toBe(user.id);
    const state = await context.request.get(`${origin}/api/rooms/${room.id}/snapshot`);
    expect(state.ok()).toBe(true);
    expect((await state.json()).characters.find((c: any) => c.id === character.id).traits[0].name).toBe(
      '重启保留的特性',
    );
    const after = await context.request.get(origin + picture.url);
    expect(after.ok()).toBe(true);
    expect(await after.body()).toEqual(bytes);
    const foreign = await context.request.post(origin + '/api/rooms', {
      headers: { Origin: 'http://another-table.invalid' },
      data: { name: '不应创建' },
    });
    expect(foreign.status()).toBe(403);
  } finally {
    await stop();
    await context.close();
    if (room) {
      await db.room.deleteMany({ where: { id: room.id, name: prefix } });
      const root = resolve('apps/api', process.env.UPLOAD_DIR || 'uploads'),
        target = resolve(root, room.id);
      if (target.startsWith(root + sep) && dirname(target) === root) await rm(target, { recursive: true, force: true });
    }
    if (user) await db.user.deleteMany({ where: { id: user.id, username: prefix } });
    await db.$disconnect();
  }
});
