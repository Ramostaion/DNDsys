import { test, expect, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { api } from './server-address';

config({ path: 'apps/api/.env' });
test('装备规则：多词条、中英文部位、主手限制、双手同显、卸下转移及满包回滚', async ({ browser }, info) => {
  test.setTimeout(180000);
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1600, height: 1050 } }),
    browser.newContext(),
  ]);
  const db = new PrismaClient(),
    prefix = `equipment-${randomUUID().slice(0, 8)}`,
    users: any[] = [];
  let roomId: string | undefined;
  const post = async (context: BrowserContext, path: string, data: unknown, status = 200) => {
    const r = await context.request.post(api + path, { data });
    expect(r.status(), await r.text()).toBe(status);
    return r.json();
  };
  const op = (type: string, payload: any, status = 200) =>
    post(contexts[0], `/rooms/${roomId}/operations`, { id: randomUUID(), type, payload }, status);
  const snap = async () => (await contexts[0].request.get(`${api}/rooms/${roomId}/snapshot`)).json();
  try {
    for (const [i, c] of contexts.entries())
      users.push(await post(c, '/auth/register', { username: `${prefix}-${i}`, password: randomUUID() }));
    const room = await post(contexts[0], '/rooms', { name: prefix }, 201);
    roomId = room.id;
    await post(contexts[1], '/rooms/join', { inviteCode: room.inviteCode });
    for (const field of [
      { fieldId: 'int', name: '智力', type: 'number', defaultValue: 15 },
      { fieldId: 'dex', name: '敏捷', type: 'number', defaultValue: 12 },
      { fieldId: 'damage', name: '法伤', type: 'number', formula: '{{int}}*2' },
    ])
      await op('sheet.field.upsert', { version: (await snap()).room.version, field });
    const hero = await op('character.create', { name: '持杖旅人', ownerId: users[1].id });
    const receiver = await op('character.create', { name: '接收旅人', ownerId: users[1].id });
    const saved = async (id = hero.id) => (await snap()).characters.find((c: any) => c.id === id);
    const staff = await op('item.create', {
      name: '双手星辰法杖',
      kind: '双手武器',
      data: {
        customFields: [
          { name: '智力', value: 3 },
          { name: ' 敏捷 ', value: 2 },
          { name: '法伤', value: 5 },
        ],
      },
    });
    const sword = await op('item.create', {
      name: '主手短剑',
      kind: '装备',
      compatibleSlots: ' 主手 ',
      data: { customFields: [{ name: '敏捷', value: 1 }] },
    });
    const ring = await op('item.create', { name: '两用饰物', kind: '饰品', compatibleSlots: '头部， 饰品1,头部' });
    expect(ring.compatibleSlots).toEqual(['头部', '饰品1']);
    let weapon = await op('inventory.add', { characterId: hero.id, itemId: staff.id, quantity: 1 });
    const swordEntry = await op('inventory.add', { characterId: hero.id, itemId: sword.id, quantity: 1 });
    const ringEntry = await op('inventory.add', { characterId: hero.id, itemId: ring.id, quantity: 1 });
    await op('equipment.set', { characterId: hero.id, slot: '手部', entryId: swordEntry.id }, 400);
    await op('equipment.set', { characterId: hero.id, slot: '副手', entryId: swordEntry.id }, 400);
    await op('equipment.set', { characterId: hero.id, slot: '头部', entryId: ringEntry.id });
    await op('equipment.set', { characterId: hero.id, slot: '胸部', entryId: ringEntry.id }, 400);
    await op('equipment.set', { characterId: hero.id, slot: '副手', entryId: weapon.id });
    let c = await saved();
    expect(c.equipment.filter((e: any) => e.entryId === weapon.id)).toHaveLength(1);
    expect(c.derived.values).toMatchObject({ int: 18, dex: 14, damage: 41 });
    expect(c.inventory.find((e: any) => e.id === weapon.id)).toMatchObject({ quantity: 1 });
    const page = await contexts[0].newPage();
    await page.goto(`/rooms/${roomId}`);
    await expect(page.getByTitle('已连接', { exact: true })).toBeVisible();
    await page.locator('.game-rail button[title="角色"]').click();
    await page.getByRole('button', { name: '持杖旅人', exact: true }).click();
    await page.getByRole('button', { name: '关闭角色', exact: true }).click();
    await expect(page.locator('.sheet-actions').getByRole('button', { name: '管理状态', exact: true })).toBeVisible();
    for (const name of ['技能', '状态', '特性'])
      await expect(page.locator('.character-skills').getByRole('heading', { name, exact: true })).toBeVisible();
    await page.locator('.sheet-actions').getByRole('button', { name: '装备', exact: true }).click();
    await page.getByRole('button', { name: '关闭人物卡', exact: true }).click();
    for (const slot of ['主手', '副手'])
      await expect(page.getByLabel(`装备物品 ${slot}：双手星辰法杖`, { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath('two-handed-equipped.png'), animations: 'disabled' });
    // Remove via the virtual main-hand slot; both views disappear and exactly one physical item returns.
    await page.getByLabel('主手装备', { exact: true }).selectOption('');
    for (const slot of ['主手', '副手'])
      await expect(page.getByLabel(`装备物品 ${slot}：双手星辰法杖`, { exact: true })).toHaveCount(0);
    c = await saved();
    expect(c.equipment.filter((e: any) => e.entryId === weapon.id)).toHaveLength(0);
    expect(c.inventory.find((e: any) => e.id === weapon.id).position).toBeGreaterThanOrEqual(0);
    expect(c.derived.values).toMatchObject({ int: 15, dex: 12, damage: 30 });
    await op('equipment.set', { characterId: hero.id, slot: '主手', entryId: weapon.id });
    weapon = (await saved()).inventory.find((e: any) => e.id === weapon.id);
    await op('inventory.transfer', {
      id: weapon.id,
      version: weapon.version,
      targetCharacterId: receiver.id,
      quantity: 1,
      sourceSlot: '副手',
      targetSlot: '副手',
      targetEquipmentId: null,
    });
    expect((await saved()).inventory.some((e: any) => e.id === weapon.id)).toBe(false);
    let received = await saved(receiver.id);
    expect(received.equipment).toHaveLength(1);
    expect(received.derived.values).toMatchObject({ int: 18, dex: 14, damage: 41 });
    const receivedEntry = received.inventory.find((e: any) => e.itemId === staff.id);
    await op('inventory.transfer', {
      id: receivedEntry.id,
      version: receivedEntry.version,
      targetCharacterId: hero.id,
      quantity: 1,
      sourceSlot: '主手',
    });
    received = await saved(receiver.id);
    expect(received.equipment).toHaveLength(0);
    expect(received.derived.values).toMatchObject({ int: 15, dex: 12, damage: 30 });
    weapon = (await saved()).inventory.find((e: any) => e.itemId === staff.id);
    await op('equipment.set', { characterId: hero.id, slot: '主手', entryId: swordEntry.id });
    const shield = await op('item.create', { name: '副手盾', kind: '装备', compatibleSlots: ['副手'] });
    const shieldEntry = await op('inventory.add', { characterId: hero.id, itemId: shield.id });
    await op('equipment.set', { characterId: hero.id, slot: '副手', entryId: shieldEntry.id });
    // Fill every backpack slot, including the incoming staff. Replacing two hands needs two returned slots.
    const filler = await op('item.create', { name: '行囊石块', kind: '杂物' });
    while ((await saved()).inventory.filter((e: any) => e.position >= 0).length < 24)
      await op('inventory.add', { characterId: hero.id, itemId: filler.id });
    await op('equipment.set', { characterId: hero.id, slot: '主手', entryId: weapon.id }, 409);
    c = await saved();
    expect(c.equipment.filter((e: any) => e.entryId === swordEntry.id || e.entryId === shieldEntry.id)).toHaveLength(2);
    expect(c.inventory.find((e: any) => e.id === weapon.id).quantity).toBe(1);
    const stone = c.inventory.find((e: any) => e.itemId === filler.id);
    await op('inventory.update', { id: stone.id, version: stone.version, quantity: 0 });
    await op('equipment.set', { characterId: hero.id, slot: '副手', entryId: weapon.id });
    c = await saved();
    expect(c.equipment.filter((e: any) => ['主手', '副手'].includes(e.slot))).toHaveLength(1);
    expect(c.derived.values).toMatchObject({ int: 18, dex: 14, damage: 41 });
    // Editing multiple equipped fields recalculates all effects immediately, then slot edits unequip invalid items.
    await op('item.update', {
      id: staff.id,
      version: staff.version,
      patch: {
        data: {
          customFields: [
            { name: '智力', value: 5 },
            { name: '敏捷', value: 4 },
            { name: '法伤', value: 7 },
          ],
        },
      },
    });
    expect((await saved()).derived.values).toMatchObject({ int: 20, dex: 16, damage: 47 });
    const currentRing = (await snap()).items.find((i: any) => i.id === ring.id);
    await op(
      'item.update',
      { id: ring.id, version: currentRing.version, patch: { compatibleSlots: '饰品1，饰品2' } },
      409,
    );
    const anotherStone = (await saved()).inventory.find((e: any) => e.itemId === filler.id);
    await op('inventory.update', { id: anotherStone.id, version: anotherStone.version, quantity: 0 });
    await op('item.update', { id: ring.id, version: currentRing.version, patch: { compatibleSlots: '饰品1，饰品2' } });
    expect((await saved()).equipment.some((e: any) => e.entryId === ringEntry.id)).toBe(false);
    await page.getByRole('button', { name: '关闭装备', exact: true }).click();
    await page.locator('.game-rail button[title="物品"]').click();
    await page.locator('.item-library').getByRole('button', { name: '双手星辰法杖', exact: true }).click();
    const editor = page.locator('.item-editor');
    for (const [index, value] of [6, 3, 9].entries())
      await editor.getByLabel(`项目内容 ${index + 1}`, { exact: true }).fill(String(value));
    await editor.getByRole('button', { name: '保存物品卡', exact: true }).click();
    await expect.poll(async () => (await saved()).derived.values).toMatchObject({ int: 21, dex: 15, damage: 51 });
    await page.getByRole('button', { name: '关闭物品卡', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.locator('.item-library').getByRole('button', { name: '两用饰物', exact: true }).click();
    await editor.getByLabel('可装备部位', { exact: true }).fill('头部， 饰品1');
    await editor.getByRole('button', { name: '保存物品卡', exact: true }).click();
    await expect
      .poll(async () => (await snap()).items.find((i: any) => i.id === ring.id).compatibleSlots)
      .toEqual(['头部', '饰品1']);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    if (roomId) await db.room.deleteMany({ where: { id: roomId, name: prefix } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
