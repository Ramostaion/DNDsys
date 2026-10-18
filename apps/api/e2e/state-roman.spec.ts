import { test, expect, type BrowserContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { api } from './server-address';
config({ path: 'apps/api/.env', quiet: true });

test('状态罗马数字：默认、独立修改、金色人物卡及详情、持久化和权限', async ({ browser }, info) => {
  test.setTimeout(180000);
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 1500, height: 1050 } }))),
    db = new PrismaClient(),
    prefix = `state-roman-${randomUUID().slice(0, 8)}`,
    users: any[] = [];
  let roomId = '';
  const post = async (c: BrowserContext, path: string, data: unknown, status = 200) => {
    const r = await c.request.post(api + path, { data });
    expect(r.status(), await r.text()).toBe(status);
    return r.json();
  };
  const op = (type: string, payload: any, status = 200, c = contexts[0]) =>
    post(c, `/rooms/${roomId}/operations`, { id: randomUUID(), type, payload }, status);
  const snap = async (c = contexts[0]) => (await c.request.get(`${api}/rooms/${roomId}/snapshot`)).json();
  try {
    for (const [i, c] of contexts.entries())
      users.push(await post(c, '/auth/register', { username: `${prefix}-${i}`, password: randomUUID() }));
    const room = await post(contexts[0], '/rooms', { name: prefix }, 201);
    roomId = room.id;
    await post(contexts[1], '/rooms/join', { inviteCode: room.inviteCode });
    await op('sheet.field.upsert', {
      version: (await snap()).room.version,
      field: { fieldId: 'dex', name: '敏捷', type: 'number', defaultValue: 12 },
    });
    const hero = await op('character.create', { name: '符文旅人', ownerId: users[1].id }),
      other = await op('character.create', { name: '另一位旅人' });
    const [gm, player] = await Promise.all(contexts.map((c) => c.newPage())),
      errors: string[] = [];
    for (const page of [gm, player]) {
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`/rooms/${roomId}`);
      await expect(page.getByTitle('已连接', { exact: true })).toBeVisible();
    }
    await gm.locator('.game-rail button[title="状态"]').click();
    await gm.getByRole('button', { name: '新建状态定义', exact: true }).click();
    const editor = gm.locator('.tag-definition-editor');
    await editor.getByLabel('状态名称', { exact: true }).fill('灵光祝福');
    expect(await editor.getByLabel('罗马数字', { exact: true }).locator('option').allTextContents()).toEqual([
      '无',
      'I',
      'II',
      'III',
      'IV',
      'V',
      'VI',
      'VII',
      'VIII',
      'IX',
      'X',
    ]);
    await expect(editor.getByLabel('罗马数字', { exact: true })).toHaveValue('');
    await editor.getByLabel('罗马数字', { exact: true }).selectOption('III');
    await expect(editor.locator('.state-roman')).toHaveText('III');
    await editor.getByLabel('持续回合数持续方式', { exact: true }).selectOption('finite');
    await editor.getByLabel('持续回合数', { exact: true }).fill('3');
    await editor.getByRole('button', { name: '添加自定义词条', exact: true }).click();
    await editor.getByLabel('词条名称 1', { exact: true }).fill('敏捷');
    await editor.getByLabel('词条类型 1', { exact: true }).selectOption('number');
    await editor.getByLabel('词条内容 1', { exact: true }).fill('2');
    await editor.getByRole('button', { name: '保存状态定义', exact: true }).click();
    await expect(editor).toHaveCount(0);
    let definition = (await snap()).tagDefinitions.find((d: any) => d.name === '灵光祝福');
    expect(definition.romanNumeral).toBe('III');
    await expect(gm.locator('.tag-definition-row').filter({ hasText: '灵光祝福' }).locator('.state-roman')).toHaveText(
      'III',
    );
    await gm.getByRole('button', { name: '关闭状态库', exact: true }).click();
    await gm.locator('.game-rail button[title="角色"]').click();
    await gm.getByRole('button', { name: '符文旅人', exact: true }).click();
    await gm.locator('.game-rail button[title="角色"]').click();
    await expect(gm.getByRole('button', { name: '关闭角色', exact: true })).toHaveCount(0);
    await gm.locator('.sheet-actions').getByRole('button', { name: '管理状态', exact: true }).click();
    await gm.getByRole('button', { name: '关闭人物卡', exact: true }).click();
    const manager = gm.locator('.tag-manager');
    await manager.getByRole('button', { name: '从状态库选择', exact: true }).click();
    await manager.getByRole('button', { name: '灵光祝福', exact: false }).click();
    const attach = manager.locator('.tag-attach-form');
    await expect(attach.getByLabel('罗马数字', { exact: true })).toHaveValue('III');
    await attach.getByLabel('罗马数字', { exact: true }).selectOption('IV');
    await attach.getByRole('button', { name: '添加到此角色', exact: true }).click();
    await expect(attach).toHaveCount(0);
    await expect(manager.locator('.attached-tag-list .state-roman')).toHaveText('IV');
    let state = (await snap()).characterTags.find((t: any) => t.characterId === hero.id);
    expect(state.romanNumeral).toBe('IV');
    expect(state.remainingTurns).toBe(3);
    const second = await op('characterTag.attach', {
      characterId: other.id,
      tagDefinitionId: definition.id,
      definitionVersion: definition.version,
    });
    expect(second.romanNumeral).toBe('III');
    await player.locator('.game-rail button[title="角色"]').click();
    await player.getByRole('button', { name: '符文旅人', exact: true }).click();
    await player.locator('.game-rail button[title="角色"]').click();
    await expect(player.getByRole('button', { name: '关闭角色', exact: true })).toHaveCount(0);
    const badge = player
      .getByLabel('人物状态', { exact: true })
      .getByRole('button', { name: '状态：灵光祝福 IV', exact: true });
    await expect(badge.locator('.state-roman')).toHaveText('IV');
    expect(await badge.locator('.state-roman').evaluate((e) => getComputedStyle(e).color)).toBe('rgb(212, 175, 87)');
    expect(await badge.locator('.state-roman').evaluate((e) => getComputedStyle(e).fontFamily)).toContain('Palatino');
    await badge.hover();
    const hover = player.getByRole('tooltip').filter({ hasText: '灵光祝福' });
    await expect(hover.locator('h3 .state-roman')).toHaveText('IV');
    await player.keyboard.press('Escape');
    await badge.click();
    await expect(player.locator('.tag-detail-view h2 .state-roman')).toHaveText('IV');
    await gm.getByRole('button', { name: '关闭角色状态', exact: true }).click();
    await gm.locator('.game-rail button[title="角色"]').click();
    await gm.getByRole('button', { name: '符文旅人', exact: true }).click();
    await gm.locator('.game-rail button[title="角色"]').click();
    await expect(gm.getByRole('button', { name: '关闭角色', exact: true })).toHaveCount(0);
    await gm
      .getByLabel('人物状态', { exact: true })
      .getByRole('button', { name: '状态：灵光祝福 IV', exact: true })
      .click();
    await gm.locator('.tag-detail-view').getByRole('button', { name: '编辑此角色备注', exact: true }).click();
    const instance = gm.locator('.tag-editor');
    await instance.getByLabel('罗马数字', { exact: true }).selectOption('V');
    await instance.getByRole('button', { name: '保存角色备注', exact: true }).click();
    await expect(instance.getByRole('status')).toContainText('保存成功');
    await expect(player.locator('.tag-detail-view h2 .state-roman')).toHaveText('V');
    let snapshot = await snap();
    state = snapshot.characterTags.find((t: any) => t.id === state.id);
    expect(state.romanNumeral).toBe('V');
    expect(state.remainingTurns).toBe(3);
    expect(snapshot.characters.find((c: any) => c.id === hero.id).derived.values.dex).toBe(14);
    expect(snapshot.characterTags.find((t: any) => t.id === second.id).romanNumeral).toBe('III');
    await op('characterTag.update', { ...state, romanNumeral: 'XI' }, 400);
    await op('characterTag.update', { ...state, romanNumeral: 'X' }, 403, contexts[1]);
    await op('tagDefinition.update', { ...definition, romanNumeral: 'XI' }, 400);
    await op('tagDefinition.update', { ...definition, romanNumeral: 'II' });
    definition = (await snap()).tagDefinitions.find((d: any) => d.id === definition.id);
    expect((await snap()).characterTags.find((t: any) => t.id === state.id).romanNumeral).toBe('V');
    // An old client omitting this optional field must preserve the saved numeral.
    const { romanNumeral: _numeral, ...oldPayload } = state;
    await op('characterTag.update', oldPayload);
    state = (await snap()).characterTags.find((t: any) => t.id === state.id);
    expect(state.romanNumeral).toBe('V');
    await gm.reload();
    await expect(gm.getByTitle('已连接', { exact: true })).toBeVisible();
    await gm.locator('.game-rail button[title="角色"]').click();
    await gm.getByRole('button', { name: '符文旅人', exact: true }).click();
    await gm.locator('.game-rail button[title="角色"]').click();
    await expect(gm.getByRole('button', { name: '关闭角色', exact: true })).toHaveCount(0);
    await gm
      .getByLabel('人物状态', { exact: true })
      .getByRole('button', { name: '状态：灵光祝福 V', exact: true })
      .click();
    await gm.locator('.tag-detail-view').getByRole('button', { name: '编辑此角色备注', exact: true }).click();
    await instance.getByLabel('罗马数字', { exact: true }).selectOption('');
    await instance.getByRole('button', { name: '保存角色备注', exact: true }).click();
    await expect(player.locator('.tag-detail-view h2 .state-roman')).toHaveCount(0);
    await instance.getByLabel('罗马数字', { exact: true }).selectOption('X');
    await instance.getByRole('button', { name: '保存角色备注', exact: true }).click();
    await expect(player.locator('.tag-detail-view h2 .state-roman')).toHaveText('X');
    await player.getByRole('button', { name: '关闭状态详情', exact: true }).click();
    await expect(player.getByLabel('人物状态', { exact: true }).locator('.state-roman')).toHaveText('X');
    await expect(player.getByRole('button', { name: '关闭状态详情', exact: true })).toHaveCount(0);
    await player.screenshot({ path: info.outputPath('state-roman-character.png') });
    await player.reload();
    await expect(player.getByTitle('已连接', { exact: true })).toBeVisible();
    snapshot = await snap();
    state = snapshot.characterTags.find((t: any) => t.id === state.id);
    expect(state.romanNumeral).toBe('X');
    expect(state.remainingTurns).toBe(3);
    expect(snapshot.characters.find((c: any) => c.id === hero.id).derived.values.dex).toBe(14);
    const copy = await op('character.copy', { id: hero.id });
    expect((await snap()).characterTags.find((t: any) => t.characterId === copy.id).romanNumeral).toBe('X');
    const secret = await op('tagDefinition.create', {
      name: '不可见符文',
      romanNumeral: 'IX',
      icon: 'secret',
      color: '#c69452',
      defaultVisibility: 'GM_ONLY',
    });
    const privateState = await op('characterTag.attach', {
      characterId: hero.id,
      tagDefinitionId: secret.id,
      definitionVersion: secret.version,
    });
    const playerSnap = await snap(contexts[1]);
    expect(JSON.stringify(playerSnap)).not.toContain('不可见符文');
    expect(JSON.stringify(playerSnap)).not.toContain(privateState.id);
    expect(playerSnap.tagDefinitions).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    if (roomId) await db.room.deleteMany({ where: { id: roomId, name: prefix } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
