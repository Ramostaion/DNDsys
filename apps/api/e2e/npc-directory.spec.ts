import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { rm } from 'node:fs/promises';

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

async function setup(browser: Browser) {
  const contexts = await Promise.all(
    [0, 1, 2, 3].map(() => browser.newContext({ viewport: { width: 1600, height: 1050 } })),
  );
  const db = new PrismaClient(),
    users: { id: string }[] = [],
    rooms: string[] = [],
    prefix = `npc-${randomUUID().slice(0, 8)}`;
  const post = async (c: BrowserContext, path: string, body: unknown) => {
    const r = await c.request.post(api + path, { data: body });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  async function cleanup() {
    await Promise.all(contexts.map((c) => c.close()));
    // Cleanup must not depend on the fixture's long-idle connection remaining healthy.
    const cleaner = new PrismaClient();
    try {
      for (const id of rooms) {
        await cleaner.room.deleteMany({ where: { id, name: { startsWith: prefix } } });
        const folder = resolve(uploadDir, id);
        if (dirname(folder) !== resolve(uploadDir)) throw new Error('测试文件目录不正确');
        await rm(folder, { recursive: true, force: true });
      }
      await cleaner.user.deleteMany({
        where: { id: { in: users.map((u) => u.id) }, username: { startsWith: prefix } },
      });
    } finally {
      await cleaner.$disconnect();
      await db.$disconnect();
    }
  }
  try {
    for (const [i, c] of contexts.entries())
      users.push(await post(c, '/auth/register', { username: `${prefix}-${i}`, password: randomUUID() }));
    const room = await post(contexts[0], '/rooms', { name: prefix });
    rooms.push(room.id);
    for (const c of contexts.slice(1, 3)) await post(c, '/rooms/join', { inviteCode: room.inviteCode });
    return { db, contexts, users, room, rooms, post, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

type Fixture = Awaited<ReturnType<typeof setup>>;
async function directory(f: Fixture, c = f.contexts[0]) {
  const r = await c.request.get(`${api}/rooms/${f.room.id}/npc-directory`);
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}
async function snapshot(f: Fixture, c = f.contexts[0]) {
  const r = await c.request.get(`${api}/rooms/${f.room.id}/snapshot`);
  expect(r.status(), await r.text()).toBe(200);
  return r.json();
}
async function op(f: Fixture, type: string, payload: any, status = 200, c = f.contexts[0], requestId = randomUUID()) {
  const r = await c.request.post(`${api}/rooms/${f.room.id}/operations`, {
    data: {
      id: requestId,
      type,
      payload: { ...(type.startsWith('npcDirectory.') ? { version: (await directory(f)).revision } : {}), ...payload },
    },
  });
  expect(r.status(), await r.text()).toBe(status);
  return r.json();
}

test('NPC目录事务：层级、排序、循环、跨房间、删除保留、类型转换、双GM竞争和玩家隔离', async ({ browser }) => {
  test.setTimeout(150000);
  const f = await setup(browser);
  try {
    await f.db.roomMember.update({
      where: { roomId_userId: { roomId: f.room.id, userId: f.users[2].id } },
      data: { role: 'GM' },
    });
    const player = await f.contexts[1].newPage(),
      frames: string[] = [];
    player.on('websocket', (socket) => socket.on('framereceived', (frame) => frames.push(String(frame.payload))));
    await player.goto(`/rooms/${f.room.id}`);
    await expect(player.getByTitle('已连接', { exact: true })).toBeVisible();
    const a = await op(f, 'npcDirectory.create', { name: '  王都秘密目录  ' }),
      b = await op(f, 'npcDirectory.create', { name: '守卫', parentId: a.id }),
      c = await op(f, 'npcDirectory.create', { name: '精英', parentId: b.id }),
      other = await op(f, 'npcDirectory.create', { name: '荒野' });
    expect(a.name).toBe('王都秘密目录');
    await op(f, 'npcDirectory.create', { name: '王都秘密目录' }, 409);
    await op(f, 'npcDirectory.create', { name: '守卫', parentId: other.id });
    await op(f, 'npcDirectory.move', { id: a.id, parentId: c.id }, 400);
    await op(f, 'npcDirectory.move', { id: b.id, parentId: b.id }, 400);
    await op(f, 'npcDirectory.rename', { id: other.id, name: '城外' });
    await op(f, 'npcDirectory.sort', { id: other.id, direction: -1 });
    expect((await directory(f)).folders.filter((row: any) => !row.parentId)[0].id).toBe(other.id);
    const npc = await op(f, 'character.create', { name: '公开守卫', isNpc: true, npcFolderId: b.id }),
      secret = await op(f, 'character.create', { name: '隐藏守卫', isNpc: true, visibility: 'GM', npcFolderId: c.id }),
      unfiled = await op(f, 'character.create', { name: '旧未分类', isNpc: true });
    const secondRoom = await f.post(f.contexts[0], '/rooms', { name: `${f.room.name}-other` });
    f.rooms.push(secondRoom.id);
    const foreign = await f.contexts[0].request.post(`${api}/rooms/${secondRoom.id}/operations`, {
      data: { id: randomUUID(), type: 'npcDirectory.create', payload: { version: 0, name: '异房间' } },
    });
    const foreignId = (await foreign.json()).id;
    await op(f, 'npcDirectory.move', { id: a.id, parentId: foreignId }, 404);
    await op(f, 'npcDirectory.assign', { characterIds: [npc.id], parentId: foreignId }, 404);
    const foreignNpc = await f.post(f.contexts[0], `/rooms/${secondRoom.id}/operations`, {
      id: randomUUID(),
      type: 'character.create',
      payload: { name: '异房间NPC', isNpc: true },
    });
    await op(f, 'npcDirectory.assign', { characterIds: [foreignNpc.id], parentId: a.id }, 400);
    const pcs = await op(f, 'character.create', { name: '玩家角色' });
    await op(f, 'npcDirectory.assign', { characterIds: [pcs.id], parentId: a.id }, 400);
    for (const type of ['create', 'rename', 'move', 'sort', 'delete', 'assign'])
      await op(f, `npcDirectory.${type}`, { id: a.id, name: '越权', characterIds: [npc.id] }, 403, f.contexts[1]);
    expect((await f.contexts[1].request.get(`${api}/rooms/${f.room.id}/npc-directory`)).status()).toBe(403);
    expect((await f.contexts[3].request.get(`${api}/rooms/${f.room.id}/npc-directory`)).status()).toBe(403);
    const publicSnap = await snapshot(f, f.contexts[1]);
    expect(publicSnap.characters.some((row: any) => row.id === npc.id)).toBe(true);
    expect(publicSnap.characters.some((row: any) => row.id === secret.id)).toBe(false);
    expect(publicSnap).not.toHaveProperty('npcDirectory');
    expect(JSON.stringify(publicSnap)).not.toContain('王都秘密目录');
    expect(publicSnap.logs.some((row: any) => row.action.startsWith('npcDirectory.'))).toBe(false);
    expect(frames.some((frame) => frame.includes('npcDirectory') || frame.includes('王都秘密目录'))).toBe(false);
    const v = (await directory(f)).revision,
      race = await Promise.all(
        [a, other].map((row, i) =>
          f.contexts[i ? 2 : 0].request.post(`${api}/rooms/${f.room.id}/operations`, {
            data: {
              id: randomUUID(),
              type: 'npcDirectory.move',
              payload: { id: row.id, parentId: i ? a.id : other.id, version: v },
            },
          }),
        ),
      );
    expect(race.map((r) => r.status()).sort()).toEqual([200, 409]);
    const retryId = randomUUID(),
      payload = { version: (await directory(f)).revision, characterIds: [npc.id, unfiled.id], parentId: b.id };
    const before = await f.db.operationReceipt.count({ where: { roomId: f.room.id } });
    const retries = await Promise.all(
      [0, 1].map(() =>
        f.contexts[0].request.post(`${api}/rooms/${f.room.id}/operations`, {
          data: { id: retryId, type: 'npcDirectory.assign', payload },
        }),
      ),
    );
    expect(retries.map((r) => r.status())).toEqual([200, 200]);
    expect(await f.db.operationReceipt.count({ where: { roomId: f.room.id } })).toBe(before + 1);
    // Delete an interior folder: its direct NPCs move up; descendants remain intact.
    await op(f, 'npcDirectory.delete', { id: b.id, destination: 'PARENT' });
    let data = await directory(f);
    expect(data.folders.find((row: any) => row.id === c.id).parentId).toBe(a.id);
    expect(data.classifications.find((row: any) => row.characterId === npc.id).folderId).toBe(a.id);
    expect(data.classifications.find((row: any) => row.characterId === secret.id).folderId).toBe(c.id);
    await op(f, 'npcDirectory.delete', { id: a.id, destination: 'ROOT' });
    data = await directory(f);
    expect(data.folders.find((row: any) => row.id === c.id).parentId).toBeNull();
    expect(data.classifications.some((row: any) => row.characterId === npc.id)).toBe(false);
    expect(
      await f.db.character.count({ where: { roomId: f.room.id, id: { in: [npc.id, secret.id, unfiled.id] } } }),
    ).toBe(3);
    await op(f, 'npcDirectory.assign', { characterIds: [npc.id], parentId: c.id });
    await op(f, 'character.update', { id: npc.id, version: npc.version, patch: { isNpc: false } });
    expect((await directory(f)).classifications.some((row: any) => row.characterId === npc.id)).toBe(false);
    const changed = await f.db.character.findUniqueOrThrow({ where: { id: npc.id } });
    await op(f, 'character.update', { id: npc.id, version: changed.version, patch: { isNpc: true } });
    expect((await directory(f)).classifications.some((row: any) => row.characterId === npc.id)).toBe(false);
    await op(f, 'npcDirectory.assign', { characterIds: [npc.id], parentId: c.id });
    await op(f, 'character.delete', { id: npc.id });
    expect((await directory(f)).classifications.some((row: any) => row.characterId === npc.id)).toBe(false);
    const persisted = await directory(f);
    await stop();
    await start();
    expect(await directory(f)).toEqual(persisted);
  } finally {
    await f.cleanup();
  }
});

test('GM NPC目录界面：创建、筛选搜索、批量移动、分页、失败恢复、双GM同步、人物卡草稿和地图拖放', async ({
  browser,
}) => {
  test.setTimeout(180000);
  const f = await setup(browser);
  try {
    await f.db.roomMember.update({
      where: { roomId_userId: { roomId: f.room.id, userId: f.users[2].id } },
      data: { role: 'GM' },
    });
    const a = await op(f, 'npcDirectory.create', { name: '王都' }),
      b = await op(f, 'npcDirectory.create', { name: '卫队', parentId: a.id }),
      c = await op(f, 'npcDirectory.create', { name: '精英', parentId: b.id });
    for (let n = 0; n < 14; n++)
      await op(f, 'character.create', {
        name: `守卫${String(n).padStart(2, '0')}`,
        isNpc: true,
        npcFolderId: n === 0 ? a.id : b.id,
      });
    const map = await op(f, 'map.create', { name: '目录地图' });
    await op(f, 'map.activate', { id: map.id });
    const [gm, other, player] = await Promise.all(
      [f.contexts[0], f.contexts[2], f.contexts[1]].map((ctx) => ctx.newPage()),
    );
    for (const page of [gm, other, player]) {
      await page.goto(`/rooms/${f.room.id}`);
      await expect(page.getByTitle('已连接', { exact: true })).toBeVisible();
      await page.locator('.game-rail').getByRole('button', { name: '角色', exact: true }).click();
      await page.getByRole('tab', { name: /NPC/ }).click();
    }
    await expect(player.getByLabel('NPC目录树')).toHaveCount(0);
    const manager = gm.getByRole('region', { name: 'GM NPC目录管理' }),
      tree = manager.getByLabel('NPC目录树');
    await tree.getByRole('button', { name: /^王都/ }).click();
    await expect(manager.locator('.npc-pagination')).toContainText('14 个');
    await manager.getByRole('checkbox', { name: '包含子目录' }).uncheck();
    await expect(manager.locator('.npc-pagination')).toContainText('1 个');
    await manager.getByRole('checkbox', { name: '包含子目录' }).check();
    await manager.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(manager.locator('.npc-card')).toHaveCount(2);
    await manager.getByLabel('搜索NPC名称').fill('守卫13');
    await expect(manager.locator('.npc-card')).toHaveCount(1);
    await expect(manager.locator('.npc-path')).toHaveText('王都 / 卫队');
    await manager.locator('.npc-path').click();
    await expect(manager.getByLabel('NPC目录路径')).toHaveText(/全部 NPC.*王都.*卫队/);
    await manager.getByLabel('新 NPC 名称', { exact: true }).fill('新队长');
    await manager.getByRole('button', { name: '创建 NPC', exact: true }).click();
    await expect.poll(async () => (await directory(f)).classifications.length).toBe(15);
    await expect(other.getByRole('region', { name: 'GM NPC目录管理' }).locator('.npc-pagination')).toContainText(
      '15 个',
    );
    await manager.getByLabel('搜索NPC名称').fill('新队长');
    await manager.getByLabel('选择 新队长', { exact: true }).check();
    await manager.getByRole('button', { name: '批量移动到…' }).click();
    await manager.getByLabel('移动目标目录').selectOption(c.id);
    await manager.getByRole('button', { name: '确认', exact: true }).click();
    await expect(manager.locator('.npc-path')).toHaveText('王都 / 卫队 / 精英');
    const captainId = (await snapshot(f)).characters.find((row: any) => row.name === '新队长').id;
    const tag = await op(f, 'tagDefinition.create', {
      name: '警戒',
      icon: 'flame',
      color: '#d4af57',
      defaultVisibility: 'PUBLIC',
    });
    await op(f, 'characterTag.attach', {
      characterId: captainId,
      tagDefinitionId: tag.id,
      definitionVersion: tag.version,
    });
    await expect(manager.getByRole('button', { name: '状态：警戒', exact: true })).toBeVisible();
    // Opening the card and a remote folder rename must preserve the draft.
    await manager.getByRole('button', { name: '新队长', exact: true }).click();
    const draft = gm.locator('.sheet-name');
    const title = gm.locator('.window').filter({ has: draft }).locator('.window-title');
    const box = (await title.boundingBox())!;
    await gm.mouse.move(box.x + 100, box.y + 20);
    await gm.mouse.down();
    await gm.mouse.move(1100, 100, { steps: 8 });
    await gm.mouse.up();
    await draft.fill('尚未保存队长');
    await op(f, 'npcDirectory.rename', { id: c.id, name: '精锐' }, 200, f.contexts[2]);
    await expect(manager.locator('.npc-path')).toHaveText('王都 / 卫队 / 精锐');
    await expect(draft).toHaveValue('尚未保存队长');
    await expect(draft).toBeFocused();
    // The existing name editor saves on blur; restore it before other clicks.
    await draft.fill('新队长');
    // A directory mutation failure keeps the form and can be retried.
    await manager.getByRole('button', { name: '新建子目录' }).click();
    await manager.getByLabel('目录名称').fill('失败后重试');
    await gm.route('**/operations', async (route) => {
      if (route.request().postDataJSON().type === 'npcDirectory.create') {
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: '测试暂时失败' }),
        });
      } else await route.continue();
    });
    await manager.getByRole('button', { name: '确认', exact: true }).click();
    await expect(manager.getByRole('alert')).toHaveText('测试暂时失败');
    await expect(manager.getByLabel('目录名称')).toHaveValue('失败后重试');
    await gm.unroute('**/operations');
    await manager.getByRole('button', { name: '确认', exact: true }).click();
    await expect(manager.getByLabel('目录操作')).toHaveCount(0);
    // Map payload remains the original characterId drag contract.
    const card = manager.getByRole('button', { name: '新队长', exact: true });
    const id = (await snapshot(f)).characters.find((row: any) => row.name === '新队长').id;
    const data = await gm.evaluateHandle(() => new DataTransfer());
    await card.dispatchEvent('dragstart', { dataTransfer: data });
    expect(await data.evaluate((d) => d.getData('characterId'))).toBe(id);
    const surface = gm.locator('.konvajs-content');
    await surface.dispatchEvent('drop', { dataTransfer: data, clientX: 900, clientY: 600 });
    await expect.poll(async () => (await snapshot(f)).tokens.some((t: any) => t.characterId === id)).toBe(true);
    await data.dispose();
    await gm.reload();
    await expect(gm.getByTitle('已连接', { exact: true })).toBeVisible();
    await gm.locator('.game-rail').getByRole('button', { name: '角色', exact: true }).click();
    await gm.getByRole('tab', { name: /NPC/ }).click();
    await expect(gm.getByRole('button', { name: '收起目录 王都', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    const again = gm.getByRole('region', { name: 'GM NPC目录管理' });
    await again.getByLabel('NPC目录树').getByRole('button', { name: /^卫队/ }).click();
    await op(f, 'npcDirectory.delete', { id: b.id, destination: 'PARENT' }, 200, f.contexts[2]);
    await expect(again.getByRole('alert')).toContainText('已返回全部 NPC');
    await again.getByLabel('搜索NPC名称').fill('新队长');
    await again.getByLabel('搜索范围').selectOption('all');
    await expect(again.locator('.npc-path')).toHaveText('王都 / 精锐');
    await expect(again.getByRole('button', { name: '状态：警戒', exact: true })).toBeVisible();
    const treeBounds = (await again.getByLabel('NPC目录树').boundingBox())!,
      resultBounds = (await again.locator('.npc-results').boundingBox())!;
    expect(treeBounds.x + treeBounds.width).toBeLessThan(resultBounds.x);
    await gm.screenshot({ path: '.launcher/audio/npc-directory.png' });
    await again.getByRole('button', { name: '收起目录', exact: true }).click();
    await expect(again.getByLabel('NPC目录树')).toHaveCount(0);
    await again.getByRole('button', { name: '展开目录', exact: true }).click();
    await expect(again.getByLabel('NPC目录树')).toBeVisible();
  } finally {
    await f.cleanup();
  }
});
