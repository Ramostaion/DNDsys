import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { rm, readdir, unlink } from 'node:fs/promises';
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
    prefix = `audio-${randomUUID().slice(0, 8)}`;
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
const media = (page: Page) => page.getByTestId('room-background-audio');
async function belowRounds(page: Page) {
  await expect
    .poll(async () => {
      const counter = await page.getByLabel('回合计数器', { exact: true }).boundingBox();
      const audioBox = await page.getByRole('region', { name: '剧情背景音', exact: true }).boundingBox();
      const partyBox = await page.locator('.party-panel').boundingBox();
      if (!counter || !audioBox || !partyBox) return false;
      const gap = audioBox.y - (counter.y + counter.height);
      return (
        gap >= 8 && gap <= 12 && Math.abs(audioBox.x - counter.x) < 1 && audioBox.y >= partyBox.y + partyBox.height
      );
    })
    .toBe(true);
}
async function playing(page: Page) {
  await expect
    .poll(
      async () =>
        (await media(page).evaluate((a: HTMLAudioElement) => !a.paused)) ||
        (await page.locator('.audio-autoplay-hint').isVisible()),
    )
    .toBe(true);
  if (await page.locator('.audio-autoplay-hint').isVisible()) await page.mouse.click(100, 70);
  await expect.poll(() => media(page).evaluate((a: HTMLAudioElement) => !a.paused && a.readyState >= 2)).toBe(true);
}

test('导演台背景音：默认自动播放、浏览器拦截后页面交互接入、暂停进度、静音及图片并行', async ({ browser }, info) => {
  test.setTimeout(150000);
  const f = await setup(browser);
  try {
    const [gm, a, b] = await Promise.all(f.contexts.slice(0, 3).map((c) => c.newPage()));
    await b.addInitScript(() => {
      (window as any).allowTestAudio = false;
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function () {
        if ((this as HTMLElement).dataset.testid === 'room-background-audio' && !(window as any).allowTestAudio)
          return Promise.reject(new DOMException('Autoplay test', 'NotAllowedError'));
        return original.call(this);
      };
    });
    await f.post(f.contexts[0], `/rooms/${f.room.id}/members/${f.users[1].id}/permissions`, { characterBasics: true });
    const op = (type: string, payload: Record<string, unknown>) =>
      f.post(f.contexts[0], `/rooms/${f.room.id}/operations`, { id: randomUUID(), type, payload });
    const version = async () => (await f.db.room.findUniqueOrThrow({ where: { id: f.room.id } })).version;
    await op('sheet.field.upsert', {
      version: await version(),
      field: { fieldId: 'dex', name: '敏捷', type: 'number', defaultValue: 10 },
    });
    const character = await f.post(f.contexts[0], `/rooms/${f.room.id}/operations`, {
      id: randomUUID(),
      type: 'character.create',
      payload: { name: '音乐测试角色', ownerId: f.users[1].id },
    });
    const map = await op('map.create', { name: '背景音测试地图' });
    await op('map.activate', { id: map.id });
    const token = await op('token.create', { mapId: map.id, characterId: character.id, x: 300, y: 300 });
    const preset = await op('initiative.preset.save', {
      name: '背景音测试',
      weights: [{ fieldId: 'dex', weight: 100, min: 0, max: 20, missing: 'BLOCK' }],
    });
    await op('initiative.preset.select', { id: preset.id, version: await version() });
    await op('turn.start', { mapId: map.id, tokenIds: [token.id], totalRounds: 5 });
    for (const page of [gm, a, b]) {
      await page.goto(`/rooms/${f.room.id}`);
      await expect(page.getByTitle('已连接', { exact: true })).toBeVisible();
      const audioControl = page.getByRole('region', { name: '剧情背景音', exact: true });
      await expect(audioControl).toHaveAttribute('data-status', 'stopped');
      await expect(audioControl.getByRole('slider', { name: '我的背景音音量' })).toBeVisible();
      await expect(page.getByRole('button', { name: '开启背景音', exact: true })).toHaveCount(0);
      // Both cards animate into view; measure their settled placement.
      await expect
        .poll(async () => {
          const counter = await page.getByLabel('回合计数器', { exact: true }).boundingBox();
          const audioBox = await audioControl.boundingBox();
          if (!counter || !audioBox) return false;
          const gap = audioBox.y - (counter.y + counter.height);
          return gap >= 8 && gap <= 12 && Math.abs(audioBox.x - counter.x) < 1;
        })
        .toBe(true);
    }
    await gm.locator('.game-rail').getByRole('button', { name: '导演台', exact: true }).click();
    await gm.getByText('配乐库与独立播放控制', { exact: true }).click();
    const panel = gm.getByRole('region', { name: '剧情背景音控制', exact: true });
    await gm
      .getByLabel('上传背景音', { exact: true })
      .setInputFiles({ name: '营地背景.wav', mimeType: 'audio/wav', buffer: wave() });
    await expect(panel.getByRole('combobox', { name: '背景音曲目' })).toContainText('营地背景');
    const id = await panel.getByRole('combobox', { name: '背景音曲目' }).inputValue();
    const opening = await sharp({ create: { width: 500, height: 300, channels: 3, background: '#302418' } })
      .png()
      .toBuffer();
    await gm
      .locator('.presentation-director input[type=file][accept*="image/jpeg"]')
      .setInputFiles({ name: '开场画面.png', mimeType: 'image/png', buffer: opening });
    await expect(gm.locator('.presentation-asset').filter({ hasText: '开场画面' })).toBeVisible();
    await gm.getByRole('button', { name: '向房间展示', exact: true }).click();
    await expect(b.locator('.presentation-viewer.cinematic')).toBeVisible();
    // Presentation portals must retain the same slot below the round counter.
    for (const page of [gm, a, b]) await belowRounds(page);
    await f.post(f.contexts[3], '/rooms/join', { inviteCode: f.room.inviteCode });
    for (const page of [gm, a, b]) {
      await expect(page.locator('.party-member')).toHaveCount(4);
      await belowRounds(page);
    }
    await gm.setViewportSize({ width: 1000, height: 1050 });
    await belowRounds(gm);
    await gm.setViewportSize({ width: 1600, height: 1050 });
    await belowRounds(gm);
    await gm.screenshot({ path: '.launcher/audio/rounds-no-overlap.png' });
    await panel.getByRole('button', { name: '向全员播放', exact: true }).click();
    await playing(gm);
    await playing(a);
    await expect(b.getByRole('button', { name: '开启背景音', exact: true })).toHaveCount(0);
    await expect(b.locator('.room-audio-floating.is-presentation')).toBeVisible();
    await expect(b.getByRole('slider', { name: '我的背景音音量' })).toBeVisible();
    await expect(media(b)).toHaveAttribute('src', new RegExp(`/tracks/${id}/file$`));
    expect(await media(b).evaluate((e: HTMLAudioElement) => e.paused)).toBe(true);
    await b.evaluate(() => {
      (window as any).allowTestAudio = true;
    });
    // No audio control is needed: an ordinary click on the story canvas resumes it.
    await b.mouse.click(600, 420);
    await expect.poll(() => media(b).evaluate((e: HTMLAudioElement) => !e.paused && e.readyState >= 2)).toBe(true);
    await expect(b.locator('.audio-autoplay-hint')).toHaveCount(0);
    expect(await media(b).evaluate((e: HTMLAudioElement) => e.muted)).toBe(false);
    await b.screenshot({ path: '.launcher/audio/player-automatic.png' });
    await gm.getByRole('button', { name: '结束', exact: true }).click();
    await expect(b.locator('.presentation-viewer')).toHaveCount(0);
    for (const page of [gm, a, b]) await belowRounds(page);
    for (const page of [gm, a, b]) {
      await expect(page.getByRole('region', { name: '剧情背景音', exact: true })).toHaveAttribute('data-track-id', id);
      expect(await media(page).evaluate((e: HTMLAudioElement) => e.duration)).toBeCloseTo(30, 1);
    }
    const times = await Promise.all(
      [gm, a, b].map((page) => media(page).evaluate((e: HTMLAudioElement) => e.currentTime)),
    );
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(1);
    await expect.poll(() => media(a).evaluate((e: HTMLAudioElement) => e.currentTime)).toBeGreaterThan(times[1] + 0.2);
    await a.locator('.hero-chip').filter({ hasText: '音乐测试角色' }).click();
    const draft = a.locator('.sheet-name');
    await draft.fill('音频测试未保存草稿');
    await panel.getByRole('button', { name: '暂停全员', exact: true }).click();
    for (const page of [gm, a, b])
      await expect.poll(() => media(page).evaluate((e: HTMLAudioElement) => e.paused)).toBe(true);
    await expect(draft).toHaveValue('音频测试未保存草稿');
    await expect(draft).toBeFocused();
    const seek = panel.getByRole('slider', { name: '背景音播放位置', exact: true }),
      bounds = (await seek.boundingBox())!;
    const seekResult = gm.waitForResponse(
      (r) => r.url().endsWith('/audio/commands') && r.request().postDataJSON().type === 'seek',
    );
    await gm.mouse.click(bounds.x + bounds.width * 0.4, bounds.y + bounds.height / 2);
    expect((await seekResult).ok()).toBe(true);
    const paused = await f.state();
    expect(paused.status).toBe('paused');
    expect(paused.position).toBeGreaterThan(8);
    for (const page of [a, b])
      await expect
        .poll(async () =>
          Math.abs((await media(page).evaluate((e: HTMLAudioElement) => e.currentTime)) - paused.position),
        )
        .toBeLessThan(0.3);
    await panel.getByRole('button', { name: '继续播放', exact: true }).click();
    for (const page of [gm, a, b]) await playing(page);
    await panel.getByRole('slider', { name: '房间背景音音量', exact: true }).press('End');
    await expect.poll(async () => (await f.state()).volume).toBe(1);
    for (const page of [gm, a, b])
      await expect.poll(() => media(page).evaluate((e: HTMLAudioElement) => e.volume)).toBeCloseTo(0.7, 2);
    await gm.getByRole('button', { name: '关闭剧情导演台', exact: true }).click();
    for (const page of [gm, a, b]) expect(await media(page).evaluate((e: HTMLAudioElement) => e.paused)).toBe(false);
    await gm.locator('.game-rail').getByRole('button', { name: '导演台', exact: true }).click();
    await expect(panel.getByRole('slider', { name: '房间背景音音量', exact: true })).toHaveValue('100');
    await a.getByRole('button', { name: '背景音静音', exact: true }).click();
    expect(await media(a).evaluate((e: HTMLAudioElement) => e.muted)).toBe(true);
    expect(await media(b).evaluate((e: HTMLAudioElement) => e.muted)).toBe(false);
    await a.reload();
    await expect(a.getByTitle('已连接', { exact: true })).toBeVisible();
    await playing(a);
    expect(await media(a).evaluate((e: HTMLAudioElement) => e.muted)).toBe(true);
    expect(await media(a).evaluate((e: HTMLAudioElement) => e.currentTime)).toBeGreaterThan(8);
    const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#463219' } })
      .png()
      .toBuffer();
    await gm
      .locator('.presentation-director input[type=file][accept*="image/jpeg"]')
      .setInputFiles({ name: '音乐中的剧情.png', mimeType: 'image/png', buffer: png });
    await expect(gm.locator('.presentation-asset').filter({ hasText: '音乐中的剧情' })).toBeVisible();
    await gm.getByRole('button', { name: '向房间展示', exact: true }).click();
    await expect(b.locator('.presentation-viewer')).toBeVisible();
    await gm.getByRole('button', { name: '黑幕', exact: true }).click();
    expect((await f.state()).status).toBe('playing');
    for (const page of [gm, a, b]) expect(await media(page).evaluate((e: HTMLAudioElement) => e.paused)).toBe(false);
    await gm.getByRole('button', { name: '结束', exact: true }).click();
    expect((await f.state()).status).toBe('playing');
    await panel.scrollIntoViewIfNeeded();
    await gm.screenshot({ path: info.outputPath('director-audio.png') });
    await gm.screenshot({ path: '.launcher/audio/director.png' });
    await b.setViewportSize({ width: 480, height: 880 });
    await expect(b.locator('.room-audio-floating')).toBeVisible();
    await expect(b.getByRole('slider', { name: '我的背景音音量' })).toBeVisible();
    await panel.getByRole('checkbox', { name: '循环播放', exact: true }).uncheck();
    await expect.poll(async () => (await f.state()).loop).toBe(false);
    await expect(seek).toBeEnabled();
    const endBounds = (await seek.boundingBox())!;
    const endSaved = gm.waitForResponse(
      (r) => r.url().endsWith('/audio/commands') && r.request().postDataJSON().type === 'seek',
    );
    await gm.mouse.click(endBounds.x + endBounds.width - 10, endBounds.y + endBounds.height / 2);
    expect((await endSaved).ok()).toBe(true);
    expect((await f.state()).position).toBeGreaterThan(28);
    for (const page of [gm, a, b])
      await expect(page.getByRole('region', { name: '剧情背景音', exact: true })).toHaveAttribute(
        'data-status',
        'stopped',
      );
    await panel.getByRole('button', { name: '向全员播放', exact: true }).click();
    for (const page of [gm, a, b]) await playing(page);
    await panel.getByRole('button', { name: '停止背景音', exact: true }).click();
    for (const page of [gm, a, b]) {
      await expect.poll(() => media(page).evaluate((e: HTMLAudioElement) => e.paused)).toBe(true);
      await expect(page.getByRole('region', { name: '剧情背景音', exact: true })).toHaveAttribute(
        'data-status',
        'stopped',
      );
      await expect(page.getByRole('slider', { name: '我的背景音音量' })).toBeVisible();
    }
  } finally {
    await f.cleanup();
  }
});

test('背景音权限、Range、并发去重、离线恢复、后台重建和删除当前音轨', async ({ browser }) => {
  test.setTimeout(120000);
  const f = await setup(browser);
  try {
    const track = await f.upload('第一首.wav'),
      bytes = wave();
    for (const path of ['/tracks', '/current']) {
      const r = await f.contexts[3].request.get(api + f.base + path);
      expect(r.status()).toBe(403);
    }
    expect((await f.contexts[1].request.get(api + f.base + '/tracks')).status()).toBe(403);
    expect(
      (
        await f.contexts[1].request.post(api + f.base + '/commands', {
          data: { id: randomUUID(), version: 0, type: 'play', trackId: track.id },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await f.contexts[1].request.post(api + f.base + '/tracks', {
          multipart: { file: { name: 'no.wav', mimeType: 'audio/wav', buffer: bytes } },
        })
      ).status(),
    ).toBe(403);
    expect((await f.contexts[1].request.get(new URL(track.url, apiBase).href)).status()).toBe(403);
    const invalid = await f.contexts[0].request.post(api + f.base + '/tracks', {
      multipart: { file: { name: 'fake.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('<script>bad</script>') } },
    });
    expect(invalid.status()).toBe(400);
    expect((await readdir(join(uploadDir, f.room.id, 'audio'))).some((name) => name.endsWith('.part'))).toBe(false);
    await f.db.roomMember.update({
      where: { roomId_userId: { roomId: f.room.id, userId: f.users[2].id } },
      data: { role: 'GM' },
    });
    const commands = await Promise.all(
      [f.contexts[0], f.contexts[2]].map((c) =>
        c.request.post(api + f.base + '/commands', {
          data: { id: randomUUID(), version: 0, type: 'play', trackId: track.id, loop: true },
        }),
      ),
    );
    expect(commands.map((r) => r.status()).sort()).toEqual([200, 409]);
    const version = (await f.state()).revision,
      duplicate = { id: randomUUID(), version, type: 'seek', position: 6 };
    const repeated = await Promise.all([
      f.contexts[0].request.post(api + f.base + '/commands', { data: duplicate }),
      f.contexts[0].request.post(api + f.base + '/commands', { data: duplicate }),
    ]);
    expect(repeated.map((r) => r.status())).toEqual([200, 200]);
    expect((await f.state()).revision).toBe(version + 1);
    expect(await f.db.activityLog.count({ where: { roomId: f.room.id, action: 'audio.seek' } })).toBe(1);
    const range = await f.contexts[1].request.get(new URL(track.url, apiBase).href, {
      headers: { Range: 'bytes=0-63' },
    });
    expect(range.status()).toBe(206);
    expect(range.headers()['content-type']).toContain('audio/wav');
    expect(await range.body()).toEqual(bytes.subarray(0, 64));
    const other = await f.post(f.contexts[0], '/rooms', { name: `${f.room.name}-other` });
    f.rooms.push(other.id);
    expect(
      (await (await f.contexts[0].request.get(api + `/rooms/${other.id}/presentation/audio/current`)).json()).status,
    ).toBe('stopped');
    const player = await f.contexts[1].newPage();
    await player.goto(`/rooms/${f.room.id}`);
    await expect(player.getByTitle('已连接', { exact: true })).toBeVisible();
    await playing(player);
    await f.contexts[1].setOffline(true);
    await expect.poll(() => media(player).evaluate((e: HTMLAudioElement) => e.paused)).toBe(true);
    await f.command('pause');
    await f.contexts[1].setOffline(false);
    await expect(player.getByTitle('已连接', { exact: true })).toBeVisible();
    await expect(player.getByRole('region', { name: '剧情背景音', exact: true })).toHaveAttribute(
      'data-status',
      'paused',
    );
    await f.command('resume');
    await playing(player);
    const before = await f.state();
    await stop();
    await start();
    await expect(player.getByTitle('已连接', { exact: true })).toBeVisible();
    await playing(player);
    const after = await f.state();
    expect(after.revision).toBe(before.revision);
    expect(after.trackId).toBe(track.id);
    expect(after.startedAt).toBe(before.startedAt);
    expect(await media(player).evaluate((e: HTMLAudioElement) => e.currentTime)).toBeGreaterThan(5);
    const second = await f.upload('第二首.wav');
    await f.command('play', { trackId: second.id });
    await expect(player.getByRole('region', { name: '剧情背景音', exact: true })).toHaveAttribute(
      'data-track-id',
      second.id,
    );
    expect((await f.contexts[1].request.get(new URL(track.url, apiBase).href)).status()).toBe(403);
    const stored = await f.db.roomAudioTrack.findUniqueOrThrow({ where: { id: second.id } });
    expect((await f.contexts[0].request.delete(api + f.base + '/tracks/' + second.id)).ok()).toBe(true);
    await expect.poll(() => media(player).evaluate((e: HTMLAudioElement) => e.paused)).toBe(true);
    expect((await f.state()).track).toBe(null);
    expect((await f.contexts[0].request.get(new URL(second.url, apiBase).href)).status()).toBe(404);
    expect((await readdir(join(uploadDir, f.room.id, 'audio'))).includes(stored.storageName)).toBe(false);
    const missing = await f.db.roomAudioTrack.findUniqueOrThrow({ where: { id: track.id } });
    await unlink(join(uploadDir, f.room.id, 'audio', missing.storageName));
    expect((await f.contexts[0].request.get(new URL(track.url, apiBase).href)).status()).toBe(404);
    const unknown = await f.contexts[0].request.post(api + f.base + '/tracks', {
      multipart: { file: { name: 'metadata.wav', mimeType: 'audio/wav', buffer: wave() } },
    });
    expect(unknown.status()).toBe(201);
    const unknownTrack = await unknown.json();
    expect(unknownTrack.duration).toBe(null);
    await f.command('play', { trackId: unknownTrack.id, loop: false });
    const gmPage = await f.contexts[0].newPage();
    await gmPage.goto(`/rooms/${f.room.id}`);
    await expect.poll(async () => (await f.state()).track.duration).toBeCloseTo(30, 1);
    await f.command('stop');
  } finally {
    await f.cleanup();
  }
});
