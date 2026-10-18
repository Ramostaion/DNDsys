import { test, expect, type BrowserContext, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { api } from './server-address';

config({ path: 'apps/api/.env' });
test('第一批 UI：资源变化、浮窗草稿和退场、确认反馈、拖放预览与失败恢复', async ({ browser }, info) => {
  test.setTimeout(150_000);
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1900, height: 1100 } }),
    browser.newContext({ viewport: { width: 1600, height: 1050 } }),
  ]);
  const db = new PrismaClient(),
    prefix = `ui-${randomUUID().slice(0, 8)}`,
    users: { id: string; username: string }[] = [];
  let roomId: string | undefined;
  const post = async (context: BrowserContext, path: string, data: unknown) => {
    const response = await context.request.post(api + path, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const snap = async () => (await contexts[0].request.get(`${api}/rooms/${roomId}/snapshot`)).json();
  const op = (type: string, payload: Record<string, unknown>) =>
    post(contexts[0], `/rooms/${roomId}/operations`, { id: randomUUID(), type, payload });
  try {
    for (const [index, context] of contexts.entries())
      users.push(await post(context, '/auth/register', { username: `${prefix}-${index}`, password: randomUUID() }));
    const room = await post(contexts[0], '/rooms', { name: prefix });
    roomId = room.id;
    await post(contexts[1], '/rooms/join', { inviteCode: room.inviteCode });
    for (const field of [
      { fieldId: 'maxhp', name: '生命上限', type: 'number', defaultValue: 40 },
      {
        fieldId: 'hp',
        name: '生命',
        type: 'number',
        defaultValue: 40,
        isResource: true,
        resourceKind: 'health',
        maxFieldId: 'maxhp',
      },
    ])
      await op('sheet.field.upsert', { version: (await snap()).room.version, field });
    const hero = await op('character.create', { name: '反馈角色', ownerId: users[1].id });
    const sword = await op('item.create', { name: '反馈长剑', kind: '装备', compatibleSlots: ['主手'] });
    await op('inventory.add', { characterId: hero.id, itemId: sword.id, quantity: 1, position: 0 });
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const [gm, player] = pages,
      errors: string[] = [];
    for (const page of pages) {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`/rooms/${roomId}`);
      await expect(page.locator('[title="已连接"]')).toBeVisible();
      await page.locator('.game-rail button[title="角色"]').click();
      await page.getByRole('button', { name: '反馈角色', exact: true }).click();
      await expect(page.locator('.character-sheet')).toBeVisible();
      await expect(page.locator('[data-field-id="hp"] .resource-delta')).toBeEmpty();
    }
    // Complete a baseline snapshot on both live sessions before changing a resource.
    await post(contexts[0], `/rooms/${roomId}/members/me/profile`, { displayName: '反馈主持人' });
    await Promise.all(pages.map((page) => expect(page.locator('.party-list')).toContainText('反馈主持人')));
    await op('character.field.adjust', {
      characterId: hero.id,
      fieldId: 'hp',
      delta: -8,
      version: (await snap()).characters[0].version,
    });
    for (const page of pages) await expect(page.locator('[data-field-id="hp"] .resource-delta')).toHaveText('−8');
    await player.locator('.character-sheet').screenshot({ path: info.outputPath('resource-change.png') });
    await op('character.field.set', {
      characterId: hero.id,
      fieldId: 'maxhp',
      value: 60,
      version: (await snap()).characters[0].version,
    });
    await expect(player.locator('[data-field-id="hp"] .resource-delta')).toBeEmpty();
    await expect(player.locator('[data-field-id="hp"] [role="progressbar"]')).toHaveAttribute('aria-valuetext', '32');
    await player.reload();
    await player.locator('.game-rail button[title="角色"]').click();
    await player.getByRole('button', { name: '反馈角色', exact: true }).click();
    await expect(player.locator('[data-field-id="hp"] .resource-delta')).toBeEmpty();
    await player.evaluate(() => window.dispatchEvent(new Event('offline')));
    await expect(player.locator('[title="正在重连"]')).toBeVisible();
    await op('character.field.adjust', {
      characterId: hero.id,
      fieldId: 'hp',
      delta: -3,
      version: (await snap()).characters[0].version,
    });
    await player.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(player.locator('[data-field-id="hp"] strong.text-amber-300')).toHaveText('29');
    await expect(player.locator('[data-field-id="hp"] .resource-delta')).toBeEmpty();

    await gm.locator('.game-rail button[title="设置"]').click();
    const settings = gm.locator('.window').filter({ has: gm.getByRole('form', { name: '我的房间内名称' }) });
    const input = settings.getByLabel('房间内名称', { exact: true });
    await input.fill('未保存的名称');
    await expect(settings.getByRole('button', { name: /^最小化/ })).toHaveCount(0);
    await settings.getByRole('button', { name: '关闭房间设置', exact: true }).click();
    await expect(settings).toHaveCount(0);
    await gm.locator('.game-rail button[title="设置"]').click();
    await expect(input).toHaveValue('反馈主持人');
    await input.fill('未保存的名称');
    await expect(settings).toHaveClass(/is-active/);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await gm.route('**/members/me/profile', async (route) => {
      await gate;
      await route.continue();
    });
    await settings.getByRole('button', { name: '保存房间内名称', exact: true }).click();
    await expect(settings.locator('.action-feedback')).toHaveClass(/is-pending/);
    release();
    await expect(settings.locator('.action-feedback')).toHaveClass(/is-success/);
    await gm.unroute('**/members/me/profile');
    await settings.getByRole('button', { name: '关闭房间设置', exact: true }).click();
    await expect(settings).toHaveCount(0);
    const sheetWindow = gm.locator('.window').filter({ has: gm.locator('.character-sheet') });
    await sheetWindow.locator('.window-title').click({ position: { x: 100, y: 12 } });
    await expect(sheetWindow).toHaveClass(/is-active/);
    await sheetWindow.getByRole('button', { name: '背包', exact: true }).click();
    const inventory = gm.locator('.window').filter({ has: gm.locator('.inventory-panel') });
    await inventory.getByRole('button', { name: '查看装备', exact: true }).click();
    const equipment = gm.locator('.window').filter({ has: gm.locator('.equipment-panel') });
    async function moveWindow(window: Locator, x: number, y: number) {
      const box = (await window.locator('.window-title').boundingBox())!;
      await gm.mouse.move(box.x + 100, box.y + 15);
      await gm.mouse.down();
      await gm.mouse.move(x + 100, y + 15, { steps: 8 });
      await gm.mouse.up();
    }
    await moveWindow(equipment, 1000, 150);
    await moveWindow(inventory, 120, 150);
    const source = inventory.getByRole('button', { name: '背包格 1：反馈长剑', exact: true }),
      empty = inventory.getByRole('button', { name: '背包格 3：空', exact: true });
    async function dragTo(target: Locator) {
      const a = (await source.boundingBox())!,
        b = (await target.boundingBox())!;
      await gm.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await gm.mouse.down();
      await gm.mouse.move(a.x + a.width / 2 + 15, a.y + a.height / 2, { steps: 4 });
      await gm.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 15 });
      await gm.mouse.move(b.x + b.width / 2 + 1, b.y + b.height / 2 + 1);
    }
    const head = equipment.locator('[aria-label="装备部位 头部"]');
    await dragTo(head);
    await gm.screenshot({ path: info.outputPath('drop-preview.png') });
    await expect(head).toHaveClass(/is-drop-blocked/);
    await expect(head.locator('.drop-hint')).toHaveText('部位不兼容');
    await gm.mouse.up();
    await gm.route('**/operations', async (route) => {
      if (route.request().postDataJSON()?.type === 'inventory.move')
        await route.fulfill({ status: 503, json: { error: '测试整理失败' } });
      else await route.continue();
    });
    await dragTo(empty);
    await expect(empty).toHaveClass(/is-drop-target/);
    await gm.mouse.up();
    await expect(inventory.locator('.action-feedback')).toContainText('测试整理失败');
    await expect(empty).not.toHaveClass(/is-drop-landed/);
    expect((await snap()).characters[0].inventory[0].position).toBe(0);
    await gm.unroute('**/operations');
    await source.dragTo(empty);
    await expect(inventory.getByRole('button', { name: '背包格 3：反馈长剑', exact: true })).toBeVisible();
    await expect(inventory.locator('[role="alert"]')).toHaveCount(0);
    const moved = inventory.getByRole('button', { name: '背包格 3：反馈长剑', exact: true });
    await moved.dragTo(equipment.locator('[aria-label="装备部位 主手"]'));
    await expect(equipment.locator('[aria-label="装备物品 主手：反馈长剑"]')).toBeVisible();
    await expect(equipment.locator('.action-feedback')).toHaveClass(/is-success/);
    await expect(equipment).toHaveClass(/is-active/);
    await gm.screenshot({ path: info.outputPath('windows-and-equipment.png') });
    await gm.emulateMedia({ reducedMotion: 'reduce' });
    expect(await equipment.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
    await equipment.getByRole('button', { name: '关闭装备', exact: true }).click();
    await expect(equipment).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    if (roomId) await db.room.deleteMany({ where: { id: roomId, name: prefix } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
