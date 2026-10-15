import { test, expect, chromium, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { createApplication } from '../src/app';
import { readConfig } from '../src/config';

config({ path: 'apps/api/.env' });
test('普通 HTTP 下窗口、人物拖动、物品编辑、背包整理和属性修改可同步并持久保存', async () => {
  test.setTimeout(180_000);
  const address = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address;
  expect(address, '需要本机可访问的非回环 IPv4 来验证真实不安全 HTTP 环境').toBeTruthy();
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '0.0.0.0', done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const origin = `http://${address}:${port}`;
  const db = new PrismaClient();
  const application = createApplication(db, { ...readConfig(), origin, secureCookie: false });
  const users: { id: string; username: string; password: string }[] = [];
  const prefix = `e2e-http-${randomUUID().slice(0, 8)}`;
  let roomId: string | undefined;
  let web: { listen(): Promise<unknown>; close(): Promise<unknown> } | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await new Promise<void>((done) => application.server.listen(0, '127.0.0.1', done));
    const api = `http://127.0.0.1:${(application.server.address() as { port: number }).port}`;
    const webRequire = createRequire(resolve('apps/web/package.json'));
    const { createServer: createViteServer } = await import(pathToFileURL(webRequire.resolve('vite')).href);
    web = await createViteServer({
      root: resolve('apps/web'),
      server: {
        host: '0.0.0.0',
        port,
        strictPort: true,
        proxy: { '/api': api, '/uploads': api, '/socket.io': { target: api, ws: true } },
      },
    });
    await web!.listen();
    browser = await chromium.launch({
      channel: process.platform === 'win32' ? 'msedge' : undefined,
      headless: true,
      args: ['--no-proxy-server'],
    });
    const contexts = await Promise.all([
      browser.newContext({ viewport: { width: 1600, height: 1000 } }),
      browser.newContext({ viewport: { width: 1600, height: 1000 } }),
    ]);
    const pages: Page[] = [];
    const errors: string[] = [];
    for (let index = 0; index < 2; index++) {
      const credentials = { username: `${prefix}-${index}`, password: randomUUID() };
      const response = await fetch(api + '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      });
      users.push({ ...(await response.json()), ...credentials });
      expect(response.ok).toBe(true);
      const page = await contexts[index].newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(origin + '/login');
      expect(
        await page.evaluate(() => ({
          secure: window.isSecureContext,
          uuid: typeof crypto.randomUUID,
          random: typeof crypto.getRandomValues,
        })),
      ).toEqual({ secure: false, uuid: 'undefined', random: 'function' });
      await page.getByRole('textbox', { name: '冒险者名称' }).fill(credentials.username);
      await page.getByRole('textbox', { name: '密码' }).fill(credentials.password);
      await page.getByRole('button', { name: '进入冒险' }).click();
      await expect(page).toHaveURL(origin + '/rooms');
      pages.push(page);
    }
    async function post(page: Page, path: string, data: unknown) {
      return page.evaluate(
        async ({ path, data }) => {
          const response = await fetch('/api' + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(JSON.stringify(result));
          return result;
        },
        { path, data },
      );
    }
    const room = await post(pages[0], '/rooms', { name: `HTTP UUID ${prefix}` });
    roomId = room.id;
    await post(pages[1], '/rooms/join', { inviteCode: room.inviteCode });
    async function operation(type: string, payload: Record<string, unknown>) {
      return pages[0].evaluate(
        async ({ roomId, type, payload }) => {
          const api = await import('/src/api.ts');
          return api.op(roomId!, type, payload);
        },
        { roomId, type, payload },
      );
    }
    const character = await operation('character.create', { name: 'HTTP 人物', ownerId: users[1].id });
    const map = await operation('map.create', { name: 'HTTP 地图', width: 1400, height: 900 });
    await operation('map.activate', { id: map.id });
    const token = await operation('token.create', { mapId: map.id, characterId: character.id, x: 650, y: 420 });
    for (const page of pages) {
      await page.goto(`${origin}/rooms/${roomId}`);
      await expect(page.locator('.game-rail')).toBeVisible();
      await page.locator('.game-rail').getByRole('button', { name: '角色', exact: true }).click();
      await expect(page.getByRole('button', { name: '关闭角色', exact: true })).toBeVisible();
      await page.locator('.game-rail').getByRole('button', { name: '角色', exact: true }).click();
      await expect(page.getByRole('button', { name: '关闭角色', exact: true })).toHaveCount(0);
    }
    await expect
      .poll(() => pages[0].evaluate((id) => Boolean((window as any).Konva?.stages[0]?.findOne('#' + id)), token.id))
      .toBe(true);
    const point = await pages[0].evaluate((id) => {
      const stage = (window as any).Konva.stages[0];
      const point = stage.findOne('#' + id).getAbsolutePosition();
      const rect = stage.container().getBoundingClientRect();
      return { x: point.x + rect.left, y: point.y + rect.top };
    }, token.id);
    await pages[0].mouse.move(point.x, point.y);
    await pages[0].mouse.down();
    await pages[0].mouse.move(point.x + 60, point.y + 30, { steps: 8 });
    await pages[0].mouse.up();
    await expect.poll(async () => (await db.mapToken.findUniqueOrThrow({ where: { id: token.id } })).version).toBe(1);
    const moved = await db.mapToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(moved.x).not.toBe(token.x);
    async function tokenX(page: Page) {
      return page.evaluate((id) => (window as any).Konva?.stages[0]?.findOne('#' + id)?.x(), token.id);
    }
    await expect.poll(() => tokenX(pages[1])).toBe(moved.x);
    await pages[0].reload();
    await expect.poll(() => tokenX(pages[0])).toBe(moved.x);

    const [gm, player] = pages;
    async function closeWindow(page: Page, label: string) {
      const close = page.getByRole('button', { name: label, exact: true });
      await page
        .locator('.window')
        .filter({ has: close })
        .locator('.window-title')
        .click({ position: { x: 20, y: 20 } });
      await close.click();
    }
    async function openCharacter(page: Page) {
      await page.locator('.game-rail').getByRole('button', { name: '角色', exact: true }).click();
      await page.getByRole('button', { name: 'HTTP 人物', exact: true }).click();
      await closeWindow(page, '关闭角色');
      await expect(page.locator('.character-sheet')).toBeVisible();
    }
    const savedRoom = await db.room.findUniqueOrThrow({ where: { id: roomId } });
    await operation('sheet.field.upsert', {
      version: savedRoom.version,
      field: { fieldId: 'magic', name: '法伤', type: 'number', defaultValue: 23 },
    });
    await gm.locator('.game-rail').getByRole('button', { name: '物品', exact: true }).click();
    const library = gm.locator('.item-library');
    await library.getByLabel('物品名称', { exact: true }).fill('HTTP 法师戒指');
    await library.locator('form select').selectOption('饰品');
    await library.getByLabel('物品名称', { exact: true }).press('Enter');
    const editor = gm.locator('.item-editor');
    await editor.getByLabel('描述', { exact: true }).fill('HTTP 编辑的测试装备');
    await editor.getByRole('button', { name: '添加项目', exact: true }).click();
    await editor.getByLabel('项目名称 1', { exact: true }).fill('法伤');
    await editor.getByLabel('项目类型 1', { exact: true }).selectOption('number');
    await editor.getByLabel('项目内容 1', { exact: true }).fill('5');
    await editor.getByLabel('备注', { exact: true }).fill('HTTP 下修改并保存');
    await editor.getByRole('button', { name: '保存物品卡', exact: true }).click();
    const getItem = () => db.itemDefinition.findFirstOrThrow({ where: { roomId, name: 'HTTP 法师戒指' } });
    await expect
      .poll(async () => (await getItem()).data)
      .toEqual({ customFields: [{ name: '法伤', value: 5 }], notes: 'HTTP 下修改并保存' });
    const item = await getItem();
    expect(item.description).toBe('HTTP 编辑的测试装备');
    await closeWindow(gm, '关闭物品卡');
    await closeWindow(gm, '关闭物品库');
    // Only fixture placement uses the API; all editing, sorting and wearing below use UI actions.
    await operation('inventory.add', { characterId: character.id, itemId: item.id, position: 0 });
    await openCharacter(player);
    await expect(player.getByLabel('法伤原始值')).toHaveCount(0);
    const playerValue = player
      .locator('.character-sheet .grid-card')
      .filter({ has: player.getByText('法伤', { exact: true }) })
      .locator('strong.text-amber-300');
    await expect(playerValue).toHaveText('23');
    await player.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true }).click();
    await closeWindow(player, '关闭人物卡');
    const backpack = player.locator('.inventory-panel');
    await backpack
      .getByRole('button', { name: '背包格 1：HTTP 法师戒指', exact: true })
      .dragTo(backpack.getByRole('button', { name: '背包格 24：空', exact: true }));
    await expect(backpack.getByRole('button', { name: '背包格 24：HTTP 法师戒指', exact: true })).toBeVisible();
    await closeWindow(player, '关闭背包');
    await openCharacter(player);
    await openCharacter(gm);
    await gm.locator('.sheet-actions').getByRole('button', { name: '装备', exact: true }).click();
    await closeWindow(gm, '关闭人物卡');
    const entry = await db.inventoryEntry.findFirstOrThrow({ where: { characterId: character.id, itemId: item.id } });
    expect(entry.position).toBe(23);
    const equip = gm.locator('.equip-grid');
    await equip.getByLabel('饰品1装备', { exact: true }).selectOption(entry.id);
    await expect(playerValue).toHaveText('28');
    expect((await db.inventoryEntry.findUniqueOrThrow({ where: { id: entry.id } })).position).toBeLessThan(0);
    await closeWindow(gm, '关闭装备');
    await gm.locator('.game-rail').getByRole('button', { name: '设置', exact: true }).click();
    await gm.getByLabel(`${users[1].username} · 编辑普通人物数值`, { exact: true }).selectOption('allow');
    await expect(player.getByLabel('法伤原始值')).toBeVisible();
    await player.getByLabel('法伤原始值').fill('31');
    await player
      .locator('.grid-card')
      .filter({ has: player.getByLabel('法伤原始值') })
      .getByRole('button', { name: '设定', exact: true })
      .click();
    await expect(playerValue).toHaveText('36');
    await closeWindow(gm, '关闭房间设置');
    await openCharacter(gm);
    const gmValue = gm
      .locator('.character-sheet .grid-card')
      .filter({ has: gm.getByText('法伤', { exact: true }) })
      .locator('strong.text-amber-300');
    await expect(gmValue).toHaveText('36');
    await gm.locator('.sheet-actions').getByRole('button', { name: '装备', exact: true }).click();
    await closeWindow(gm, '关闭人物卡');
    await equip.getByLabel('饰品1装备', { exact: true }).selectOption('');
    await expect(playerValue).toHaveText('31');
    await player.reload();
    await openCharacter(player);
    await expect(playerValue).toHaveText('31');
    await player.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true }).click();
    await closeWindow(player, '关闭人物卡');
    await expect(backpack.locator('.inventory-slot.filled')).toHaveCount(1);
    const persisted = await db.inventoryEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(persisted.position).toBeGreaterThanOrEqual(0);
    expect(persisted.quantity).toBe(1);
    expect((await getItem()).data).toEqual(item.data);
    expect((await db.character.findUniqueOrThrow({ where: { id: character.id } })).fieldValues).toMatchObject({
      magic: 31,
    });
    const receipts = await db.operationReceipt.findMany({ where: { roomId }, select: { id: true } });
    expect(receipts.length).toBeGreaterThanOrEqual(13);
    for (const receipt of receipts)
      expect(receipt.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await web?.close();
    await new Promise<void>((done) => application.io.close(() => done()));
    if (roomId) await db.room.delete({ where: { id: roomId } });
    await db.user.deleteMany({ where: { username: { startsWith: prefix + '-' } } });
    await db.$disconnect();
  }
});
