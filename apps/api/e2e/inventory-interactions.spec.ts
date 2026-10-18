import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { api } from './server-address';

config({ path: 'apps/api/.env' });
async function moveWindow(page: Page, panel: Locator, x: number, y: number) {
  const box = (await panel.locator('.window-title').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 18);
  await page.mouse.down();
  await page.mouse.move(x + 100, y + 18, { steps: 8 });
  await page.mouse.up();
}
test('玩家背包交互：真实卸装拖放、默认本角色、只读悬停、右键交易删除及状态竞态', async ({ browser }, info) => {
  test.setTimeout(180000);
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ viewport: { width: 1700, height: 1100 } })),
  );
  const db = new PrismaClient(),
    prefix = `bag-ui-${randomUUID().slice(0, 8)}`,
    users: any[] = [];
  let roomId: string | undefined;
  const post = async (context: BrowserContext, path: string, data: unknown, status = 200) => {
    const r = await context.request.post(api + path, { data });
    expect(r.status(), await r.text()).toBe(status);
    return r.json();
  };
  const op = (type: string, payload: any, status = 200, context = contexts[0]) =>
    post(context, `/rooms/${roomId}/operations`, { id: randomUUID(), type, payload }, status);
  const snap = async () => (await contexts[0].request.get(`${api}/rooms/${roomId}/snapshot`)).json();
  try {
    for (const [i, c] of contexts.entries())
      users.push(await post(c, '/auth/register', { username: `${prefix}-${i}`, password: randomUUID() }));
    const room = await post(contexts[0], '/rooms', { name: prefix }, 201);
    roomId = room.id;
    for (const c of contexts.slice(1)) await post(c, '/rooms/join', { inviteCode: room.inviteCode });
    const recipient = await op('character.create', { name: '接收者', ownerId: users[2].id });
    const hero = await op('character.create', { name: '行囊旅人', ownerId: users[1].id });
    await op('character.create', { name: '同行分身', ownerId: users[1].id });
    const saved = async (id = hero.id) => (await snap()).characters.find((c: any) => c.id === id);
    const staff = await op('item.create', {
      name: '双手旅行杖',
      kind: '双手武器',
      imageUrl: '/dnd-d20.svg',
      description: '刻着旅途符文的法杖',
      data: {
        customFields: [
          { name: '重量', value: 2 },
          { name: '铭文', value: '归途' },
        ],
        notes: '需要双手持握',
      },
    });
    const weapon = await op('inventory.add', { characterId: hero.id, itemId: staff.id });
    await op('equipment.set', { characterId: hero.id, slot: '主手', entryId: weapon.id });
    const potion = await op('item.create', {
      name: '旅行药剂',
      kind: '道具',
      description: '清新的草木气味',
      data: { customFields: [{ name: '恢复', value: 5 }], notes: '玻璃瓶身' },
    });
    const bottle = await op('inventory.add', { characterId: hero.id, itemId: potion.id, quantity: 3 });
    const [a, b] = await Promise.all(contexts.slice(1).map((c) => c.newPage()));
    const errors: string[] = [];
    for (const page of [a, b]) {
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`/rooms/${roomId}`);
      await expect(page.getByTitle('已连接', { exact: true })).toBeVisible();
      await page.locator('.game-rail button[title="背包"]').click();
    }
    const inventory = a.locator('.window').filter({ has: a.locator('.inventory-panel') });
    await inventory.getByRole('button', { name: '查看装备', exact: true }).click();
    const equipment = a.locator('.window').filter({ has: a.locator('.equipment-panel') });
    await moveWindow(a, equipment, 980, 100);
    await moveWindow(a, inventory, 100, 100);
    const main = equipment.getByLabel('装备部位 主手', { exact: true });
    await expect(main.getByLabel('转移目标角色', { exact: true })).toHaveValue(hero.id);
    await expect(main.getByLabel('转移目标位置', { exact: true })).toHaveValue('');
    await main
      .getByLabel('装备物品 主手：双手旅行杖', { exact: true })
      .locator('img')
      .dragTo(inventory.getByRole('button', { name: '背包格 5：空', exact: true }));
    await expect(inventory.getByRole('button', { name: '背包格 5：双手旅行杖', exact: true })).toBeVisible();
    expect((await saved()).equipment).toHaveLength(0);
    await op('equipment.set', { characterId: hero.id, slot: '副手', entryId: weapon.id });
    await expect(equipment.getByLabel('装备物品 主手：双手旅行杖', { exact: true })).toBeVisible();
    await equipment
      .getByLabel('装备物品 主手：双手旅行杖', { exact: true })
      .dragTo(inventory.locator('.display-title'));
    await expect.poll(async () => (await saved()).equipment.length).toBe(0);
    expect((await saved()).inventory.find((e: any) => e.id === weapon.id).position).toBeGreaterThanOrEqual(0);
    await op('equipment.set', { characterId: hero.id, slot: '主手', entryId: weapon.id });
    await expect(main.getByLabel('转移目标角色', { exact: true })).toHaveValue(hero.id);
    await main.getByRole('button', { name: '转移物品', exact: true }).click();
    await expect(equipment.getByLabel('装备物品 主手：双手旅行杖', { exact: true })).toHaveCount(0);
    await equipment.getByRole('button', { name: '关闭装备', exact: true }).click();
    await expect(equipment).toHaveCount(0);
    const cell = inventory.getByRole('button', { name: /^背包格 \d+：旅行药剂$/ });
    await cell.hover();
    const tooltip = a.getByRole('tooltip', { name: '物品详情', exact: true });
    await expect(tooltip).toContainText('清新的草木气味');
    await expect(tooltip).toContainText('恢复');
    await expect(tooltip).toContainText('玻璃瓶身');
    expect(await tooltip.locator('input,textarea,select,button').count()).toBe(0);
    await a.screenshot({ path: info.outputPath('item-hover.png'), animations: 'disabled' });
    await cell.click();
    await expect(inventory.getByRole('button', { name: '保存实例', exact: true })).toHaveCount(0);
    await expect(inventory.getByRole('button', { name: '查看物品卡', exact: true })).toHaveCount(0);
    await expect(inventory.getByLabel('实例备注', { exact: true })).toHaveCount(0);
    await expect(inventory.locator('.inventory-detail').getByLabel('转移目标角色', { exact: true })).toHaveValue(
      hero.id,
    );
    await expect(
      inventory.locator('.inventory-detail').getByRole('button', { name: '转移物品', exact: true }),
    ).toBeDisabled();
    await expect(
      inventory.locator('.inventory-detail').getByRole('button', { name: '交易物品', exact: true }),
    ).toBeEnabled();
    await cell.click({ button: 'right' });
    const menu = a.getByRole('menu', { name: '背包物品操作', exact: true });
    await expect(menu.getByRole('menuitem', { name: '删除物品', exact: true })).toBeEnabled();
    await menu.getByRole('menuitem', { name: '交易物品', exact: true }).click();
    const trading = inventory.getByRole('region', { name: '玩家间交易', exact: true });
    await expect(trading.getByLabel('交易物品', { exact: true })).toHaveValue(bottle.id);
    await trading.getByLabel('交易接收角色', { exact: true }).selectOption(recipient.id);
    await trading.getByRole('button', { name: '提出交易', exact: true }).click();
    await expect(b.getByRole('button', { name: '确认接收', exact: true })).toBeVisible();
    expect((await saved()).inventory.find((e: any) => e.id === bottle.id).quantity).toBe(3);
    await b.getByRole('button', { name: '确认接收', exact: true }).click();
    await expect.poll(async () => (await saved()).inventory.find((e: any) => e.id === bottle.id).quantity).toBe(2);
    expect((await saved(recipient.id)).inventory.find((e: any) => e.itemId === potion.id).quantity).toBe(1);
    // Delete cancels pending offers and cannot modify names/notes/quantities through legacy APIs.
    const current = (await saved()).inventory.find((e: any) => e.id === bottle.id);
    await op(
      'inventory.instance.update',
      { id: current.id, version: current.version, data: { name: '越权改名' } },
      403,
      contexts[1],
    );
    await op('inventory.update', { id: current.id, version: current.version, quantity: 8 }, 403, contexts[1]);
    await op('inventory.delete', { id: current.id, version: current.version, quantity: 2 }, 403, contexts[2]);
    const pending = await op(
      'trade.offer',
      { entryId: current.id, version: current.version, targetCharacterId: recipient.id, quantity: 1 },
      200,
      contexts[1],
    );
    // Keyboard and outside-click dismissal leave normal map/window interaction available.
    await cell.scrollIntoViewIfNeeded();
    await cell.click({ button: 'right' });
    await a.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await cell.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: '删除物品', exact: true }).click();
    const confirmation = inventory.getByRole('dialog', { name: '删除背包物品', exact: true });
    await expect(confirmation).toContainText('×2');
    let deletionAttempt = 0;
    const deleteRequests: any[] = [];
    await a.route('**/operations', async (route) => {
      if (route.request().postDataJSON().type !== 'inventory.delete') return route.continue();
      deleteRequests.push(route.request().postDataJSON());
      deletionAttempt++;
      if (deletionAttempt === 1) return route.fulfill({ status: 503, json: { error: '测试删除失败' } });
      if (deletionAttempt === 2) {
        expect((await route.fetch()).status()).toBe(200);
        return route.abort('failed');
      }
      await route.continue();
    });
    await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(inventory.getByRole('alert')).toContainText('测试删除失败');
    expect((await saved()).inventory.find((e: any) => e.id === bottle.id).quantity).toBe(2);
    await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect.poll(async () => (await saved()).inventory.some((e: any) => e.id === bottle.id)).toBe(false);
    await expect(confirmation.getByRole('button', { name: '确认删除', exact: true })).toBeEnabled();
    await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    expect(deleteRequests).toHaveLength(3);
    expect(new Set(deleteRequests.map((r) => r.id)).size).toBe(1);
    await a.unroute('**/operations');
    expect((await saved()).inventory.some((e: any) => e.id === bottle.id)).toBe(false);
    expect((await db.tradeRequest.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('CANCELLED');
    const small = await op('character.create', { name: '单格行囊', ownerId: users[1].id });
    await db.character.update({ where: { id: small.id }, data: { inventorySlots: 1 } });
    const stacked = await op('inventory.add', { characterId: small.id, itemId: staff.id, quantity: 2 });
    await op('equipment.set', { characterId: small.id, slot: '主手', entryId: stacked.id });
    await inventory.getByLabel('选择角色背包', { exact: true }).selectOption(small.id);
    await inventory.getByRole('button', { name: '查看装备', exact: true }).click();
    await moveWindow(a, equipment, 980, 100);
    const stackCell = inventory.getByRole('button', { name: '背包格 1：双手旅行杖', exact: true });
    await equipment.getByLabel('装备物品 副手：双手旅行杖', { exact: true }).dragTo(stackCell);
    await expect.poll(async () => (await saved(small.id)).equipment.length).toBe(0);
    expect((await saved(small.id)).inventory).toHaveLength(1);
    expect((await saved(small.id)).inventory[0]).toMatchObject({ quantity: 2, position: 0 });
    await op('equipment.set', { characterId: small.id, slot: '副手', entryId: stacked.id });
    await equipment.getByRole('button', { name: '关闭装备', exact: true }).click();
    await expect(equipment).toHaveCount(0);
    await expect(stackCell.getByText('×1', { exact: true })).toBeVisible();
    await stackCell.click({ button: 'right' });
    await menu.getByRole('menuitem', { name: '删除物品', exact: true }).click();
    await expect(confirmation).toContainText('×1');
    await op('equipment.set', { characterId: small.id, slot: '副手', entryId: null });
    await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(inventory.getByRole('alert')).toContainText('状态已变化');
    expect((await saved(small.id)).inventory[0].quantity).toBe(2);
    await confirmation.getByRole('button', { name: '取消', exact: true }).click();
    await op('equipment.set', { characterId: small.id, slot: '副手', entryId: stacked.id });
    await expect(stackCell.getByText('×1', { exact: true })).toBeVisible();
    await stackCell.click();
    await inventory.locator('.inventory-detail').getByRole('button', { name: '删除物品', exact: true }).click();
    await confirmation.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    const remains = await saved(small.id);
    expect(remains.equipment).toHaveLength(1);
    expect(remains.inventory[0].quantity).toBe(1);
    expect(remains.inventory[0].position).toBeLessThan(0);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    if (roomId) await db.room.deleteMany({ where: { id: roomId, name: prefix } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
