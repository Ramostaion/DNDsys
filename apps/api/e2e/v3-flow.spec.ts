import { api } from './server-address';
import { test, expect, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config({ path: 'apps/api/.env' });

async function post(context: BrowserContext, path: string, data: unknown) {
  const response = await context.request.post(api + path, { data });
  const body = await response.json();
  expect(response.ok(), `${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}
async function op(context: BrowserContext, roomId: string, type: string, payload: Record<string, unknown>) {
  return post(context, `/rooms/${roomId}/operations`, { id: randomUUID(), type, payload });
}
async function login(context: BrowserContext, username: string) {
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByRole('textbox', { name: '冒险者名称' }).fill(username);
  await page.getByRole('textbox', { name: '密码' }).fill('demo12345');
  await page.getByRole('button', { name: '进入冒险' }).click();
  await expect(page).toHaveURL(/\/rooms$/);
  return page;
}

test('GM 定义字段后，三账号使用公式、装备、Buff、人工记录与自由骰', async ({ browser }) => {
  const gmContext = await browser.newContext(),
    aContext = await browser.newContext(),
    bContext = await browser.newContext();
  const db = new PrismaClient();
  let roomId: string | undefined;
  try {
    const gm = await login(gmContext, 'demo-gm');
    const playerA = await login(aContext, 'demo-player-1');
    const playerB = await login(bContext, 'demo-player-2');
    const owner = await (await aContext.request.get(api + '/auth/me')).json();
    const room = await post(gmContext, '/rooms', { name: `E2E v3 ${randomUUID().slice(0, 8)}` });
    roomId = room.id;
    await post(aContext, '/rooms/join', { inviteCode: room.inviteCode });
    await post(bContext, '/rooms/join', { inviteCode: room.inviteCode });
    await post(gmContext, `/rooms/${room.id}/members/${owner.id}/permissions`, {
      characterValues: true,
      inventoryAdd: true,
      templateInstall: true,
    });
    const hero = await op(gmContext, room.id, 'character.create', { name: '星痕测试角色', ownerId: owner.id });
    const npc = await op(gmContext, room.id, 'character.create', { name: '测试目标' });
    let version = room.version;
    for (const field of [
      { fieldId: 'strength', name: '力量', type: 'number', defaultValue: 12 },
      { fieldId: 'power', name: '战力', type: 'number', formula: '{{strength}}*2' },
      { fieldId: 'defense', name: '防御', type: 'number', defaultValue: 10 },
      { fieldId: 'hp', name: '生命', type: 'number', defaultValue: 20, isResource: true },
      { fieldId: 'ap', name: '普通行动点', type: 'number', defaultValue: 2, isResource: true },
      { fieldId: 'sp', name: '特殊行动点', type: 'number', defaultValue: 1, isResource: true },
    ]) {
      const result = await op(gmContext, room.id, 'sheet.field.upsert', { version, field });
      version = result.roomVersion;
    }
    const armor = await op(gmContext, room.id, 'item.create', {
      name: '星痕护甲',
      kind: '装备',
      data: { modifiers: { defense: 4 } },
      compatibleSlots: ['护甲'],
    });
    const entry = await op(aContext, room.id, 'inventory.add', { characterId: hero.id, itemId: armor.id });
    await op(aContext, room.id, 'equipment.set', { characterId: hero.id, slot: '胸部', entryId: entry.id });
    const buff = await op(gmContext, room.id, 'template.create', {
      name: '力量祝福',
      kind: 'STATUS',
      data: { modifiers: { strength: 3 } },
    });
    await op(aContext, room.id, 'template.apply', { characterId: hero.id, templateId: buff.id, shared: true });
    await op(gmContext, room.id, 'combat.start', { characterIds: [hero.id, npc.id] });

    await Promise.all([
      gm.goto(`/rooms/${room.id}`),
      playerA.goto(`/rooms/${room.id}`),
      playerB.goto(`/rooms/${room.id}`),
    ]);
    await expect(playerA.locator('.hero-chip').filter({ hasText: '星痕测试角色' })).toBeVisible();
    await playerA.locator('.hero-chip').filter({ hasText: '星痕测试角色' }).click();
    await expect(
      playerA.locator('.grid-card').filter({ hasText: '战力' }).getByText('30', { exact: true }),
    ).toBeVisible();
    await expect(
      playerA.locator('.grid-card').filter({ hasText: '防御' }).getByText('14', { exact: true }),
    ).toBeVisible();
    const strength = playerA
      .locator('.grid-card')
      .filter({ hasText: '力量' })
      .filter({ has: playerA.getByLabel('力量增减量') });
    await strength.getByRole('button', { name: '+', exact: true }).click();
    await expect(
      playerA.locator('.grid-card').filter({ hasText: '战力' }).getByText('32', { exact: true }),
    ).toBeVisible();

    await playerB.locator('.game-rail').getByRole('button', { name: '角色', exact: true }).click();
    const directory = playerB.locator('.window').filter({ hasText: 'CHARACTERS' });
    await directory.getByRole('button', { name: /星痕测试角色/ }).click();
    await expect(
      playerB.locator('.grid-card').filter({ hasText: '战力' }).getByText('32', { exact: true }),
    ).toBeVisible();
    await gm.getByRole('button', { name: '骰子', exact: true }).click();
    await gm.getByRole('textbox', { name: '掷骰表达式' }).fill('1d37');
    await gm.getByRole('button', { name: '掷出骰子' }).click();
    await expect(gm.locator('.dice-result-number')).toBeVisible();
    const secretReason = `玩家私密检定 ${randomUUID().slice(0, 8)}`;
    await playerA.locator('.game-rail').getByRole('button', { name: '骰子' }).click();
    const playerDice = playerA.locator('.window').filter({ hasText: 'THE DICE DECIDE' });
    await playerDice.getByLabel('可见范围').selectOption('PRIVATE');
    await playerDice.getByLabel('掷骰原因').fill(secretReason);
    await playerDice.getByRole('button', { name: '掷出骰子' }).click();
    await expect(playerDice.getByText(secretReason).first()).toBeVisible();
    await expect(
      gm
        .locator('.window')
        .filter({ hasText: 'THE DICE DECIDE' })
        .locator('.dice-history')
        .filter({ hasText: secretReason }),
    ).toBeVisible();
    await playerB.locator('.game-rail').getByRole('button', { name: '骰子' }).click();
    await expect(playerB.locator('.window').filter({ hasText: 'THE DICE DECIDE' }).getByText(secretReason)).toHaveCount(
      0,
    );
    await gm.locator('.game-rail').getByRole('button', { name: '战斗' }).click();
    await gm.getByPlaceholder(/我挥剑攻击/).fill('人工裁定：目标生命减少 7');
    await gm.getByRole('button', { name: '保存记录' }).click();
    await playerB.locator('.game-rail').getByRole('button', { name: '战斗' }).click();
    await expect(playerB.getByText('人工裁定：目标生命减少 7')).toBeVisible();
    const snapshot = await (await gmContext.request.get(api + `/rooms/${room.id}/snapshot`)).json();
    const target = snapshot.characters.find((character: { id: string }) => character.id === npc.id);
    await op(gmContext, room.id, 'character.field.adjust', {
      characterId: npc.id,
      fieldId: 'hp',
      version: target.version,
      delta: -7,
      reason: '人工裁定',
    });
    const after = await (await bContext.request.get(api + `/rooms/${room.id}/snapshot`)).json();
    expect(after.characters.find((character: { id: string }) => character.id === npc.id).derived.values.hp).toBe(13);
    await aContext.clearCookies();
    await playerA.goto(`/rooms/${room.id}`);
    await expect(playerA).toHaveURL(/\/login$/);
    await playerA.getByRole('textbox', { name: '冒险者名称' }).fill('demo-player-1');
    await playerA.getByRole('textbox', { name: '密码' }).fill('demo12345');
    await playerA.getByRole('button', { name: '进入冒险' }).click();
    await expect(playerA).toHaveURL(/\/rooms$/);
    const relogged = await (await aContext.request.get(api + '/auth/me')).json();
    expect(relogged.id).toBe(owner.id);
    await playerA.goto(`/rooms/${room.id}`);
    await playerA.reload();
    await playerA.locator('.hero-chip').filter({ hasText: '星痕测试角色' }).click();
    await expect(
      playerA.locator('.grid-card').filter({ hasText: '战力' }).getByText('32', { exact: true }),
    ).toBeVisible();
  } finally {
    await Promise.all([gmContext.close(), aContext.close(), bContext.close()]);
    if (roomId) {
      const room = await db.room.findUnique({ where: { id: roomId }, select: { name: true } }).catch(() => null);
      if (room?.name.startsWith('E2E v3 ')) await db.room.delete({ where: { id: roomId } });
    }
    await db.$disconnect();
  }
});
