import { test, expect, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { api } from './server-address';

config({ path: 'apps/api/.env' });
test('力量背包：基准增减、超载保留、装备重算、服务端边界、交易、分页及旧卡', async ({ browser }, info) => {
  test.setTimeout(180000);
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1600, height: 1050 } }),
    browser.newContext({ viewport: { width: 1000, height: 800 } }),
  ]);
  const db = new PrismaClient(),
    prefix = `strength-${randomUUID().slice(0, 8)}`,
    users: any[] = [];
  let roomId: string | undefined;
  const post = async (context: BrowserContext, path: string, data: unknown, expected = 200) => {
    const response = await context.request.post(api + path, { data });
    expect(response.status(), await response.text()).toBe(expected);
    return response.json();
  };
  const op = (type: string, payload: Record<string, unknown>, expected = 200, context = contexts[0]) =>
    post(context, `/rooms/${roomId}/operations`, { id: randomUUID(), type, payload }, expected);
  const snap = async () => (await contexts[0].request.get(`${api}/rooms/${roomId}/snapshot`)).json();
  let hero: any;
  const saved = async (id = hero.id) => (await snap()).characters.find((c: any) => c.id === id);
  const strength = async (value: number, id = hero.id) =>
    op('character.field.set', { characterId: id, fieldId: 'power', value, version: (await saved(id)).version });
  try {
    for (const [i, context] of contexts.entries())
      users.push(await post(context, '/auth/register', { username: `${prefix}-${i}`, password: randomUUID() }));
    const room = await post(contexts[0], '/rooms', { name: prefix }, 201);
    roomId = room.id;
    await post(contexts[1], '/rooms/join', { inviteCode: room.inviteCode });
    hero = await op('character.create', { name: '负重游侠', ownerId: users[1].id });
    const receiver = await op('character.create', { name: '同行伙伴', ownerId: users[1].id });
    expect((await saved()).inventorySlots).toBe(24);
    await op('sheet.field.upsert', {
      version: (await snap()).room.version,
      field: { fieldId: 'power', name: '力量', type: 'number', defaultValue: 15 },
    });
    const pages = await Promise.all(contexts.map((c) => c.newPage())),
      [gm, player] = pages,
      errors: string[] = [];
    for (const page of pages) {
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`/rooms/${roomId}`);
      await expect(page.getByTitle('已连接', { exact: true })).toBeVisible();
      await page.locator('.game-rail button[title="角色"]').click();
      await page.getByRole('button', { name: '负重游侠', exact: true }).click();
      await page.getByRole('button', { name: '关闭角色', exact: true }).click();
      await page.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true }).click();
    }
    async function capacity(value: number) {
      await expect.poll(async () => (await saved()).inventorySlots).toBe(value);
      for (const page of pages) {
        await expect(page.getByLabel('背包容量', { exact: true })).toContainText(`/ ${value} 格`);
        await expect(page.getByLabel('背包物品格', { exact: true }).locator('.inventory-slot')).toHaveCount(
          Math.min(96, value),
        );
      }
    }
    await capacity(24);
    for (const [value, cells] of [
      [16, 26],
      [17, 28],
      [14, 22],
      [0, 0],
      [16, 26],
    ]) {
      await strength(value);
      await capacity(cells);
    }
    await op(
      'character.field.set',
      { characterId: hero.id, fieldId: 'power', value: 20, version: (await saved()).version },
      403,
      contexts[1],
    );
    const iron = await op('item.create', { name: '旅行补给', kind: '杂物' });
    const belt = await op('item.create', {
      name: '力量腰带',
      kind: '饰品',
      compatibleSlots: ['饰品1'],
      data: { customFields: [{ name: '力量', type: 'number', value: 2 }] },
    });
    for (let position = 0; position < 26; position++)
      await op('inventory.add', {
        characterId: hero.id,
        itemId: position === 25 ? belt.id : iron.id,
        position,
        quantity: 1,
      });
    const ids = (await saved()).inventory.map((e: any) => e.id).sort();
    await strength(14);
    await capacity(22);
    await expect(player.getByRole('region', { name: '超出容量的物品' }).locator('.inventory-slot')).toHaveCount(4);
    expect((await saved()).inventory.map((e: any) => e.id).sort()).toEqual(ids);
    await op('inventory.add', { characterId: hero.id, itemId: iron.id, quantity: 1 }, 409);
    await op('inventory.add', { characterId: hero.id, itemId: iron.id, position: 25, quantity: 1 }, 409);
    await player.screenshot({ path: info.outputPath('capacity-overflow.png') });
    await player.reload();
    await player.locator('.game-rail button[title="背包"]').click();
    await expect(player.getByRole('region', { name: '超出容量的物品' }).locator('.inventory-slot')).toHaveCount(4);
    let source = (await saved()).inventory.find((e: any) => e.position === 22);
    await op('inventory.transfer', {
      id: source.id,
      version: source.version,
      targetCharacterId: receiver.id,
      quantity: 1,
    });
    const beltEntry = (await saved()).inventory.find((e: any) => e.itemId === belt.id);
    await op('equipment.set', { characterId: hero.id, slot: '饰品1', entryId: beltEntry.id });
    await capacity(26);
    expect((await saved()).derived.values.power).toBe(16);
    await expect(player.getByRole('region', { name: '超出容量的物品' })).toHaveCount(0);
    await op('equipment.set', { characterId: hero.id, slot: '饰品1', entryId: null }, 409);
    expect((await saved()).equipment[0].entryId).toBe(beltEntry.id);
    expect((await saved()).inventorySlots).toBe(26);
    for (let i = 0; i < 3; i++) {
      source = (await saved()).inventory.find((e: any) => e.position >= 0);
      await op('inventory.transfer', {
        id: source.id,
        version: source.version,
        targetCharacterId: receiver.id,
        quantity: 1,
      });
    }
    await op('equipment.set', { characterId: hero.id, slot: '饰品1', entryId: null });
    await capacity(22);
    let current = await saved();
    for (const overflow of current.inventory.filter((e: any) => e.position >= 22)) {
      const occupied = new Set((await saved()).inventory.map((e: any) => e.position));
      const position = Array.from({ length: 22 }, (_, i) => i).find((i) => !occupied.has(i));
      await op('inventory.move', { id: overflow.id, version: overflow.version, position, targetEntryId: null });
    }
    await expect(player.getByRole('region', { name: '超出容量的物品' })).toHaveCount(0);
    await strength(0, receiver.id);
    source = (await saved()).inventory.find((e: any) => e.itemId === iron.id);
    const offer = await op('trade.offer', {
      entryId: source.id,
      version: source.version,
      targetCharacterId: receiver.id,
      quantity: 1,
    });
    await op('trade.accept', { id: offer.id }, 409, contexts[1]);
    expect((await db.tradeRequest.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe('PENDING');
    await strength(15, receiver.id);
    await op('trade.accept', { id: offer.id }, 200, contexts[1]);
    await strength(100);
    await capacity(194);
    await player.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(player.getByLabel('背包格 97：空', { exact: true })).toBeVisible();
    await player.getByRole('button', { name: '下一页', exact: true }).click();
    await expect(player.getByLabel('背包物品格', { exact: true }).locator('.inventory-slot')).toHaveCount(2);
    await strength(15);
    await capacity(24);
    await op('sheet.field.upsert', {
      version: (await snap()).room.version,
      field: { fieldId: 'power', name: '体能', type: 'number', defaultValue: 15 },
    });
    expect((await saved()).inventorySlots).toBe(24);
    await db.room.update({ where: { id: roomId }, data: { sheetMode: false } });
    for (const [value, cells] of [
      [15, 24],
      [16, 26],
      [14, 22],
    ]) {
      current = await saved();
      await op('character.update', {
        id: hero.id,
        version: current.version,
        patch: { currentHp: 10, attributes: { 力量: value } },
      });
      await capacity(cells);
    }
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    if (roomId) await db.room.deleteMany({ where: { id: roomId, name: prefix } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
