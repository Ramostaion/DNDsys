import { test, expect, type BrowserContext } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { api } from './server-address';

config({ path: 'apps/api/.env', quiet: true });
test('能力默认技能和分类顺序、人物卡三类悬停详情、私密撤回与状态库可恢复删除', async ({ browser }, info) => {
  test.setTimeout(240000);
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ viewport: { width: 1300, height: 950 } })));
  const db = new PrismaClient(),
    prefix = `ability-hover-${randomUUID().slice(0, 8)}`,
    users: any[] = [];
  let roomId: string | undefined;
  const post = async (context: BrowserContext, path: string, data: unknown, status = 200) => {
    const response = await context.request.post(api + path, { data });
    expect(response.status(), await response.text()).toBe(status);
    return response.json();
  };
  const op = (type: string, payload: any, status = 200) =>
    post(contexts[0], `/rooms/${roomId}/operations`, { id: randomUUID(), type, payload }, status);
  const snap = async (context = contexts[0]) => (await context.request.get(`${api}/rooms/${roomId}/snapshot`)).json();
  try {
    for (const [i, c] of contexts.entries())
      users.push(await post(c, '/auth/register', { username: `${prefix}-${i}`, password: randomUUID() }));
    const room = await post(contexts[0], '/rooms', { name: prefix }, 201);
    roomId = room.id;
    await post(contexts[1], '/rooms/join', { inviteCode: room.inviteCode });
    await op('sheet.field.upsert', {
      version: (await snap()).room.version,
      field: { fieldId: 'int', name: '智力', type: 'number', defaultValue: 15 },
    });
    const hero = await op('character.create', { name: '星火旅人', ownerId: users[1].id });
    const skill = await op('template.create', {
      kind: 'SKILL',
      name: '星火步',
      description: '沿着微光跃向下一处落点。',
      data: {
        customFields: [
          { name: '距离', value: 9 },
          { name: '耗时', value: '一个动作' },
        ],
      },
    });
    const trait = await op('template.create', {
      kind: 'TRAIT',
      name: '夜行者',
      description: '黑暗中仍能辨认星光。',
      data: { modifierRows: [{ targetFieldId: 'int', operation: 'ADD', value: 2 }] },
    });
    for (const template of [skill, trait])
      await op('template.apply', { characterId: hero.id, templateId: template.id });
    const definition = await op('tagDefinition.create', {
      name: '灵光祝福',
      icon: 'star',
      color: '#d4af57',
      templateDescription: '**灵光**照耀着这位旅人。\n\n' + '维持专注，观察周围的古老符文。\n'.repeat(45),
      customFields: [{ name: '智力', value: 3 }],
    });
    let state = await op('characterTag.attach', {
      characterId: hero.id,
      tagDefinitionId: definition.id,
      definitionVersion: definition.version,
    });
    const secret = await op('tagDefinition.create', {
      name: '秘密契约',
      icon: 'secret',
      color: '#b56ce2',
      defaultVisibility: 'GM_ONLY',
      templateDescription: '绝不可出现在玩家悬停卡中的内容',
    });
    await op('characterTag.attach', {
      characterId: hero.id,
      tagDefinitionId: secret.id,
      definitionVersion: secret.version,
    });
    const [gm, player] = await Promise.all(contexts.map((c) => c.newPage())),
      errors: string[] = [];
    for (const p of [gm, player]) {
      p.on('pageerror', (e) => errors.push(e.message));
      await p.goto(`/rooms/${roomId}`);
      await expect(p.getByTitle('已连接', { exact: true })).toBeVisible();
    }
    await gm.locator('.game-rail button[title="能力"]').click();
    const library = gm.locator('.template-library'),
      filter = library.getByRole('group', { name: '能力类型筛选', exact: true });
    await expect(filter.getByRole('button')).toHaveText(['全部', '技能', '特性', '特殊机制']);
    await expect(filter.getByRole('button', { name: '技能', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await filter.getByRole('button', { name: '全部', exact: true }).click();
    await library.getByRole('button', { name: '新建', exact: true }).click();
    await expect(library.locator('.template-editor').getByLabel('类型', { exact: true })).toHaveValue('SKILL');
    await expect(library.locator('.template-editor').getByLabel('类型', { exact: true }).locator('option')).toHaveText([
      '技能',
      '特性',
      '特殊机制',
    ]);
    await library.locator('.template-editor').getByRole('button', { name: '取消', exact: true }).click();
    await gm.getByRole('button', { name: '关闭能力模板库', exact: true }).click();
    await player.locator('.game-rail button[title="角色"]').click();
    await player.getByRole('button', { name: '星火旅人', exact: true }).click();
    await player.getByRole('button', { name: '关闭角色', exact: true }).click();
    const skills = player.locator('.character-skills');
    await skills.getByLabel('技能：星火步', { exact: true }).hover();
    let tooltip = player.getByRole('tooltip', { name: '技能详情：星火步', exact: true });
    await expect(tooltip).toContainText('沿着微光跃向下一处落点。');
    await expect(tooltip).toContainText('距离');
    await expect(tooltip).toContainText('9');
    await expect(tooltip).toContainText('一个动作');
    expect(await tooltip.locator('input,select,textarea,button').count()).toBe(0);
    await player.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await skills.getByLabel('技能：星火步', { exact: true }).focus();
    await expect(tooltip).toBeVisible();
    await player.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await skills.getByRole('button', { name: '状态：灵光祝福', exact: true }).hover();
    tooltip = player.getByRole('tooltip', { name: '状态详情：灵光祝福', exact: true });
    await expect(tooltip.locator('strong')).toContainText('灵光');
    await expect(tooltip).toContainText('智力');
    await expect(tooltip).toContainText('3');
    await tooltip.hover();
    await tooltip.evaluate((el) => (el.scrollTop = el.scrollHeight));
    expect(await tooltip.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const bounds = (await tooltip.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(950);
    await player.screenshot({ path: info.outputPath('character-ability-hover.png'), animations: 'disabled' });
    await op('characterTag.update', {
      id: state.id,
      version: state.version,
      detailsMarkdown: '现已转为仅GM可见的秘密祝福',
      visibility: 'GM_ONLY',
      priority: 0,
    });
    await expect(tooltip).toHaveCount(0);
    await expect(skills.getByRole('button', { name: '状态：灵光祝福', exact: true })).toHaveCount(0);
    expect(JSON.stringify(await snap(contexts[1]))).not.toContain('现已转为仅GM可见的秘密祝福');
    await expect(skills.getByRole('button', { name: '状态：秘密契约', exact: true })).toHaveCount(0);
    state = (await snap()).characterTags.find((t: any) => t.id === state.id);
    await op('characterTag.update', {
      id: state.id,
      version: state.version,
      detailsMarkdown: '公开的灵光祝福说明',
      visibility: 'PUBLIC',
      priority: 0,
    });
    await expect(skills.getByRole('button', { name: '状态：灵光祝福', exact: true })).toBeVisible();
    await skills.getByLabel('特性：夜行者', { exact: true }).hover();
    tooltip = player.getByRole('tooltip', { name: '特性详情：夜行者', exact: true });
    await expect(tooltip).toContainText('黑暗中仍能辨认星光。');
    await expect(tooltip).toContainText('已启用');
    await expect(tooltip).toContainText('+2');
    await skills.getByRole('button', { name: '停用特性：夜行者', exact: true }).click();
    await expect(skills.getByRole('button', { name: '启用特性：夜行者', exact: true })).toBeVisible();
    await skills.getByLabel('特性：夜行者', { exact: true }).hover();
    await expect(tooltip).toContainText('已停用');
    await player.keyboard.press('Escape');
    await gm.locator('.game-rail button[title="状态"]').click();
    const states = gm.locator('.tag-library'),
      row = states.locator('.tag-definition-row').filter({ hasText: '灵光祝福' });
    gm.once('dialog', (dialog) => dialog.dismiss());
    await row.getByRole('button', { name: '删除状态', exact: true }).click();
    await expect(row).toBeVisible();
    gm.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('角色状态及独立备注会保留');
      await dialog.accept();
    });
    await row.getByRole('button', { name: '删除状态', exact: true }).click();
    await expect(row).toHaveCount(0);
    expect((await snap()).characterTags.some((t: any) => t.id === state.id)).toBe(true);
    await expect(skills.getByRole('button', { name: '状态：灵光祝福', exact: true })).toBeVisible();
    const deleted = (await snap()).tagDefinitions.find((d: any) => d.id === definition.id);
    await op(
      'characterTag.attach',
      { characterId: hero.id, tagDefinitionId: definition.id, definitionVersion: deleted.version },
      409,
    );
    await states.getByLabel('显示已删除状态', { exact: true }).check();
    await expect(row).toContainText('已从状态库删除');
    await row.getByRole('button', { name: '恢复状态', exact: true }).click();
    await expect(row.getByRole('button', { name: '删除状态', exact: true })).toBeVisible();
    expect((await snap()).tagDefinitions.find((d: any) => d.id === definition.id).isArchived).toBe(false);

    // Avatar, map and turn HUD all read the same current permission-filtered instance.
    state = (await snap()).characterTags.find((t: any) => t.id === state.id);
    state = await op('characterTag.update', {
      ...state,
      romanNumeral: 'III',
      remainingTurns: 3,
      detailsMarkdown: '**灵光**守护这位旅人。\n\n' + '维持专注，观察周围的古老符文。\n'.repeat(35),
      customFields: [
        { name: '智力', value: 3 },
        { name: '解除方式', value: '完成仪式或由主持人解除' },
      ],
    });
    const avatar = player
      .locator('.tag-avatar-badge')
      .filter({ has: player.locator('svg') })
      .first();
    await expect(avatar).toHaveAttribute('aria-label', '状态：灵光祝福 III');
    await avatar.hover();
    const stateTip = player.getByRole('tooltip', { name: '状态详情：灵光祝福 III', exact: true });
    await expect(stateTip).toContainText('星火旅人');
    await expect(stateTip).toContainText('剩余 3 回合');
    await expect(stateTip).toContainText('完成仪式或由主持人解除');
    await expect(stateTip.locator('.state-roman')).toHaveText('III');
    expect(await stateTip.locator('input,select,textarea,button').count()).toBe(0);
    await stateTip.hover();
    await stateTip.evaluate((el) => (el.scrollTop = el.scrollHeight));
    expect(await stateTip.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await player.screenshot({ path: info.outputPath('state-avatar-hover.png'), animations: 'disabled' });
    await player.keyboard.press('Escape');
    await avatar.focus();
    await expect(stateTip).toBeVisible();
    state = await op('characterTag.update', {
      ...state,
      detailsMarkdown:
        '**灵光**沿着古老符文流转，为旅人带来清醒与洞察。\n\n- 保持专注，洞悉眼前的线索。\n- 持续时间结束或被解除后，祝福消散。',
    });
    await expect(stateTip).toContainText('祝福消散');
    await avatar.click();
    const detail = player.locator('.tag-detail-view');
    await expect(detail.locator('h2 .state-roman')).toHaveText('III');
    await expect(detail.getByRole('heading', { name: '状态说明', exact: true })).toBeVisible();
    await expect(detail.getByRole('heading', { name: '状态词条', exact: true })).toBeVisible();
    await expect(detail.getByRole('button')).toHaveCount(0);
    await expect(stateTip).toHaveCount(0);
    await player.screenshot({ path: info.outputPath('state-details-player.png'), animations: 'disabled' });
    await player.setViewportSize({ width: 480, height: 880 });
    expect(await detail.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await player.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await player.screenshot({ path: info.outputPath('state-details-narrow.png'), animations: 'disabled' });
    await player.getByRole('button', { name: '关闭状态详情', exact: true }).click();
    await expect(detail).toHaveCount(0);
    await player.getByRole('button', { name: '关闭人物卡', exact: true }).click();
    await player.setViewportSize({ width: 1300, height: 950 });
    await gm.getByRole('button', { name: '关闭状态库', exact: true }).click();
    await gm.locator('.game-rail button[title="角色"]').click();
    await gm.getByRole('button', { name: '星火旅人', exact: true }).click();
    await gm.locator('.game-rail button[title="角色"]').click();
    await expect(gm.getByRole('button', { name: '关闭角色', exact: true })).toHaveCount(0);
    await gm.locator('.tag-avatar-badge[aria-label="状态：灵光祝福 III"]').click();
    const gmDetail = gm.locator('.tag-detail-view');
    await expect(gmDetail.getByRole('button', { name: '编辑此角色备注', exact: true })).toBeVisible();
    await expect(gmDetail.getByRole('button', { name: '管理角色状态', exact: true })).toBeVisible();
    await gmDetail.locator('.state-detail-actions').scrollIntoViewIfNeeded();
    await gm.screenshot({ path: info.outputPath('state-details-gm.png'), animations: 'disabled' });
    await gm.getByRole('button', { name: '关闭状态详情', exact: true }).click();
    await expect(gmDetail).toHaveCount(0);
    await gm.getByRole('button', { name: '关闭人物卡', exact: true }).click();

    const map = await op('map.create', { name: '状态悬停地图', width: 1400, height: 900 });
    await op('map.activate', { id: map.id });
    const token = await op('token.create', { mapId: map.id, characterId: hero.id, x: 450, y: 350 });
    await expect(player.locator('.konvajs-content canvas').first()).toBeVisible();
    const marker = () =>
      player.evaluate((id: string) => {
        const stage = (window as any).Konva.stages.find((s: any) => s.container().isConnected),
          mark = stage.findOne('#' + id)?.findOne('.token-state-badge');
        if (!mark) return null;
        const at = mark.getAbsolutePosition(),
          rect = stage.container().getBoundingClientRect();
        return { x: at.x + rect.left, y: at.y + rect.top };
      }, token.id);
    await expect.poll(marker).not.toBeNull();
    let point = (await marker())!;
    await player.mouse.move(point.x, point.y);
    await expect(stateTip).toContainText('灵光');
    await expect(stateTip).toContainText('智力');
    await expect(player.getByRole('tooltip', { name: '角色概览', exact: true })).toHaveCount(0);
    await player.screenshot({ path: info.outputPath('state-map-hover.png'), animations: 'disabled' });
    await player.mouse.click(point.x, point.y);
    await expect(detail).toContainText('状态说明');
    await expect(stateTip).toHaveCount(0);
    await player.getByRole('button', { name: '关闭状态详情', exact: true }).click();
    await expect(detail).toHaveCount(0);
    point = (await marker())!;
    await player.mouse.move(point.x, point.y);
    await expect(stateTip).toBeVisible();
    await player.mouse.wheel(0, 120);
    await expect(stateTip).toHaveCount(0);
    point = (await marker())!;
    await player.mouse.move(point.x + 60, point.y + 60);
    await player.mouse.move(point.x, point.y);
    await expect(stateTip).toBeVisible();
    await player.keyboard.press('Escape');
    const preset = await op('initiative.preset.save', {
      name: '悬停先手',
      weights: [{ fieldId: 'int', weight: 100, min: 0, max: 30, missing: 'BLOCK' }],
    });
    await op('initiative.preset.select', { id: preset.id, version: (await snap()).room.version });
    await op('turn.start', { mapId: map.id, tokenIds: [token.id] });
    const hudState = player.getByLabel('星火旅人：灵光祝福 III 剩余 3 回合', { exact: true });
    await hudState.hover();
    await expect(stateTip).toContainText('完成仪式或由主持人解除');
    await player.screenshot({ path: info.outputPath('state-hud-hover.png'), animations: 'disabled' });
    const unchanged = (await snap()).characterTags.find((t: any) => t.id === state.id);
    expect(unchanged.version).toBe(state.version);
    expect(unchanged.remainingTurns).toBe(3);
    await op('characterTag.update', { ...unchanged, visibility: 'GM_ONLY', detailsMarkdown: '已撤回的状态私密正文' });
    await expect(stateTip).toHaveCount(0);
    await expect(hudState).toHaveCount(0);
    expect(JSON.stringify(await snap(contexts[1]))).not.toContain('已撤回的状态私密正文');
    const currentState = (await snap()).characterTags.find((t: any) => t.id === state.id);
    await op('characterTag.update', { ...currentState, visibility: 'PUBLIC', detailsMarkdown: '恢复公开的状态说明' });
    await hudState.focus();
    await expect(stateTip).toContainText('恢复公开的状态说明');
    const finalState = (await snap()).characterTags.find((t: any) => t.id === state.id);
    await op('characterTag.detach', { id: finalState.id, version: finalState.version });
    await expect(stateTip).toHaveCount(0);
    await expect(hudState).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    if (roomId) await db.room.deleteMany({ where: { id: roomId, name: prefix } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
