import { api, apiBase } from './server-address';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve, sep, dirname } from 'node:path';
import { rm } from 'node:fs/promises';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
config({ path: 'apps/api/.env' });

async function post(c: BrowserContext, path: string, data: unknown) {
  const r = await c.request.post(api + path, { data });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
async function get(c: BrowserContext, path: string) {
  const r = await c.request.get(api + path);
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
async function patch(c: BrowserContext, path: string, data: unknown) {
  const r = await c.request.patch(api + path, { data });
  expect(r.ok(), await r.text()).toBe(true);
  return r.json();
}
const op = (c: BrowserContext, roomId: string, type: string, payload: unknown) =>
  post(c, `/rooms/${roomId}/operations`, { id: randomUUID(), type, payload });
const picture = () =>
  sharp({ create: { width: 1000, height: 600, channels: 3, background: '#895532' } })
    .png()
    .toBuffer();
async function closeWindow(page: Page, name: string) {
  const button = page.getByRole('button', { name, exact: true });
  await page
    .locator('.window')
    .filter({ has: button })
    .locator('.window-title')
    .click({ position: { x: 20, y: 20 } });
  await button.click();
}
async function openClues(page: Page) {
  await page.locator('.game-rail button[title="私密线索"]').click();
  await expect(page.locator('.private-clues')).toBeVisible();
}
async function privateUpload(c: BrowserContext, path: string) {
  const r = await c.request.post(api + path + '/attachments', {
    multipart: { file: { name: '古书残页.png', mimeType: 'image/png', buffer: await picture() } },
  });
  expect(r.status(), await r.text()).toBe(201);
  return r.json();
}
async function startRecoveryAPI() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => probe.close((e) => (e ? reject(e) : resolve())));
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: resolve('apps/api'),
    env: { ...process.env, PORT: String(port) },
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const url = `http://localhost:${port}`;
  try {
    await expect
      .poll(
        async () => {
          try {
            return (await fetch(url + '/api/health')).ok;
          } catch {
            return false;
          }
        },
        { timeout: 20000 },
      )
      .toBe(true);
    return { child, url };
  } catch (e) {
    await stopRecoveryAPI(child);
    throw e;
  }
}
async function stopRecoveryAPI(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill();
  });
}
type Table = { contexts: BrowserContext[]; pages: Page[]; users: any[]; room: any; db: PrismaClient; base: string };
const test = base.extend<{ table: Table }>({
  table: async ({ browser }, use) => {
    const contexts = await Promise.all(
      Array.from({ length: 4 }, () => browser.newContext({ viewport: { width: 1600, height: 1050 } })),
    );
    const db = new PrismaClient(),
      users: any[] = [],
      prefix = `e2e-clue-${randomUUID().slice(0, 8)}`;
    let room: any;
    try {
      for (const [i, c] of contexts.entries())
        users.push(await post(c, '/auth/register', { username: `${prefix}-${i}`, password: randomUUID() }));
      room = await post(contexts[0], '/rooms', { name: `E2E private clues ${prefix}` });
      for (const c of contexts.slice(1)) await post(c, '/rooms/join', { inviteCode: room.inviteCode });
      const pages = await Promise.all(contexts.map((c) => c.newPage()));
      await use({ contexts, pages, users, room, db, base: `/rooms/${room.id}/private-clues` });
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
      if (
        room &&
        (await db.room.findUnique({ where: { id: room.id }, select: { name: true } }))?.name ===
          `E2E private clues ${prefix}`
      ) {
        await db.room.delete({ where: { id: room.id } });
        const root = resolve('apps/api', process.env.UPLOAD_DIR || 'uploads'),
          target = resolve(root, room.id);
        if (target.startsWith(root + sep) && dirname(target) === root)
          await rm(target, { recursive: true, force: true });
      }
      await db.user.deleteMany({
        where: { id: { in: users.map((u) => u.id) }, username: { startsWith: prefix + '-' } },
      });
      await db.$disconnect();
    }
  },
});

test('私密线索阶段 A：事务投递、精确隔离、独立已读与操作去重', async ({ table: t }) => {
  const [gm, a, b, c] = t.contexts,
    id = randomUUID(),
    input = {
      id,
      title: '古书残页',
      bodyMarkdown: '只有甲与丙能看到的秘密',
      gmNote: '绝不能传给玩家的备注',
      recipientUserIds: [t.users[1].id, t.users[3].id],
    };
  const results = await Promise.all([post(gm, t.base + '/send', input), post(gm, t.base + '/send', input)]);
  expect(results[0].clueId).toBe(results[1].clueId);
  expect(await t.db.privateClue.count({ where: { roomId: t.room.id } })).toBe(1);
  expect(await t.db.clueDelivery.count({ where: { roomId: t.room.id } })).toBe(2);
  const inboxA = await get(a, t.base + '/inbox'),
    inboxC = await get(c, t.base + '/inbox');
  expect(inboxA.unreadCount).toBe(1);
  expect(inboxC.unreadCount).toBe(1);
  expect((await get(b, t.base + '/inbox')).items).toEqual([]);
  const detail = await get(a, `${t.base}/deliveries/${inboxA.items[0].id}`);
  expect(detail.bodyMarkdown).toBe(input.bodyMarkdown);
  for (const key of ['gmNote', 'recipientUserIds', 'deliveries', 'senderUserId'])
    expect(detail).not.toHaveProperty(key);
  expect((await b.request.get(api + `${t.base}/deliveries/${inboxA.items[0].id}`)).status()).toBe(404);
  expect(
    (await b.request.patch(api + `${t.base}/deliveries/${inboxA.items[0].id}`, { data: { read: true } })).status(),
  ).toBe(404);
  expect((await a.request.post(api + t.base + '/send', { data: input })).status()).toBe(403);
  expect((await a.request.get(api + t.base + '/sent')).status()).toBe(403);
  expect(
    (
      await a.request.post(api + t.base + `/deliveries/${detail.id}/forward`, {
        data: { id: randomUUID(), recipientUserIds: [t.users[2].id] },
      })
    ).status(),
  ).toBe(403);
  const read = await patch(a, `${t.base}/deliveries/${detail.id}`, { read: true });
  expect((await patch(a, `${t.base}/deliveries/${detail.id}`, { read: true })).readAt).toBe(read.readAt);
  expect((await get(c, t.base + '/inbox')).unreadCount).toBe(1);
  const sent = await get(gm, t.base + '/sent');
  expect(sent[0]).toMatchObject({ recipientCount: 2, readCount: 1 });
  const receipts = await get(gm, t.base + '/sent/' + results[0].clueId);
  expect(receipts.gmNote).toBe(input.gmNote);
  expect(receipts.deliveries.filter((d: any) => d.readAt)).toHaveLength(1);
  const outsider = await t.db.user.create({ data: { username: 'outside-' + randomUUID(), passwordHash: 'not-used' } });
  try {
    expect(
      (
        await gm.request.post(api + t.base + '/send', {
          data: { ...input, id: randomUUID(), recipientUserIds: [t.users[1].id, outsider.id] },
        })
      ).status(),
    ).toBe(400);
    expect(await t.db.privateClue.count({ where: { roomId: t.room.id } })).toBe(1);
  } finally {
    await t.db.user.delete({ where: { id: outsider.id } });
  }
  const snap = await get(b, `/rooms/${t.room.id}/snapshot`);
  expect(JSON.stringify(snap)).not.toContain(input.bodyMarkdown);
  expect(JSON.stringify(snap)).not.toContain('古书残页');
});

test('私密线索阶段 B：四账号非模态收取、离线恢复、草稿保护与独立回执', async ({ table: t }) => {
  test.setTimeout(120000);
  const [gm, a, b, c] = t.pages,
    [gmc, ac, bc, cc] = t.contexts;
  const ca = await op(gmc, t.room.id, 'character.create', { name: '线索接收者甲', ownerId: t.users[1].id });
  await post(gmc, `/rooms/${t.room.id}/members/${t.users[1].id}/permissions`, { characterBasics: true });
  await Promise.all(t.pages.map((page) => page.goto(`/rooms/${t.room.id}`)));
  await expect(a.locator('.game-rail')).toBeVisible();
  const packets: string[] = [];
  b.on('websocket', (socket) => socket.on('framereceived', (frame) => packets.push(String(frame.payload))));
  await b.reload();
  await a.locator('.game-rail button[title="角色"]').click();
  await a.getByRole('button', { name: ca.name, exact: true }).click();
  await closeWindow(a, '关闭角色');
  const name = a.locator('.sheet-name');
  await name.fill('持续编辑的未保存名字');
  await expect(c.getByTitle('已连接')).toBeVisible();
  // A failed background session refresh must not unmount the room or its recovery handlers.
  let sessionFailures = 0;
  await c.route('**/api/auth/me', async (route) => {
    sessionFailures++;
    await route.fulfill({ status: 503, json: { error: '临时连接失败' } });
  });
  await c.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => sessionFailures).toBeGreaterThan(0);
  await expect(c.locator('.game-rail')).toBeVisible();
  await expect(c.getByText('暂时无法连接冒险桌', { exact: true })).toHaveCount(0);
  await c.unroute('**/api/auth/me');
  await cc.setOffline(true);
  await expect(c.getByTitle('正在重连')).toBeVisible();
  await openClues(gm);
  const compose = gm.locator('.clue-compose');
  await compose.getByLabel('线索标题', { exact: true }).fill('两个人的秘密');
  await compose.getByLabel('线索正文', { exact: true }).fill('古书残页\n**只有甲与丙收到**');
  await compose.getByLabel(t.users[1].username, { exact: false }).check();
  await compose.getByLabel(t.users[3].username, { exact: false }).check();
  await closeWindow(gm, '关闭私密线索');
  await openClues(gm);
  await expect(compose.getByLabel('线索标题', { exact: true })).toHaveValue('两个人的秘密');
  await expect(compose.getByLabel(t.users[3].username, { exact: false })).toBeChecked();
  await gm.locator('.private-clues').getByRole('tab', { name: 'GM 发件箱', exact: true }).click();
  await gm.locator('.private-clues').getByRole('tab', { name: '私密投递', exact: true }).click();
  await expect(compose.getByLabel('线索正文', { exact: true })).toHaveValue('古书残页\n**只有甲与丙收到**');
  await name.focus();
  await compose.getByRole('button', { name: '私密发送给 2 人', exact: true }).click();
  await expect(compose.getByRole('status')).toContainText('已私密发送给 2 人');
  await expect(a.getByLabel('1 条未读私密线索')).toBeVisible();
  await expect(a.locator('.private-clue-notice')).toBeVisible();
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('持续编辑的未保存名字');
  await expect(a.locator('.private-clues')).toHaveCount(0);
  await expect(a.locator('.private-clue-reader')).toHaveCount(0);
  await expect(b.locator('.clue-rail-badge')).toHaveCount(0);
  expect((await get(bc, t.base + '/inbox')).items).toHaveLength(0);
  expect(packets.some((packet) => packet.includes('privateClue.changed') || packet.includes('古书残页'))).toBe(false);
  await a.getByRole('button', { name: '关闭私密线索通知' }).click();
  await closeWindow(a, '关闭人物卡');
  await openClues(a);
  await expect(a.locator('.private-clue-row')).toHaveCount(1);
  const ad = (await get(ac, t.base + '/inbox')).items[0];
  expect(ad.readAt).toBeNull();
  await a.locator('.private-clue-row').click();
  await expect(a.locator('.private-clue-reader')).toContainText('只有甲与丙收到');
  await expect.poll(async () => (await get(ac, t.base + '/inbox')).unreadCount).toBe(0);
  await cc.setOffline(false);
  await expect(c.getByLabel('1 条未读私密线索')).toBeVisible();
  await openClues(c);
  await expect(c.locator('.private-clue-row')).toContainText('两个人的秘密');
  expect((await get(cc, t.base + '/inbox')).items[0].readAt).toBeNull();
  await gm.locator('.private-clues').getByRole('tab', { name: 'GM 发件箱', exact: true }).click();
  await expect(gm.locator('.clue-sent-box')).toContainText('2 名接收者 · 1 人已读');
  await gm.locator('.clue-sent-box .private-clue-row').click();
  await expect(gm.locator('.clue-receipts')).toContainText('2 名接收者，1 人已读');
  // A second tab of the same account recovers the same persisted delivery and status.
  const a2 = await ac.newPage();
  await a2.goto(`/rooms/${t.room.id}`);
  await openClues(a2);
  await expect(a2.locator('.private-clue-row')).toContainText('已读');
  expect((await get(ac, t.base + '/inbox')).items).toHaveLength(1);
  await a.reload();
  await openClues(a);
  await expect(a.locator('.private-clue-row')).toContainText('已读');
  await expect(a.locator('.private-clue-row')).toHaveCount(1);
  await gm.screenshot({ path: 'test-results/private-clues-gm-receipts.png', animations: 'disabled' });
  await a.screenshot({ path: 'test-results/private-clues-player-inbox.png', animations: 'disabled' });
});

test('私密线索阶段 C：图片隔离、失败恢复、发送响应丢失去重与 API 重启持久化', async ({ table: t }) => {
  test.setTimeout(150000);
  const [gm, a, b, c] = t.pages,
    [gmc, ac, bc] = t.contexts;
  await Promise.all(t.pages.map((p) => p.goto(`/rooms/${t.room.id}`)));
  await expect(a.getByTitle('已连接')).toBeVisible();
  await openClues(gm);
  const compose = gm.locator('.clue-compose');
  await compose.getByLabel('线索标题', { exact: true }).fill('私密高清图');
  await compose.getByLabel('线索正文', { exact: true }).fill('图片失败也不丢失这段文字');
  await compose.getByLabel(t.users[1].username, { exact: false }).check();
  await gm.route('**/private-clues/attachments', (route) =>
    route.fulfill({ status: 503, json: { error: '测试上传中断' } }),
  );
  await compose
    .getByLabel('上传私密图片', { exact: true })
    .setInputFiles({ name: '私密图片.png', mimeType: 'image/png', buffer: await picture() });
  await expect(compose.locator('.clue-upload-task')).toContainText('测试上传中断');
  await expect(compose.getByLabel('线索正文', { exact: true })).toHaveValue('图片失败也不丢失这段文字');
  await expect(compose.getByLabel(t.users[1].username, { exact: false })).toBeChecked();
  await gm.unroute('**/private-clues/attachments');
  await compose.getByRole('button', { name: '重试上传', exact: true }).click();
  await expect(compose.locator('.clue-attachment')).toHaveCount(1);
  const attachment = await t.db.clueAttachment.findFirstOrThrow({ where: { roomId: t.room.id } });
  const imageUrl = `${t.base}/attachments/${attachment.id}/original`;
  expect((await ac.request.get(api + imageUrl)).status()).toBe(404);
  expect((await bc.request.get(api + imageUrl)).status()).toBe(404);
  let first = true;
  await gm.route('**/private-clues/send', async (route) => {
    if (first) {
      first = false;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.abort('failed');
    } else await route.continue();
  });
  await compose.getByRole('button', { name: '私密发送给 1 人', exact: true }).click();
  await expect(compose.getByRole('alert')).toContainText('发送状态待确认');
  await expect(compose.getByLabel('线索标题', { exact: true })).toBeDisabled();
  await compose.getByRole('button', { name: '确认状态并重试', exact: true }).click();
  await expect(compose.getByRole('status')).toContainText('已私密发送');
  await gm.unroute('**/private-clues/send');
  expect(await t.db.privateClue.count({ where: { roomId: t.room.id } })).toBe(1);
  expect(await t.db.clueDelivery.count({ where: { roomId: t.room.id } })).toBe(1);
  expect((await ac.request.get(api + imageUrl)).ok()).toBe(true);
  expect((await bc.request.get(api + imageUrl)).status()).toBe(404);
  await openClues(a);
  await a.locator('.private-clue-row').click();
  await expect(a.locator('.private-clue-reader')).toContainText('图片失败也不丢失这段文字');
  await a.route('**/private-clues/attachments/*/original*', (route) => route.abort());
  await a.locator('.private-clue-reader').getByRole('button', { name: '查看原图 私密图片.png', exact: true }).click();
  await expect(a.locator('.private-clue-image')).toContainText('图片读取失败');
  await a.unroute('**/private-clues/attachments/*/original*');
  await a.locator('.private-clue-image').getByRole('button', { name: '重试', exact: true }).click();
  const viewport = a.locator('.private-clue-image .clue-image-viewport');
  await expect(viewport.locator('img')).toBeVisible();
  await viewport.hover();
  await a.mouse.wheel(0, -300);
  await expect.poll(async () => Number(await viewport.getAttribute('data-zoom'))).toBeGreaterThan(1);
  await a.locator('.private-clue-image').getByRole('button', { name: '适应窗口', exact: true }).click();
  await expect(viewport).toHaveAttribute('data-zoom', '1');
  await a.keyboard.press('Escape');
  await expect(a.locator('.private-clue-image')).toHaveCount(0);
  await a.reload();
  await openClues(a);
  await expect(a.locator('.private-clue-row')).toContainText('私密高清图');
  // A separately owned real API process uses the same persisted database and upload directory.
  let recovery = await startRecoveryAPI();
  try {
    let r = await ac.request.get(recovery.url + '/api' + imageUrl);
    expect(r.ok()).toBe(true);
    const bytes = await r.body();
    await stopRecoveryAPI(recovery.child);
    recovery = await startRecoveryAPI();
    r = await ac.request.get(recovery.url + '/api' + imageUrl);
    expect(r.ok()).toBe(true);
    expect(await r.body()).toEqual(bytes);
    const inbox = await ac.request.get(recovery.url + '/api' + t.base + '/inbox');
    expect((await inbox.json()).items[0].readAt).not.toBeNull();
    expect((await bc.request.get(recovery.url + '/api' + imageUrl)).status()).toBe(404);
  } finally {
    await stopRecoveryAPI(recovery.child);
  }
  expect((await gmc.request.delete(api + `${t.base}/attachments/${attachment.id}`)).status()).toBe(409);
  const invalid = await gmc.request.post(api + t.base + '/attachments', {
    multipart: { file: { name: 'fake.png', mimeType: 'image/png', buffer: Buffer.from('not a picture') } },
  });
  expect(invalid.status()).toBe(400);
  // Files missing before send cause the whole transaction to roll back.
  const missing = await privateUpload(gmc, t.base),
    row = await t.db.clueAttachment.findUniqueOrThrow({ where: { id: missing.id } });
  const uploadRoot = resolve('apps/api', process.env.UPLOAD_DIR || 'uploads');
  await rm(resolve(uploadRoot, t.room.id, 'private-clues', row.storageName));
  const failed = await gmc.request.post(api + t.base + '/send', {
    data: {
      id: randomUUID(),
      title: '不应送出',
      attachmentIds: [missing.id],
      recipientUserIds: [t.users[1].id, t.users[3].id],
    },
  });
  expect(failed.status()).toBe(409);
  expect(await t.db.privateClue.count({ where: { roomId: t.room.id } })).toBe(1);
  await gm.screenshot({ path: 'test-results/private-clues-compose.png', animations: 'disabled' });
  await c.reload();
  await openClues(c);
  await expect(c.locator('.private-clue-row')).toHaveCount(0);
});

test('私密线索阶段 D/E：收藏未读持久化、受控分享、独立副本、撤回与回执', async ({ table: t }) => {
  test.setTimeout(120000);
  const [gm, a, b, c] = t.pages,
    [gmc, ac, bc, cc] = t.contexts;
  await Promise.all(t.pages.map((p) => p.goto(`/rooms/${t.room.id}`)));
  const attachment = await privateUpload(gmc, t.base),
    result = await post(gmc, t.base + '/send', {
      id: randomUUID(),
      title: '可以选择分享的秘密',
      bodyMarkdown: '私密原文',
      gmNote: '不可泄漏的 GM 备注',
      attachmentIds: [attachment.id],
      recipientUserIds: [t.users[1].id, t.users[3].id],
    });
  await openClues(a);
  await a.route('**/private-clues/deliveries/*', (route) =>
    route.request().method() === 'PATCH'
      ? route.fulfill({ status: 503, json: { error: '测试已读同步失败' } })
      : route.continue(),
  );
  await a.locator('.private-clue-row').click();
  const reader = a.locator('.private-clue-reader');
  await expect(reader.getByRole('alert')).toContainText('阅读状态未同步');
  expect((await get(ac, t.base + '/inbox')).unreadCount).toBe(1);
  await a.unroute('**/private-clues/deliveries/*');
  await reader.getByRole('button', { name: '重试', exact: true }).click();
  await expect.poll(async () => (await get(ac, t.base + '/inbox')).unreadCount).toBe(0);
  await reader.getByRole('button', { name: '收藏线索', exact: true }).click();
  await expect(reader.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await reader.getByRole('button', { name: '标记未读', exact: true }).click();
  await expect.poll(async () => (await get(ac, t.base + '/inbox')).unreadCount).toBe(1);
  const a2 = await ac.newPage();
  await a2.goto(`/rooms/${t.room.id}`);
  await openClues(a2);
  await expect(a2.locator('.private-clue-row')).toContainText('未读');
  await a.reload();
  await openClues(a);
  await a.locator('.clue-inbox').getByLabel('私人线索筛选').selectOption('saved');
  await expect(a.locator('.private-clue-row')).toHaveCount(1);
  await a.locator('.private-clue-row').click();
  await expect(reader.getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await expect(reader.getByRole('button', { name: '分享副本', exact: true })).toHaveCount(0);
  const deliveryA = (await get(ac, t.base + '/inbox')).items[0];
  expect(
    (
      await ac.request.post(api + t.base + `/deliveries/${deliveryA.id}/forward`, {
        data: { id: randomUUID(), recipientUserIds: [t.users[2].id] },
      })
    ).status(),
  ).toBe(403);
  await openClues(gm);
  await gm.locator('.private-clues').getByRole('tab', { name: 'GM 发件箱', exact: true }).click();
  await gm.locator('.clue-sent-box .private-clue-row').click();
  const receipts = gm.locator('.private-clue-reader');
  await expect(receipts.locator('.clue-receipts')).toContainText('2 名接收者，1 人已读');
  await receipts.getByRole('button', { name: '允许后续分享', exact: true }).click();
  await expect(reader.getByRole('button', { name: '分享副本', exact: true })).toBeVisible();
  await reader.getByRole('button', { name: '分享副本', exact: true }).click();
  await reader.getByLabel(t.users[2].username, { exact: false }).check();
  await reader.getByRole('button', { name: '确认向 1 人分享副本', exact: true }).click();
  await expect(reader.getByRole('status')).toContainText('分享副本已投递');
  await expect(b.getByLabel('1 条未读私密线索')).toBeVisible();
  await openClues(b);
  await b.locator('.private-clue-row').click();
  await expect(b.locator('.private-clue-reader')).toContainText('私密原文');
  await expect(b.locator('.private-clue-reader')).toContainText(t.users[1].username + ' 分享的副本');
  const deliveryB = (await get(bc, t.base + '/inbox')).items[0],
    detailB = await get(bc, t.base + '/deliveries/' + deliveryB.id);
  expect(detailB).not.toHaveProperty('gmNote');
  expect(detailB).not.toHaveProperty('deliveries');
  expect(JSON.stringify(detailB)).not.toContain(t.users[3].username);
  expect(detailB.attachments[0].id).toBe(attachment.id);
  expect((await bc.request.get(apiBase + attachment.originalUrl)).ok()).toBe(true);
  expect((await get(cc, t.base + '/inbox')).items[0].readAt).toBeNull();
  expect((await get(ac, t.base + '/inbox')).items).toHaveLength(1);
  await receipts.getByRole('button', { name: '关闭后续分享', exact: true }).click();
  await expect(b.locator('.private-clue-reader').getByRole('button', { name: '分享副本', exact: true })).toHaveCount(0);
  expect(
    (
      await bc.request.post(api + t.base + `/deliveries/${deliveryB.id}/forward`, {
        data: { id: randomUUID(), recipientUserIds: [t.users[3].id] },
      })
    ).status(),
  ).toBe(403);
  await reader.getByRole('button', { name: '取消收藏', exact: true }).click();
  await expect.poll(async () => (await get(ac, t.base + '/inbox')).items[0].savedAt).toBeNull();
  await b.locator('.private-clue-reader').getByRole('button', { name: '查看原图 古书残页.png', exact: true }).click();
  await expect(b.locator('.private-clue-image img')).toBeVisible();
  gm.once('dialog', (dialog) => dialog.accept());
  await receipts.getByRole('button', { name: '撤回线索及分享副本', exact: true }).click();
  await expect(reader).toContainText('该线索已撤回');
  await expect(b.locator('.private-clue-reader')).toContainText('该线索已撤回');
  await expect(b.locator('.private-clue-image')).toContainText('该图片已撤回');
  const revoked = await get(bc, t.base + '/deliveries/' + deliveryB.id);
  expect(revoked.bodyMarkdown).toBe('');
  expect(revoked.attachments).toEqual([]);
  expect((await bc.request.get(apiBase + attachment.originalUrl)).status()).toBe(404);
  expect((await get(cc, t.base + '/inbox')).unreadCount).toBe(0);
  await a.reload();
  await openClues(a);
  await expect(a.locator('.private-clue-row')).toContainText('已撤回');
  await b.emulateMedia({ reducedMotion: 'reduce' });
  expect(await b.locator('.private-clue-reader').evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
  await b.screenshot({ path: 'test-results/private-clues-revoked.png', animations: 'disabled' });
});

test('私密线索阶段 C/E：导演台素材复制、放映标签并存与旧数据无副作用', async ({ table: t }) => {
  test.setTimeout(120000);
  const [gm, a] = t.pages,
    [gmc, ac, bc] = t.contexts;
  const ca = await op(gmc, t.room.id, 'character.create', { name: '线索关联人物', ownerId: t.users[1].id });
  const tag = await op(gmc, t.room.id, 'tagDefinition.create', {
    name: '原有剧情标签',
    icon: 'clue',
    color: '#c69452',
    defaultVisibility: 'OWNER',
  });
  await op(gmc, t.room.id, 'characterTag.attach', {
    characterId: ca.id,
    tagDefinitionId: tag.id,
    definitionVersion: tag.version,
    detailsMarkdown: '既有独立备注',
  });
  const map = await op(gmc, t.room.id, 'map.create', { name: '原有地图' });
  await op(gmc, t.room.id, 'map.activate', { id: map.id });
  const upload = await gmc.request.post(api + `/rooms/${t.room.id}/presentation/assets`, {
    multipart: {
      title: '古堡公开画面',
      caption: '既有放映说明',
      file: { name: 'castle.png', mimeType: 'image/png', buffer: await picture() },
    },
  });
  expect(upload.status()).toBe(201);
  const asset = await upload.json();
  await post(gmc, `/rooms/${t.room.id}/presentation/commands`, {
    id: randomUUID(),
    version: 0,
    type: 'play',
    assetId: asset.id,
    allowHistory: true,
    requestedMode: 'floating',
    transition: 'none',
  });
  await Promise.all(t.pages.map((page) => page.goto(`/rooms/${t.room.id}`)));
  await expect(a.locator('.presentation-viewer')).toBeVisible();
  const before = await get(ac, `/rooms/${t.room.id}/snapshot`);
  await gm.locator('.game-rail button[title="导演台"]').click();
  await gm.locator('.presentation-asset').filter({ hasText: '古堡公开画面' }).click();
  await gm
    .locator('.presentation-director')
    .getByRole('button', { name: '发送为私密线索（选择接收人后发送）', exact: true })
    .click();
  const compose = gm.locator('.clue-compose');
  await expect(compose.getByLabel('线索标题', { exact: true })).toHaveValue('古堡公开画面');
  await expect(compose.locator('.clue-attachment')).toHaveCount(1);
  await expect(compose.locator('.clue-public-warning')).toContainText('此图片可能已经公开');
  await compose.getByLabel(t.users[1].username, { exact: false }).check();
  await compose.getByRole('button', { name: '私密发送给 1 人', exact: true }).click();
  await expect(compose.getByRole('status')).toContainText('已私密发送');
  await expect(a.locator('.presentation-viewer')).toBeVisible();
  expect((await get(ac, `/rooms/${t.room.id}/presentation/current`)).asset.id).toBe(asset.id);
  await openClues(a);
  await a.locator('.private-clue-row').click();
  await expect(a.locator('.private-clue-reader')).toContainText('既有放映说明');
  await expect(a.locator('.presentation-viewer')).toBeVisible();
  const inbox = await get(ac, t.base + '/inbox'),
    copy = inbox.items[0].attachments[0];
  expect((await bc.request.get(apiBase + copy.originalUrl)).status()).toBe(404);
  const remove = await gmc.request.delete(api + `/rooms/${t.room.id}/presentation/assets/${asset.id}`, {
    data: { confirm: true },
  });
  expect(remove.ok(), await remove.text()).toBe(true);
  expect((await ac.request.get(apiBase + copy.originalUrl)).ok()).toBe(true);
  const after = await get(ac, `/rooms/${t.room.id}/snapshot`);
  for (const key of ['characters', 'characterTags', 'tagDefinitions', 'combatEvents', 'encounter', 'maps', 'tokens'])
    expect(after[key]).toEqual(before[key]);
  await closeWindow(gm, '关闭私密线索');
  await closeWindow(gm, '关闭剧情导演台');
  await openClues(gm);
  await gm.locator('.private-clues').getByRole('tab', { name: 'GM 发件箱', exact: true }).click();
  await gm.locator('.clue-sent-box .private-clue-row').click();
  await gm.locator('.private-clue-reader').getByRole('button', { name: '再次投递给其他成员', exact: true }).click();
  await expect(compose.getByLabel('线索标题', { exact: true })).toHaveValue('古堡公开画面');
  await expect(compose.getByLabel('线索正文', { exact: true })).toHaveValue('既有放映说明');
  await expect(compose.locator('.clue-attachment')).toHaveCount(1);
  await expect(compose.getByLabel(t.users[1].username, { exact: false })).not.toBeChecked();
  // Close the foreground composer before closing the receipt, then restore its saved draft.
  await closeWindow(gm, '关闭私密线索');
  await expect(compose).toHaveCount(0);
  await closeWindow(gm, '关闭线索投递回执');
  await openClues(gm);
  await compose.getByLabel(t.users[2].username, { exact: false }).check();
  await compose.getByRole('button', { name: '私密发送给 1 人', exact: true }).click();
  await expect(compose.getByRole('status')).toContainText('已私密发送');
  expect((await get(ac, t.base + '/inbox')).items).toHaveLength(1);
  expect((await get(bc, t.base + '/inbox')).items).toHaveLength(1);
  await op(gmc, t.room.id, 'character.delete', { id: ca.id });
  expect((await get(ac, t.base + '/inbox')).items).toHaveLength(1);
  expect((await get(ac, t.base + '/deliveries/' + inbox.items[0].id)).bodyMarkdown).toBe('既有放映说明');
  await a.setViewportSize({ width: 900, height: 800 });
  await a.reload();
  await openClues(a);
  const box = (await a.locator('.window').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(900);
  await expect(a.getByRole('button', { name: /^最小化/ })).toHaveCount(0);
  await a.locator('.window-title').getByRole('button', { name: '关闭私密线索', exact: true }).click();
  await expect(a.locator('.private-clues')).toHaveCount(0);
  await a.locator('.game-rail button[title="私密线索"]').click();
  await expect(a.locator('.private-clues')).toBeVisible();
  await a.screenshot({ path: 'test-results/private-clues-narrow-desktop.png', animations: 'disabled' });
});

test('私密线索恢复：通知丢失与旧列表迟到不能覆盖新未读状态', async ({ table: t }) => {
  test.setTimeout(90000);
  const a = t.pages[1],
    gmc = t.contexts[0];
  let upgraded = false;
  a.on('websocket', (ws) =>
    ws.on('framesent', (frame) => {
      if (String(frame.payload) === '5') upgraded = true;
    }),
  );
  await a.addInitScript(() => {
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        this.addEventListener('message', (event) => {
          if (typeof event.data === 'string' && event.data.includes('privateClue.changed'))
            event.stopImmediatePropagation();
        });
      }
    };
  });
  await a.clock.install();
  const firstInbox = a.waitForResponse((r) => r.url().endsWith('/private-clues/inbox') && r.ok());
  await a.goto(`/rooms/${t.room.id}`);
  await firstInbox;
  await expect.poll(() => upgraded).toBe(true);
  await openClues(a);
  await post(gmc, t.base + '/send', {
    id: randomUUID(),
    title: '通知丢失后的第一条',
    bodyMarkdown: '正文一',
    recipientUserIds: [t.users[1].id],
  });
  await expect(a.locator('.private-clue-row')).toHaveCount(0);
  await a.clock.fastForward(31000);
  await expect(a.locator('.private-clue-row')).toHaveCount(1);
  await expect(a.getByLabel('1 条未读私密线索')).toBeVisible();
  let release!: () => void, intercepted!: () => void;
  const held = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      intercepted = resolve;
    });
  let first = true;
  await a.route('**/private-clues/inbox', async (route) => {
    if (!first) {
      await route.continue();
      return;
    }
    first = false;
    const response = await route.fetch();
    intercepted();
    await held;
    try {
      await route.fulfill({ response });
    } catch {
      /* The newer refresh may already have canceled this request. */
    }
  });
  try {
    await a.getByRole('button', { name: '刷新收件箱', exact: true }).click();
    await ready;
    await post(gmc, t.base + '/send', {
      id: randomUUID(),
      title: '第二条最新线索',
      bodyMarkdown: '正文二',
      recipientUserIds: [t.users[1].id],
    });
    await a.clock.fastForward(31000);
    await expect(a.locator('.private-clue-row')).toHaveCount(2);
    await expect(a.getByLabel('2 条未读私密线索')).toBeVisible();
    release();
    await a.clock.fastForward(1000);
    await expect(a.locator('.private-clue-row').first()).toContainText('第二条最新线索');
    await expect(a.locator('.private-clue-row')).toHaveCount(2);
  } finally {
    release();
    await a.unroute('**/private-clues/inbox');
  }
});

test('私密线索动效：单次拆封、连续投递、正文稳定、焦点与减少动效', async ({ table: t }, info) => {
  test.setTimeout(120000);
  const [gm, a, b, c] = t.pages,
    [gmc, ac, bc, cc] = t.contexts;
  const errors: string[] = [];
  for (const page of t.pages) page.on('pageerror', (error) => errors.push(error.message));
  await b.setViewportSize({ width: 900, height: 700 });
  await b.emulateMedia({ reducedMotion: 'reduce' });
  await Promise.all(t.pages.map((page) => page.goto(`/rooms/${t.room.id}`)));
  for (const page of t.pages) await expect(page.getByTitle('已连接', { exact: true })).toBeVisible();
  await openClues(a);
  const search = a.getByLabel('搜索私人线索', { exact: true });
  await search.fill('未完成的检索');
  await a.evaluate(() => {
    (window as any).__sealStarts = 0;
    document.addEventListener('animationstart', (event) => {
      if ((event.target as Element).matches('.clue-envelope-flap')) (window as any).__sealStarts++;
    });
  });
  const input = {
    id: randomUUID(),
    title: '封蜡信件',
    bodyMarkdown: '沿着月光找到旧塔，保留这封信。'.repeat(150),
    recipientUserIds: [t.users[1].id, t.users[2].id],
  };
  await post(gmc, t.base + '/send', input);
  const notice = a.locator('.private-clue-notice'),
    mark = notice.locator('.clue-notice-envelope');
  await expect(notice).toBeVisible();
  await expect(mark).toHaveAttribute('aria-hidden', 'true');
  await expect(search).toBeFocused();
  await expect(search).toHaveValue('未完成的检索');
  await expect(a.locator('.private-clue-reader')).toHaveCount(0);
  await expect(a.getByLabel('1 条未读私密线索', { exact: true })).toBeVisible();
  const firstNoticeId = await notice.getAttribute('data-notice-id');
  await expect.poll(() => a.evaluate(() => (window as any).__sealStarts)).toBe(1);
  expect((await get(ac, t.base + '/inbox')).items[0].readAt).toBeNull();
  expect((await get(bc, t.base + '/inbox')).items[0].readAt).toBeNull();
  await expect(b.locator('.private-clue-notice')).toBeVisible();
  const reducedNoticeBox = (await b.locator('.private-clue-notice').boundingBox())!;
  expect(reducedNoticeBox.x + reducedNoticeBox.width).toBeLessThanOrEqual(900);
  expect(await b.locator('.clue-envelope-flap').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  await expect(c.locator('.private-clue-notice')).toHaveCount(0);
  expect((await get(cc, t.base + '/inbox')).items).toHaveLength(0);
  await a.screenshot({ path: info.outputPath('sealed-clue-notice.png') });
  // A duplicate operation and ordinary refresh preserve the same decorative DOM and do not replay it.
  await mark.evaluate((node) => ((window as any).__noticeMark = node));
  await post(gmc, t.base + '/send', input);
  await a.getByRole('button', { name: '刷新收件箱', exact: true }).click();
  await expect(notice).toHaveAttribute('data-notice-id', firstNoticeId!);
  expect(await mark.evaluate((node) => node === (window as any).__noticeMark)).toBe(true);
  expect(await a.evaluate(() => (window as any).__sealStarts)).toBe(1);
  await search.fill('');
  await notice.getByRole('button', { name: '关闭私密线索通知' }).click();
  await a.locator('.private-clue-row').filter({ hasText: input.title }).click();
  const reader = a.locator('.private-clue-reader'),
    body = reader.locator('.clue-reading-body');
  await expect(body).toContainText('沿着月光找到旧塔');
  await expect.poll(async () => (await get(ac, t.base + '/inbox')).unreadCount).toBe(0);
  expect(await reader.evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
  await expect
    .poll(() =>
      reader.evaluate(
        (node) =>
          node
            .closest('.window')!
            .getAnimations()
            .filter((a) => a.playState === 'running').length,
      ),
    )
    .toBe(0);
  const before = await body.evaluate((node) => {
    (window as any).__readingBody = node;
    const scroller = node.closest('.window-body')!;
    scroller.scrollTop = 90;
    const text = node.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 8);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return { scrollTop: scroller.scrollTop, selection: selection.toString(), top: node.getBoundingClientRect().top };
  });
  // An equal-sized new delivery batch should open once even while a previous notice still exists.
  await post(gmc, t.base + '/send', { ...input, id: randomUUID(), title: '第二封密信' });
  await expect(notice).toBeVisible();
  await expect(notice).not.toHaveAttribute('data-notice-id', firstNoticeId!);
  await expect.poll(() => a.evaluate(() => (window as any).__sealStarts)).toBe(2);
  const secondNoticeId = await notice.getAttribute('data-notice-id');
  await post(gmc, t.base + '/send', { ...input, id: randomUUID(), title: '第三封密信' });
  await expect(notice).not.toHaveAttribute('data-notice-id', secondNoticeId!);
  await expect.poll(() => a.evaluate(() => (window as any).__sealStarts)).toBe(3);
  await expect(a.getByLabel('2 条未读私密线索', { exact: true })).toBeVisible();
  const after = await body.evaluate((node) => ({
    same: node === (window as any).__readingBody,
    scrollTop: node.closest('.window-body')!.scrollTop,
    selection: window.getSelection()!.toString(),
    top: node.getBoundingClientRect().top,
    animation: getComputedStyle(node).animationName,
    transform: getComputedStyle(node).transform,
  }));
  expect(after).toMatchObject({
    same: true,
    scrollTop: before.scrollTop,
    selection: before.selection,
    animation: 'none',
    transform: 'none',
  });
  expect(after.top).toBeCloseTo(before.top, 1);
  expect((await get(bc, t.base + '/inbox')).unreadCount).toBe(3);
  await a.screenshot({ path: info.outputPath('reading-stays-still.png') });
  await expect(notice).toHaveCount(0, { timeout: 8000 });
  await expect(a.getByLabel('2 条未读私密线索', { exact: true })).toBeVisible();
  await a.reload();
  await expect(a.getByTitle('已连接', { exact: true })).toBeVisible();
  await expect(a.locator('.private-clue-notice')).toHaveCount(0);
  await expect(a.getByLabel('2 条未读私密线索', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
