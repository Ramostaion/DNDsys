import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import { createApplication } from '../src/app';
import { readConfig } from '../src/config';
import { uploadDir } from '../src/storage';
import { api, apiBase } from './server-address';
config({ path: 'apps/api/.env' });

const runtimeDb = new PrismaClient();
let runtime: ReturnType<typeof createApplication> | undefined;
let queries = 0,
  lastQuery = Date.now();
const tracked = runtimeDb.$extends({
  query: {
    async $allOperations({ args, query }) {
      queries++;
      try {
        return await query(args);
      } finally {
        queries--;
        lastQuery = Date.now();
      }
    },
  },
});
async function start() {
  const address = new URL(apiBase);
  if (!['localhost', '127.0.0.1'].includes(address.hostname) || !address.port || address.port === '5242')
    throw new Error('音频测试使用独立本机端口');
  runtime = createApplication(tracked as unknown as PrismaClient, {
    ...readConfig(),
    origin: address.origin,
    secureCookie: false,
    webDir: resolve('apps/web/dist'),
  });
  await new Promise<void>((done, reject) => {
    runtime!.server.once('error', reject);
    runtime!.server.listen(Number(address.port), address.hostname, done);
  });
}
async function stop() {
  if (!runtime) return;
  runtime.beginShutdown();
  await new Promise<void>((done) => runtime!.io.close(() => done()));
  await expect.poll(() => queries === 0 && Date.now() - lastQuery > 200).toBe(true);
  runtime = undefined;
}
test.beforeAll(start);
test.afterAll(async () => {
  await stop();
  await runtimeDb.$disconnect();
});

function wave(seconds = 30) {
  const rate = 8000,
    size = rate * seconds * 2,
    bytes = Buffer.alloc(44 + size);
  bytes.write('RIFF');
  bytes.writeUInt32LE(36 + size, 4);
  bytes.write('WAVE', 8);
  bytes.write('fmt ', 12);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write('data', 36);
  bytes.writeUInt32LE(size, 40);
  for (let n = 0; n < rate * seconds; n++)
    bytes.writeInt16LE(Math.round(Math.sin((n * Math.PI * 2 * 220) / rate) * 800), 44 + n * 2);
  return bytes;
}
async function setup(browser: Browser) {
  const contexts = await Promise.all(
    [0, 1, 2, 3].map(() => browser.newContext({ viewport: { width: 1600, height: 1050 } })),
  );
  const db = new PrismaClient(),
    users: { id: string }[] = [],
    rooms: string[] = [],
    prefix = `director-${randomUUID().slice(0, 8)}`;
  const post = async (c: BrowserContext, path: string, body: unknown) => {
    const r = await c.request.post(api + path, { data: body });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  async function cleanup() {
    await Promise.all(contexts.map((c) => c.close()));
    for (const id of rooms) {
      await db.room.deleteMany({ where: { id, name: { startsWith: prefix } } });
      const folder = resolve(uploadDir, id);
      if (dirname(folder) !== resolve(uploadDir)) throw new Error('测试文件目录不正确');
      await rm(folder, { recursive: true, force: true });
    }
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  }
  try {
    for (const [i, c] of contexts.entries())
      users.push(await post(c, '/auth/register', { username: `${prefix}-${i}`, password: randomUUID() }));
    const room = await post(contexts[0], '/rooms', { name: prefix });
    rooms.push(room.id);
    for (const c of contexts.slice(1, 3)) await post(c, '/rooms/join', { inviteCode: room.inviteCode });
    const base = `/rooms/${room.id}/presentation/audio`;
    const state = async (c = contexts[0]) => {
      const r = await c.request.get(api + base + '/current');
      expect(r.ok(), await r.text()).toBe(true);
      return r.json();
    };
    const command = async (type: string, extra: Record<string, unknown> = {}, c = contexts[0]) =>
      post(c, base + '/commands', { id: randomUUID(), version: (await state(c)).revision, type, ...extra });
    const upload = async (name: string, bytes = wave()) => {
      const r = await contexts[0].request.post(api + base + '/tracks', {
        multipart: { duration: '30', file: { name, mimeType: 'audio/wav', buffer: bytes } },
      });
      expect(r.status(), await r.text()).toBe(201);
      return r.json();
    };
    return { db, contexts, users, room, rooms, base, state, command, upload, post, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

type Fixture = Awaited<ReturnType<typeof setup>>;
const media = (page: Page) => page.getByTestId('room-background-audio');
async function image(f: Fixture, title: string, color = '#303833') {
  const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: color } })
    .png()
    .toBuffer();
  const response = await f.contexts[0].request.post(`${api}/rooms/${f.room.id}/presentation/assets`, {
    multipart: { title, file: { name: title + '.png', mimeType: 'image/png', buffer: bytes } },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
async function current(f: Fixture) {
  return (await f.contexts[0].request.get(`${api}/rooms/${f.room.id}/presentation/current`)).json();
}
async function playing(page: Page) {
  await expect
    .poll(
      async () =>
        !(await media(page).evaluate((audio: HTMLAudioElement) => audio.paused)) ||
        (await page.locator('.audio-autoplay-hint').isVisible()),
    )
    .toBe(true);
  if (await page.locator('.audio-autoplay-hint').isVisible()) await page.mouse.click(650, 430);
  await expect
    .poll(() => media(page).evaluate((audio: HTMLAudioElement) => !audio.paused && audio.readyState >= 2))
    .toBe(true);
}

test('GM导演工作流：准备不广播、场景图片配乐一起发布、草稿恢复、顶部常驻与真实音量过渡', async ({ browser }) => {
  test.setTimeout(150000);
  const f = await setup(browser);
  try {
    const a = await image(f, '酒馆'),
      b = await image(f, '森林', '#153523'),
      track = await f.upload('camp.wav');
    const [gm, p1, p2] = await Promise.all(f.contexts.slice(0, 3).map((c) => c.newPage()));
    for (const page of [gm, p1, p2]) {
      await page.goto(`/rooms/${f.room.id}`);
      await expect(page.getByTitle('已连接', { exact: true })).toBeVisible();
      await media(page).evaluate((audio: HTMLAudioElement) => {
        (window as any).gains = [];
        audio.addEventListener('volumechange', () => {
          (window as any).gains.push(audio.volume);
        });
      });
    }
    await gm.locator('.game-rail').getByRole('button', { name: '导演台', exact: true }).click();
    const prep = gm.getByRole('region', { name: '下一场景准备' }),
      live = gm.getByRole('region', { name: '当前播放控制' });
    await gm.locator('.presentation-asset').filter({ hasText: '酒馆' }).click();
    await prep.getByLabel('准备场景配乐方式').selectOption('play');
    await prep.getByLabel('准备场景曲目').selectOption(track.id);
    expect((await current(f)).status).toBe('idle');
    expect((await f.state()).status).toBe('stopped');
    for (const p of [p1, p2]) await expect(p.locator('.presentation-viewer')).toHaveCount(0);
    await prep.getByRole('button', { name: '保存为场景卡片', exact: true }).click();
    await expect(gm.locator('.director-scene-card')).toHaveCount(1);
    const rows = await f.db.presentationCue.findMany({ where: { roomId: f.room.id } });
    expect(rows[0].audioCue).toEqual({ mode: 'play', trackId: track.id, fadeMs: 1000 });
    await gm.getByRole('button', { name: '关闭剧情导演台', exact: true }).click();
    await gm.locator('.game-rail').getByRole('button', { name: '导演台', exact: true }).click();
    await expect(prep.getByLabel('准备场景配乐方式')).toHaveValue('play');
    await expect(prep.getByLabel('准备场景曲目')).toHaveValue(track.id);
    await prep.getByRole('button', { name: '向房间展示', exact: true }).click();
    for (const p of [p1, p2]) {
      await expect(p.locator('.presentation-titlebar')).toContainText('酒馆');
      await playing(p);
    }
    expect((await current(f)).asset.id).toBe(a.id);
    expect((await f.state()).trackId).toBe(track.id);
    await expect.poll(() => media(p1).evaluate((audio: HTMLAudioElement) => audio.volume)).toBeCloseTo(0.35, 2);
    expect(await p1.evaluate(() => (window as any).gains.some((n: number) => n > 0 && n < 0.3))).toBe(true);
    // Library scroll does not displace live image/audio controls.
    await gm.getByText('打开只读观众页', { exact: true }).scrollIntoViewIfNeeded();
    const box = (await live.boundingBox())!,
      windowBox = (await gm.locator('.window').filter({ has: live }).boundingBox())!;
    expect(box.y).toBeGreaterThan(windowBox.y + 30);
    expect(box.y).toBeLessThan(windowBox.y + 85);
    await expect(live.getByRole('button', { name: '黑幕', exact: true })).toBeInViewport();
    // Prepare another image with "continue"; publication must not restart the song.
    const before = (await f.state()).startedAt;
    await gm.locator('.presentation-asset').filter({ hasText: '森林' }).click();
    await prep.getByLabel('准备场景配乐方式').selectOption('continue');
    expect((await current(f)).asset.id).toBe(a.id);
    await prep.getByRole('button', { name: '向房间展示', exact: true }).click();
    await expect(p1.locator('.presentation-titlebar')).toContainText('森林');
    expect((await f.state()).startedAt).toBe(before);
    await live.getByRole('button', { name: '暂停全员', exact: true }).click();
    await expect.poll(() => media(p1).evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
    await live.getByRole('button', { name: '继续播放', exact: true }).click();
    await playing(p1);
    await prep.getByLabel('准备场景配乐方式').selectOption('stop');
    await prep.getByRole('button', { name: '向房间展示', exact: true }).click();
    await expect.poll(() => media(p1).evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
    expect((await f.state()).status).toBe('stopped');
    expect((await current(f)).asset.id).toBe(b.id);
    await gm.locator('.presentation-asset').filter({ hasText: '酒馆' }).click();
    await gm.screenshot({ path: '.launcher/audio/director-workflow.png' });
    await gm.reload();
    await expect(gm.getByTitle('已连接', { exact: true })).toBeVisible();
    await gm.locator('.game-rail').getByRole('button', { name: '导演台', exact: true }).click();
    await expect(prep.getByLabel('准备场景配乐方式')).toHaveValue('stop');
    await expect(prep.getByRole('heading')).toHaveText('酒馆');
  } finally {
    await f.cleanup();
  }
});

test('场景事务：失效配乐/跨房间/版本冲突整次拒绝，双GM竞争、同ID重试及后台重启保持绑定', async ({ browser }) => {
  test.setTimeout(120000);
  const f = await setup(browser);
  try {
    await f.db.roomMember.update({
      where: { roomId_userId: { roomId: f.room.id, userId: f.users[2].id } },
      data: { role: 'GM' },
    });
    const a = await image(f, '场景一'),
      b = await image(f, '场景二'),
      track = await f.upload('first.wav');
    const root = `${api}/rooms/${f.room.id}/presentation`;
    const create = await f.contexts[0].request.post(root + '/cues', {
      data: { assetId: a.id, audioCue: { mode: 'play', trackId: track.id, fadeMs: 1000 } },
    });
    expect(create.status()).toBe(201);
    const cue = await create.json();
    expect(
      (
        await f.contexts[1].request.post(root + '/commands', {
          data: { id: randomUUID(), version: 0, type: 'play', cueId: cue.id },
        })
      ).status(),
    ).toBe(403);
    expect((await f.contexts[1].request.get(root + '/cues')).status()).toBe(403);
    const payload = { id: randomUUID(), version: 0, audioVersion: 0, type: 'play', cueId: cue.id };
    const results = await Promise.all(
      [f.contexts[0], f.contexts[2]].map((c) =>
        c.request.post(root + '/commands', { data: { ...payload, id: randomUUID() } }),
      ),
    );
    expect(results.map((r) => r.status()).sort()).toEqual([200, 409]);
    const beforeImage = await current(f),
      beforeAudio = await f.state();
    const otherRoom = await f.post(f.contexts[0], '/rooms', { name: f.room.name + '-other' });
    f.rooms.push(otherRoom.id);
    const foreign = await f.contexts[0].request.post(`${api}/rooms/${otherRoom.id}/presentation/audio/tracks`, {
      multipart: { duration: '30', file: { name: 'foreign.wav', mimeType: 'audio/wav', buffer: wave() } },
    });
    expect(foreign.status()).toBe(201);
    const foreignTrack = await foreign.json();
    expect(
      (
        await f.contexts[0].request.post(root + '/cues', {
          data: { assetId: a.id, audioCue: { mode: 'play', trackId: foreignTrack.id } },
        })
      ).status(),
    ).toBe(409);
    expect(
      (
        await f.contexts[0].request.post(root + '/commands', {
          data: {
            id: randomUUID(),
            version: beforeImage.revision,
            audioVersion: beforeAudio.revision,
            type: 'play',
            assetId: b.id,
            audio: { mode: 'play', trackId: foreignTrack.id },
          },
        })
      ).status(),
    ).toBe(409);
    const invalid = await f.contexts[0].request.post(root + '/commands', {
      data: {
        id: randomUUID(),
        version: beforeImage.revision,
        audioVersion: beforeAudio.revision,
        type: 'play',
        assetId: b.id,
        audio: { mode: 'play', trackId: 'missing' },
      },
    });
    expect(invalid.status()).toBe(409);
    expect((await current(f)).asset.id).toBe(a.id);
    expect((await f.state()).revision).toBe(beforeAudio.revision);
    const stale = await f.contexts[0].request.post(root + '/commands', {
      data: {
        id: randomUUID(),
        version: beforeImage.revision,
        audioVersion: 0,
        type: 'play',
        assetId: b.id,
        audio: { mode: 'stop' },
      },
    });
    expect(stale.status()).toBe(409);
    expect((await current(f)).revision).toBe(beforeImage.revision);
    const id = randomUUID(),
      same = {
        id,
        version: beforeImage.revision,
        audioVersion: beforeAudio.revision,
        type: 'play',
        assetId: b.id,
        audio: { mode: 'stop', fadeMs: 0 },
      };
    const duplicate = await Promise.all(
      [0, 1].map(() => f.contexts[0].request.post(root + '/commands', { data: same })),
    );
    expect(duplicate.map((r) => r.status())).toEqual([200, 200]);
    expect((await current(f)).revision).toBe(beforeImage.revision + 1);
    expect((await f.state()).revision).toBe(beforeAudio.revision + 1);
    const finalImage = await current(f),
      finalAudio = await f.state();
    await stop();
    await start();
    expect((await current(f)).asset.id).toBe(finalImage.asset.id);
    expect((await f.state()).revision).toBe(finalAudio.revision);
    expect((await (await f.contexts[0].request.get(root + '/cues')).json())[0].audioCue).toEqual(cue.audioCue);
    await f.contexts[0].request.delete(`${api}${f.base}/tracks/${track.id}`);
    const deleted = await f.contexts[0].request.post(root + '/commands', {
      data: { id: randomUUID(), version: finalImage.revision, type: 'play', cueId: cue.id },
    });
    expect(deleted.status()).toBe(409);
    expect((await current(f)).revision).toBe(finalImage.revision);
  } finally {
    await f.cleanup();
  }
});
