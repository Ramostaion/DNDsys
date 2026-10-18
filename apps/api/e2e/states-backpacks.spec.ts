import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { api } from './server-address';

config({ path: 'apps/api/.env' });
async function setup(browser: Browser) {
  const db = new PrismaClient(),
    prefix = `states-bags-${randomUUID().slice(0, 8)}`;
  const contexts = await Promise.all(
    [0, 1, 2].map(() => browser.newContext({ viewport: { width: 1700, height: 1100 } })),
  );
  const users: any[] = [];
  let roomId: string | undefined;
  const post = async (context: BrowserContext, path: string, data: unknown, status = 200) => {
    const response = await context.request.post(api + path, { data });
    expect(response.status(), await response.text()).toBe(status);
    return response.json();
  };
  const op = (type: string, payload: any, status = 200, context = contexts[0]) =>
    post(context, `/rooms/${roomId}/operations`, { id: randomUUID(), type, payload }, status);
  const snap = async (context = contexts[0]) => (await context.request.get(`${api}/rooms/${roomId}/snapshot`)).json();
  const cleanup = async () => {
    await Promise.all(contexts.map((c) => c.close()));
    if (roomId) await db.room.deleteMany({ where: { id: roomId, name: prefix } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  };
  try {
    for (const [i, c] of contexts.entries())
      users.push(await post(c, '/auth/register', { username: `${prefix}-${i}`, password: randomUUID() }));
    const room = await post(contexts[0], '/rooms', { name: prefix }, 201);
    roomId = room.id;
    for (const c of contexts.slice(1)) await post(c, '/rooms/join', { inviteCode: room.inviteCode });
    for (const field of [
      { fieldId: 'int', name: '智力', type: 'number', defaultValue: 15 },
      { fieldId: 'dex', name: '敏捷', type: 'number', defaultValue: 12 },
      { fieldId: 'power', name: '力量', type: 'number', defaultValue: 15 },
      { fieldId: 'damage', name: '法伤', type: 'number', formula: '{{int}}*2' },
    ])
      await op('sheet.field.upsert', { version: (await snap()).room.version, field });
    const hero = await op('character.create', { name: '行囊法师', ownerId: users[1].id });
    const other = await op('character.create', { name: '同行游侠', ownerId: users[2].id });
    const saved = async (id = hero.id) => (await snap()).characters.find((c: any) => c.id === id);
    return { contexts, users, roomId: roomId!, room, op, snap, saved, hero, other, cleanup, db };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
async function enter(page: Page, roomId: string) {
  await page.goto(`/rooms/${roomId}`);
  await expect(page.getByTitle('已连接', { exact: true })).toBeVisible();
}
async function characterSheet(page: Page) {
  await page.locator('.game-rail button[title="角色"]').click();
  await page.getByRole('button', { name: '行囊法师', exact: true }).click();
  await page.getByRole('button', { name: '关闭角色', exact: true }).click();
}
test('状态与技能：公开默认、记录词条、从技能导入、属性联动、私密来源及本人特性启停', async ({ browser }, info) => {
  test.setTimeout(180000);
  const f = await setup(browser);
  try {
    const [gm, player] = await Promise.all(f.contexts.slice(0, 2).map((c) => c.newPage()));
    const errors: string[] = [];
    for (const p of [gm, player]) {
      p.on('pageerror', (e) => errors.push(e.message));
      await enter(p, f.roomId);
    }
    await gm.locator('.game-rail button[title="能力"]').click();
    const lib = gm.locator('.template-library');
    await lib.getByRole('button', { name: '技能', exact: true }).click();
    await lib.getByRole('button', { name: '新建', exact: true }).click();
    const editor = lib.locator('.template-editor');
    await editor.locator('input').filter({ visible: true }).first().fill('奥术专注');
    await editor.getByRole('button', { name: '添加自定义词条', exact: true }).click();
    await editor.getByLabel('词条名称 1', { exact: true }).fill('智力');
    await editor.getByLabel('词条类型 1', { exact: true }).selectOption('number');
    await editor.getByLabel('词条内容 1', { exact: true }).fill('3');
    await editor.getByRole('button', { name: '保存模板', exact: true }).click();
    await expect(editor).toHaveCount(0);
    const skill = (await f.snap()).templates.find((t: any) => t.name === '奥术专注');
    expect(skill.data.customFields).toEqual([{ name: '智力', value: 3 }]);
    await f.op('template.apply', { characterId: f.hero.id, templateId: skill.id });
    expect((await f.saved()).derived.values.int).toBe(15);
    await gm.getByRole('button', { name: '关闭能力模板库', exact: true }).click();
    await characterSheet(gm);
    await gm.locator('.sheet-actions').getByRole('button', { name: '管理状态', exact: true }).click();
    await gm.getByRole('button', { name: '关闭人物卡', exact: true }).click();
    const manager = gm.locator('.tag-manager');
    await expect(manager).not.toContainText('标签');
    await manager.getByRole('button', { name: '从技能选择', exact: true }).click();
    await manager.getByRole('button', { name: '奥术专注', exact: false }).click();
    await expect.poll(async () => (await f.saved()).derived.values.int).toBe(18);
    let status = (await f.snap()).characterTags.find((t: any) => t.definition.name === '奥术专注');
    expect(status.visibility).toBe('PUBLIC');
    expect(status.customFields).toEqual([{ name: '智力', value: 3 }]);
    expect((await f.snap(f.contexts[1])).characterTags.some((t: any) => t.id === status.id)).toBe(true);
    await manager.getByRole('button', { name: '添加状态', exact: true }).click();
    const definition = manager.locator('.tag-definition-editor');
    await expect(definition.getByLabel('默认可见范围', { exact: true })).toHaveValue('PUBLIC');
    await definition.getByLabel('状态名称', { exact: true }).fill('灵巧祝福');
    await definition.getByRole('button', { name: '添加自定义词条', exact: true }).click();
    await definition.getByLabel('词条名称 1', { exact: true }).fill('敏捷');
    await definition.getByLabel('词条类型 1', { exact: true }).selectOption('number');
    await definition.getByLabel('词条内容 1', { exact: true }).fill('2');
    await definition.getByRole('button', { name: '保存状态定义', exact: true }).click();
    const attach = manager.locator('.tag-attach-form');
    await expect(attach.getByLabel('状态可见范围', { exact: true })).toHaveValue('PUBLIC');
    await attach.getByRole('button', { name: '添加到此角色', exact: true }).click();
    await expect.poll(async () => (await f.saved()).derived.values.dex).toBe(14);
    await expect(attach).toHaveCount(0);
    await gm.screenshot({ path: info.outputPath('state-custom-fields.png'), animations: 'disabled' });
    await characterSheet(player);
    await expect(
      player.locator('.character-skills').getByRole('button', { name: '状态：奥术专注', exact: true }),
    ).toBeVisible();
    await expect(player.locator('.character-skills')).toContainText('智力');
    const secret = await f.op('tagDefinition.create', {
      name: '秘密星痕',
      icon: 'star',
      color: '#d4af57',
      defaultVisibility: 'GM_ONLY',
      customFields: [{ name: '智力', value: 4 }],
    });
    await f.op('characterTag.attach', {
      characterId: f.hero.id,
      tagDefinitionId: secret.id,
      definitionVersion: secret.version,
    });
    const ownerSnap = await f.snap(f.contexts[1]);
    const owner = ownerSnap.characters.find((c: any) => c.id === f.hero.id);
    expect(owner.derived.values.int).toBe(22);
    expect(JSON.stringify(ownerSnap)).not.toContain('秘密星痕');
    expect(owner.derived.breakdown.int.changes).toContainEqual({
      name: '状态修正（来源不可见）',
      amount: 4,
      kind: 'buff',
    });
    const combat = await f.op(
      'combat.record',
      { kind: 'DECLARATION', actorId: f.hero.id, targetId: f.other.id, actorAttribute: '智力', summary: '公开对抗' },
      200,
      f.contexts[1],
    );
    expect(JSON.stringify(combat)).not.toContain('秘密星痕');
    const trait = await f.op('template.create', {
      name: '灵光体质',
      kind: 'TRAIT',
      data: { enabled: false, modifierRows: [{ targetFieldId: 'int', operation: 'ADD', value: 1 }] },
    });
    await f.op('template.apply', { characterId: f.hero.id, templateId: trait.id, shared: true });
    expect((await f.saved()).traits[0].enabled).toBe(true);
    await expect(player.getByRole('button', { name: '停用特性：灵光体质', exact: true })).toBeVisible();
    await player.locator('.sheet-actions').getByRole('button', { name: '技能', exact: true }).click();
    await player.getByRole('button', { name: '关闭人物卡', exact: true }).click();
    const switches = player.getByRole('region', { name: '角色特性开关', exact: true });
    await expect(switches).toBeVisible();
    await switches.getByRole('button', { name: '停用特性：灵光体质', exact: true }).click();
    await expect.poll(async () => (await f.saved()).traits[0].enabled).toBe(false);
    await f.op('template.update', {
      id: trait.id,
      version: trait.version,
      patch: { data: { enabled: true, modifierRows: [{ targetFieldId: 'int', operation: 'ADD', value: 1 }] } },
    });
    expect((await f.saved()).traits[0].enabled).toBe(false);
    await expect(switches.getByRole('button', { name: '启用特性：灵光体质', exact: true })).toBeVisible();
    const c = await f.saved();
    await f.op(
      'template.enable',
      { characterId: f.hero.id, field: 'traits', instanceId: c.traits[0].id, enabled: true, version: c.version },
      403,
      f.contexts[2],
    );
    await switches.getByRole('button', { name: '启用特性：灵光体质', exact: true }).click();
    await expect.poll(async () => (await f.saved()).traits[0].enabled).toBe(true);
    await player.getByRole('button', { name: '关闭能力', exact: true }).click();
    const draftId = randomUUID();
    const draftResponse = await f.contexts[1].request.put(`${api}/rooms/${f.roomId}/combat-drafts/${draftId}`, {
      data: { revision: 1, actorId: f.hero.id, targetId: f.other.id, actorAttribute: '智力' },
    });
    expect(draftResponse.status()).toBe(200);
    const draft = await draftResponse.json();
    await f.op('characterTag.update', {
      id: status.id,
      version: status.version,
      detailsMarkdown: '独立副本',
      visibility: 'PUBLIC',
      priority: 0,
      customFields: [{ name: '智力', value: 2 }],
    });
    expect((await f.saved()).derived.values.int).toBe(22);
    expect((await (await f.contexts[1].request.get(`${api}/rooms/${f.roomId}/combat-drafts`)).json()).drafts).toEqual(
      [],
    );
    await f.op(
      'combat.record',
      {
        kind: 'DECLARATION',
        actorId: f.hero.id,
        targetId: f.other.id,
        actorAttribute: '智力',
        draftId,
        draftRevision: draft.revision,
        draftEventId: draft.eventId,
      },
      409,
      f.contexts[1],
    );
    const renamed = await f.op('tagDefinition.update', { ...secret, name: '秘密星痕改名' });
    expect((await f.saved()).derived.breakdown.int.changes.some((change: any) => change.name === renamed.name)).toBe(
      true,
    );
    expect(JSON.stringify(await f.snap(f.contexts[1]))).not.toContain('秘密星痕');
    expect((await f.snap()).templates.find((t: any) => t.id === skill.id).data.customFields[0].value).toBe(3);
    status = (await f.snap()).characterTags.find((t: any) => t.id === status.id);
    await f.op('characterTag.detach', { id: status.id, version: status.version });
    expect((await f.saved()).derived.values.int).toBe(20);
    // Historical shared instances without an enabled flag retain their default active state on template updates.
    const historical = await f.saved();
    await f.db.character.update({
      where: { id: f.hero.id },
      data: { traits: historical.traits.map(({ enabled: _enabled, ...entry }: any) => entry) },
    });
    const currentTrait = (await f.snap()).templates.find((t: any) => t.id === trait.id);
    await f.op('template.update', {
      id: trait.id,
      version: currentTrait.version,
      patch: { data: { enabled: false, modifierRows: [{ targetFieldId: 'int', operation: 'ADD', value: 1 }] } },
    });
    expect((await f.saved()).traits[0].enabled).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test('胸部背包：物品种类与格数、胸甲共存、真实拖放扩容、修改转移卸下与满包回滚', async ({ browser }, info) => {
  test.setTimeout(180000);
  const f = await setup(browser);
  try {
    const gm = await f.contexts[0].newPage();
    await enter(gm, f.roomId);
    await gm.locator('.game-rail button[title="物品"]').click();
    const lib = gm.locator('.item-library');
    await lib.locator('form input').fill('皮革行囊');
    await lib.locator('form select').selectOption('背包');
    await lib.getByRole('button', { name: '创建物品', exact: true }).click();
    await expect(gm.getByLabel('项目名称 1', { exact: true })).toHaveValue('格数');
    await gm.getByLabel('项目内容 1', { exact: true }).fill('2');
    await gm.getByRole('button', { name: '保存物品卡', exact: true }).click();
    await expect
      .poll(async () => (await f.snap()).items.find((i: any) => i.name === '皮革行囊')?.data.customFields[0].value)
      .toBe(2);
    let bag = (await f.snap()).items.find((i: any) => i.name === '皮革行囊');
    const armor = await f.op('item.create', { name: '旅行胸甲', kind: '装备', compatibleSlots: ['胸部'] });
    const bagEntry = await f.op('inventory.add', { characterId: f.hero.id, itemId: bag.id });
    const armorEntry = await f.op('inventory.add', { characterId: f.hero.id, itemId: armor.id });
    await f.op('equipment.set', { characterId: f.hero.id, slot: '胸部', entryId: armorEntry.id });
    await f.op('equipment.set', { characterId: f.hero.id, slot: '胸部', entryId: bagEntry.id }, 400);
    await f.op('equipment.set', { characterId: f.hero.id, slot: '背包', entryId: armorEntry.id }, 400);
    const player = await f.contexts[1].newPage();
    await enter(player, f.roomId);
    await characterSheet(player);
    await player.locator('.sheet-actions').getByRole('button', { name: '装备', exact: true }).click();
    await player.getByRole('button', { name: '关闭人物卡', exact: true }).click();
    const equipment = player.locator('.equipment-panel');
    await expect(equipment.locator('.equip-chest-group')).toContainText('护甲与背包可同时装备');
    await equipment.getByRole('button', { name: '打开背包', exact: true }).click();
    const inventory = player.locator('.inventory-panel');
    // Separate the two overlapping movable windows for native drag-and-drop.
    for (const [panel, x] of [
      [equipment, 12],
      [inventory, 900],
    ] as const) {
      const win = player.locator('.window').filter({ has: panel });
      const title = (await win.locator('.window-title').boundingBox())!;
      await player.mouse.move(title.x + 100, title.y + 18);
      await player.mouse.down();
      await player.mouse.move(x + 100, 88, { steps: 8 });
      await player.mouse.up();
    }
    await inventory
      .getByRole('button', { name: /^背包格 \d+：皮革行囊$/ })
      .dragTo(equipment.getByLabel('装备部位 背包', { exact: true }));
    await expect.poll(async () => (await f.saved()).inventorySlots).toBe(26);
    expect((await f.saved()).equipment.map((e: any) => e.entryId).sort()).toEqual([bagEntry.id, armorEntry.id].sort());
    await expect(equipment.getByLabel('装备物品 胸部：旅行胸甲', { exact: true })).toBeVisible();
    await expect(equipment.getByLabel('装备物品 背包：皮革行囊', { exact: true })).toBeVisible();
    await player.screenshot({ path: info.outputPath('chest-backpack.png'), animations: 'disabled' });
    await equipment.getByLabel('装备物品 背包：皮革行囊', { exact: true }).dragTo(inventory.locator('.display-title'));
    await expect.poll(async () => (await f.saved()).inventorySlots).toBe(24);
    expect((await f.saved()).equipment[0].entryId).toBe(armorEntry.id);
    await equipment.getByLabel('背包装备', { exact: true }).selectOption(bagEntry.id);
    await expect.poll(async () => (await f.saved()).inventorySlots).toBe(26);
    await f.op('item.update', {
      id: bag.id,
      version: bag.version,
      patch: { data: { customFields: [{ name: '格数', value: 4 }] } },
    });
    expect((await f.saved()).inventorySlots).toBe(28);
    bag = (await f.snap()).items.find((i: any) => i.id === bag.id);
    await f.op(
      'item.update',
      { id: bag.id, version: bag.version, patch: { data: { customFields: [{ name: '格数', value: -2 }] } } },
      400,
    );
    let worn = (await f.saved()).inventory.find((e: any) => e.id === bagEntry.id);
    await f.op('inventory.transfer', {
      id: worn.id,
      version: worn.version,
      targetCharacterId: f.other.id,
      sourceSlot: '背包',
      targetSlot: '背包',
      targetEquipmentId: null,
      quantity: 1,
    });
    expect((await f.saved()).inventorySlots).toBe(24);
    expect((await f.saved(f.other.id)).inventorySlots).toBe(28);
    worn = (await f.saved(f.other.id)).inventory.find((e: any) => e.itemId === bag.id);
    await f.op('inventory.transfer', {
      id: worn.id,
      version: worn.version,
      targetCharacterId: f.hero.id,
      sourceSlot: '背包',
      targetSlot: '背包',
      targetEquipmentId: null,
      quantity: 1,
    });
    expect((await f.saved()).inventorySlots).toBe(28);
    expect((await f.saved(f.other.id)).inventorySlots).toBe(24);
    const filler = await f.op('item.create', { name: '补给石', kind: '杂物' });
    for (let i = 0; i < 28; i++) await f.op('inventory.add', { characterId: f.hero.id, itemId: filler.id });
    await f.op('equipment.set', { characterId: f.hero.id, slot: '背包', entryId: null }, 409);
    expect((await f.saved()).inventorySlots).toBe(28);
    expect((await f.saved()).equipment).toHaveLength(2);
    const tiny = await f.op('item.create', {
      name: '小背包',
      kind: '背包',
      data: { customFields: [{ name: '格数', value: 1 }] },
    });
    // An equipped bag may be resized without dropping or deleting overflow items.
    await f.op('item.update', {
      id: bag.id,
      version: bag.version,
      patch: { data: { customFields: [{ name: '格数', value: 2 }] } },
    });
    expect((await f.saved()).inventorySlots).toBe(26);
    expect((await f.saved()).inventory.filter((e: any) => e.itemId === filler.id)).toHaveLength(28);
    expect(tiny.kind).toBe('背包');
  } finally {
    await f.cleanup();
  }
});
