import { api, apiBase } from './server-address';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

config({ path: 'apps/api/.env', quiet: true });

async function post(context: BrowserContext, path: string, data: unknown) {
  const response = await context.request.post(api + path, { data });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
const op = (context: BrowserContext, roomId: string, type: string, payload: unknown) =>
  post(context, `/rooms/${roomId}/operations`, { id: randomUUID(), type, payload });
async function confirmDelete(page: Page, name: string, accept = true) {
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toContain(name);
    expect(dialog.message()).toContain('无法撤销');
    void (accept ? dialog.accept() : dialog.dismiss());
  });
  await page.getByRole('button', { name: `删除房间：${name}`, exact: true }).click();
}
const test = base.extend<{
  table: { contexts: BrowserContext[]; pages: Page[]; room: any; other: any; users: any[]; db: PrismaClient };
}>({
  table: async ({ browser }, use) => {
    const contexts = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext({ viewport: { width: 1500, height: 1000 } })),
    );
    const db = new PrismaClient(),
      users: any[] = [],
      prefix = `e2e-room-delete-${randomUUID().slice(0, 8)}`;
    let room: any, other: any;
    try {
      for (let index = 0; index < 3; index++)
        users.push(
          await post(contexts[index], '/auth/register', { username: `${prefix}-${index}`, password: randomUUID() }),
        );
      await contexts[3].addCookies(await contexts[0].cookies());
      room = await post(contexts[0], '/rooms', { name: `${prefix}-target` });
      other = await post(contexts[2], '/rooms', { name: `${prefix}-keep` });
      await post(contexts[1], '/rooms/join', { inviteCode: room.inviteCode });
      const pages = await Promise.all(contexts.map((context) => context.newPage()));
      await use({ contexts, pages, room, other, users, db });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      await db.room.deleteMany({
        where: { id: { in: [room?.id, other?.id].filter(Boolean) }, name: { startsWith: prefix } },
      });
      await db.user.deleteMany({
        where: { id: { in: users.map((user) => user.id) }, username: { startsWith: prefix } },
      });
      await db.$disconnect();
    }
  },
});

test('房主从大厅删除有数据的房间：取消/失败重试、权限、级联清理和在线成员退出', async ({ table: t }) => {
  const [gm, player, outsider, ownerTab] = t.pages,
    [gmc, pc, oc] = t.contexts;
  const character = await op(gmc, t.room.id, 'character.create', { name: '要删除的人物', ownerId: t.users[1].id });
  const item = await op(gmc, t.room.id, 'item.create', { name: '要删除的装备', kind: '饰品' });
  const entry = await op(gmc, t.room.id, 'inventory.add', { characterId: character.id, itemId: item.id, quantity: 1 });
  await op(gmc, t.room.id, 'equipment.set', { characterId: character.id, entryId: entry.id, slot: '饰品1' });
  const tag = await op(gmc, t.room.id, 'tagDefinition.create', {
    name: '旧标签',
    icon: 'clue',
    color: '#c69452',
    defaultVisibility: 'PUBLIC',
  });
  await op(gmc, t.room.id, 'characterTag.attach', {
    characterId: character.id,
    tagDefinitionId: tag.id,
    definitionVersion: tag.version,
  });
  await op(gmc, t.room.id, 'map.create', { name: '要删除的地图' });
  const file = {
    name: '要删除的图片.png',
    mimeType: 'image/png',
    buffer: await sharp({ create: { width: 400, height: 300, channels: 3, background: '#896632' } })
      .png()
      .toBuffer(),
  };
  const uploaded = await gmc.request.post(`${api}/rooms/${t.room.id}/upload`, { multipart: { file } });
  expect(uploaded.status()).toBe(201);
  const image = await uploaded.json();
  const assetResponse = await gmc.request.post(`${api}/rooms/${t.room.id}/presentation/assets`, {
    multipart: { title: '要删除的剧情', file },
  });
  expect(assetResponse.status()).toBe(201);
  const asset = await assetResponse.json();
  await post(gmc, `/rooms/${t.room.id}/presentation/commands`, {
    id: randomUUID(),
    version: 0,
    type: 'play',
    assetId: asset.id,
    transition: 'none',
    allowHistory: true,
    requestedMode: 'floating',
  });
  const attachmentResponse = await gmc.request.post(`${api}/rooms/${t.room.id}/private-clues/attachments`, {
    multipart: { file },
  });
  expect(attachmentResponse.status()).toBe(201);
  const attachment = await attachmentResponse.json();
  await post(gmc, `/rooms/${t.room.id}/private-clues/send`, {
    id: randomUUID(),
    title: '要删除的私密线索',
    bodyMarkdown: '线索正文',
    recipientUserIds: [t.users[1].id],
    attachmentIds: [attachment.id],
  });
  await Promise.all([
    gm.goto('/rooms'),
    player.goto(`/rooms/${t.room.id}`),
    outsider.goto('/rooms'),
    ownerTab.goto(`/rooms/${t.room.id}`),
  ]);
  await expect(player.getByTitle('已连接')).toBeVisible();
  await expect(ownerTab.getByTitle('已连接')).toBeVisible();
  await expect(outsider.getByRole('button', { name: `删除房间：${t.room.name}`, exact: true })).toHaveCount(0);
  for (const context of [pc, oc])
    expect((await context.request.delete(`${api}/rooms/${t.room.id}`)).status()).toBe(403);
  // Even an additional GM cannot delete a room owned by someone else.
  await t.db.roomMember.update({
    where: { roomId_userId: { roomId: t.room.id, userId: t.users[1].id } },
    data: { role: 'GM' },
  });
  expect((await pc.request.delete(`${api}/rooms/${t.room.id}`)).status()).toBe(403);
  await t.db.roomMember.update({
    where: { roomId_userId: { roomId: t.room.id, userId: t.users[1].id } },
    data: { role: 'PLAYER' },
  });
  await confirmDelete(gm, t.room.name, false);
  expect(await t.db.room.count({ where: { id: t.room.id } })).toBe(1);
  await gm.route(`**/api/rooms/${t.room.id}`, (route) =>
    route.request().method() === 'DELETE'
      ? route.fulfill({ status: 503, json: { error: '测试删除暂时失败' } })
      : route.continue(),
  );
  await confirmDelete(gm, t.room.name);
  await expect(gm.getByRole('alert')).toContainText('测试删除暂时失败');
  expect(await t.db.character.count({ where: { roomId: t.room.id } })).toBe(1);
  await expect(player.locator('.game-rail')).toBeVisible();
  await gm.unroute(`**/api/rooms/${t.room.id}`);
  const removed = gm.waitForResponse(
    (response) => response.url().endsWith(`/api/rooms/${t.room.id}`) && response.request().method() === 'DELETE',
  );
  await confirmDelete(gm, t.room.name);
  expect((await removed).ok()).toBe(true);
  await expect(gm.getByRole('article', { name: `冒险：${t.room.name}`, exact: true })).toHaveCount(0);
  await expect(player).toHaveURL(/\/rooms$/);
  await expect(ownerTab).toHaveURL(/\/rooms$/);
  for (const model of [
    t.db.roomMember,
    t.db.character,
    t.db.map,
    t.db.itemDefinition,
    t.db.tagDefinition,
    t.db.characterTag,
    t.db.presentationAsset,
    t.db.presentationSession,
    t.db.privateClue,
    t.db.clueDelivery,
    t.db.clueAttachment,
    t.db.activityLog,
    t.db.operationReceipt,
  ])
    expect(await (model as any).count({ where: { roomId: t.room.id } })).toBe(0);
  expect(await t.db.inventoryEntry.count({ where: { id: entry.id } })).toBe(0);
  expect(await t.db.equippedItem.count({ where: { entryId: entry.id } })).toBe(0);
  await expect(access(resolve('apps/api', process.env.UPLOAD_DIR || 'uploads', t.room.id))).rejects.toThrow();
  expect((await pc.request.get(apiBase + image.url)).ok()).toBe(false);
  expect((await oc.request.get(`${api}/rooms/${t.other.id}/snapshot`)).ok()).toBe(true);
  expect(await t.db.room.count({ where: { id: t.other.id } })).toBe(1);
  expect(await t.db.user.count({ where: { id: { in: t.users.map((user) => user.id) } } })).toBe(3);
  expect((await gmc.request.post(api + '/rooms/join', { data: { inviteCode: t.room.inviteCode } })).status()).toBe(404);
  await gm.reload();
  await expect(gm.getByRole('article', { name: `冒险：${t.room.name}`, exact: true })).toHaveCount(0);
});

test('房主从设置删除空房间，观众页同步退出，离线玩家恢复及旧地址不再进入', async ({ table: t }) => {
  const [gm, player, , stage] = t.pages;
  await Promise.all([
    gm.goto(`/rooms/${t.room.id}`),
    player.goto(`/rooms/${t.room.id}`),
    stage.goto(`/rooms/${t.room.id}/presentation`),
  ]);
  await expect(gm.getByTitle('已连接')).toBeVisible();
  await expect(player.getByTitle('已连接')).toBeVisible();
  await expect(stage.getByText('实时连接中', { exact: true })).toBeVisible();
  await player.bringToFront();
  await player.locator('.game-rail button[title="设置"]').click();
  await expect(player.getByRole('button', { name: '关闭房间设置', exact: true })).toBeVisible();
  await expect(player.getByRole('button', { name: `删除房间：${t.room.name}`, exact: true })).toHaveCount(0);
  await t.contexts[1].setOffline(true);
  await expect(player.getByTitle('正在重连')).toBeVisible();
  await gm.bringToFront();
  await gm.locator('.game-rail button[title="设置"]').click();
  await expect(gm.getByRole('button', { name: '关闭房间设置', exact: true })).toBeVisible();
  await expect(gm.getByRole('button', { name: `删除房间：${t.room.name}`, exact: true })).toBeVisible();
  await confirmDelete(gm, t.room.name);
  await expect(gm).toHaveURL(/\/rooms$/);
  await expect(stage).toHaveURL(/\/rooms$/);
  await t.contexts[1].setOffline(false);
  await expect(player).toHaveURL(/\/rooms$/);
  expect(await t.db.room.count({ where: { id: t.room.id } })).toBe(0);
  await player.goto(`/rooms/${t.room.id}`);
  await expect(player).toHaveURL(/\/rooms$/);
  await stage.goto(`/rooms/${t.room.id}/presentation`);
  await expect(stage).toHaveURL(/\/rooms$/);
  expect(await t.db.room.count({ where: { id: t.other.id } })).toBe(1);
});
