import { api } from './server-address';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
config({ path: 'apps/api/.env', quiet: true });

async function post(context: BrowserContext, path: string, data: unknown) {
  const response = await context.request.post(api + path, { data });
  const body = await response.json();
  expect(response.ok(), `${path}: ${JSON.stringify(body)}`).toBe(true);
  return body;
}
async function op(context: BrowserContext, roomId: string, type: string, payload: Record<string, unknown>) {
  return post(context, `/rooms/${roomId}/operations`, { id: randomUUID(), type, payload });
}
async function snapshot(context: BrowserContext, roomId: string) {
  return (await context.request.get(api + `/rooms/${roomId}/snapshot`)).json();
}
async function login(context: BrowserContext, name: string) {
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('冒险者名称').fill(name);
  await page.getByLabel('密码').fill('demo12345');
  await page.getByRole('button', { name: '进入冒险' }).click();
  await expect(page).toHaveURL(/\/rooms$/);
  return page;
}
async function openCharacter(page: Page, name: string) {
  await page.locator('.game-rail').getByRole('button', { name: '角色', exact: true }).click();
  await page.locator('.window').filter({ hasText: 'CHARACTERS' }).getByRole('button', { name, exact: true }).click();
  return page.locator('.window').filter({ has: page.locator('.character-sheet') });
}
async function openManager(page: Page, name: string) {
  const sheet = await openCharacter(page, name);
  await sheet.getByRole('button', { name: '管理标签' }).click();
  return page.locator('.window').filter({ has: page.locator('.tag-manager') });
}

test('阶段 A/B：三账号独立长备注、私密可见性、草稿与冲突、刷新重连', async ({ browser }) => {
  test.setTimeout(150_000);
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
  const db = new PrismaClient();
  let roomId: string | undefined;
  try {
    const [gm, a, b, gm2] = await Promise.all([
      login(contexts[0], 'demo-gm'),
      login(contexts[1], 'demo-player-1'),
      login(contexts[2], 'demo-player-2'),
      login(contexts[3], 'demo-gm'),
    ]);
    const room = await post(contexts[0], '/rooms', { name: `E2E tags ${randomUUID().slice(0, 8)}` });
    roomId = room.id;
    await Promise.all([
      post(contexts[1], '/rooms/join', { inviteCode: room.inviteCode }),
      post(contexts[2], '/rooms/join', { inviteCode: room.inviteCode }),
    ]);
    const ownerA = (await (await contexts[1].request.get(api + '/auth/me')).json()).id,
      ownerB = (await (await contexts[2].request.get(api + '/auth/me')).json()).id;
    const ca = await op(contexts[0], room.id, 'character.create', { name: '标记角色 A', ownerId: ownerA });
    const cb = await op(contexts[0], room.id, 'character.create', { name: '标记角色 B', ownerId: ownerB });
    await post(contexts[0], `/rooms/${room.id}/members/${ownerA}/permissions`, { characterBasics: true });
    const packets: string[] = [];
    b.on('websocket', (socket) => socket.on('framereceived', (frame) => packets.push(String(frame.payload))));
    await Promise.all([gm, a, b, gm2].map((p) => p.goto(`/rooms/${room.id}`)));
    const aSheet = await openCharacter(a, ca.name);
    const aDraft = aSheet.locator('.sheet-name');
    await aDraft.fill('玩家未保存角色名');
    let manager = await openManager(gm, ca.name);
    await manager.getByRole('button', { name: '添加标签', exact: true }).click();
    await manager.getByLabel('标签名称', { exact: true }).fill('受到诅咒');
    await manager.getByRole('button', { name: '图标：诅咒' }).click();
    await manager.getByLabel('备注初稿', { exact: true }).fill('仅作为新分配初稿');
    await manager.getByRole('button', { name: '保存标签定义' }).click();
    const secret = '# 地下室的秘密\n\n' + '第三次进入地下室时提醒 GM。\n'.repeat(180);
    await manager.getByLabel('角色专属详细备注').fill(secret);
    await manager.getByRole('button', { name: '预览备注' }).click();
    await expect(manager.getByRole('heading', { name: '地下室的秘密' })).toBeVisible();
    await manager.getByRole('button', { name: '继续编辑' }).click();
    await manager.getByRole('button', { name: '添加到此角色' }).click();
    await expect(manager.getByText('标签列表已更新')).toBeVisible();
    await expect(aDraft).toHaveValue('玩家未保存角色名');
    await expect(aDraft).toBeFocused();
    await expect(aSheet.getByRole('button', { name: '标签：受到诅咒', exact: true })).toHaveCount(0);
    expect(packets.every((packet) => !packet.includes('第三次进入地下室') && !packet.includes('受到诅咒'))).toBe(true);
    let data = await snapshot(contexts[0], room.id);
    const definition = data.tagDefinitions[0];
    let tag = data.characterTags.find((t: { characterId: string }) => t.characterId === ca.id);
    await gm.reload();
    manager = await openManager(gm, cb.name);
    await manager.getByRole('button', { name: '从标签库选择', exact: true }).click();
    await manager
      .locator('.tag-selection-list')
      .getByRole('button', { name: /受到诅咒/ })
      .click();
    await manager.getByLabel('角色专属详细备注').fill('接触古书后出现幻觉');
    await manager.getByRole('button', { name: '添加到此角色' }).click();
    data = await snapshot(contexts[0], room.id);
    expect(data.characterTags.find((t: { characterId: string }) => t.characterId === ca.id).detailsMarkdown).toBe(
      secret,
    );
    expect(data.characterTags.find((t: { characterId: string }) => t.characterId === cb.id).detailsMarkdown).toBe(
      '接触古书后出现幻觉',
    );
    tag = await op(contexts[0], room.id, 'characterTag.update', {
      id: tag.id,
      version: tag.version,
      detailsMarkdown: secret,
      visibility: 'OWNER',
      priority: 10,
    });
    await expect(aSheet.getByRole('button', { name: '标签：受到诅咒', exact: true })).toBeVisible();
    const bSheet = await openCharacter(b, ca.name);
    await expect(bSheet.getByRole('button', { name: '标签：受到诅咒', exact: true })).toHaveCount(0);
    tag = await op(contexts[0], room.id, 'characterTag.update', {
      id: tag.id,
      version: tag.version,
      detailsMarkdown: '公开线索说明',
      visibility: 'PUBLIC',
      priority: 10,
    });
    await expect(bSheet.getByRole('button', { name: '标签：受到诅咒', exact: true })).toBeVisible();
    await bSheet.getByRole('button', { name: '标签：受到诅咒', exact: true }).click();
    const detail = b.locator('.window').filter({ has: b.locator('.tag-detail-view') });
    await expect(detail.getByText('公开线索说明')).toBeVisible();
    tag = await op(contexts[0], room.id, 'characterTag.update', {
      id: tag.id,
      version: tag.version,
      detailsMarkdown: '撤回后秘密',
      visibility: 'GM_ONLY',
      priority: 10,
    });
    await expect(b.getByText('公开线索说明')).toHaveCount(0);
    await expect(b.getByText('此标签已移除，或当前账号没有查看权限。')).toBeVisible();
    await expect(bSheet.getByRole('button', { name: '标签：受到诅咒', exact: true })).toHaveCount(0);
    await gm.reload();
    const gmSheet = await openCharacter(gm, ca.name);
    await gmSheet.getByRole('button', { name: '标签：受到诅咒', exact: true }).click();
    const gmDetail = gm.locator('.window').filter({ has: gm.locator('.tag-detail-view') });
    await gmDetail.getByRole('button', { name: '编辑此角色备注' }).click();
    const editor = gm.locator('.window').filter({ has: gm.locator('.tag-editor') });
    const note = editor.getByLabel('角色专属详细备注');
    await note.fill('未提交的 GM 草稿');
    tag = await op(contexts[3], room.id, 'characterTag.update', {
      id: tag.id,
      version: tag.version,
      detailsMarkdown: '第二窗口已保存',
      visibility: 'GM_ONLY',
      priority: 10,
    });
    await expect(editor.getByText(/其他窗口已更新此备注/)).toBeVisible();
    await expect(note).toHaveValue('未提交的 GM 草稿');
    await expect(editor.getByRole('button', { name: '保存角色备注' })).toBeDisabled();
    gm.once('dialog', (dialog) => dialog.dismiss());
    await editor.getByRole('button', { name: '关闭标签详情' }).click();
    await expect(note).toHaveValue('未提交的 GM 草稿');
    gm.once('dialog', (dialog) => dialog.accept());
    await editor.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(note).toHaveValue('第二窗口已保存');
    await note.fill(secret + '\n重新编辑后保存');
    await gm.route('**/api/rooms/*/operations', (route) => route.abort());
    await editor.getByRole('button', { name: '保存角色备注' }).click();
    await expect(editor.getByRole('alert')).toContainText('草稿已保留');
    await expect(note).toHaveValue(secret + '\n重新编辑后保存');
    await gm.unroute('**/api/rooms/*/operations');
    await editor.getByRole('button', { name: '保存角色备注' }).click();
    await expect(editor.getByRole('status')).toHaveText('保存成功');
    await gm.reload();
    const reloadedSheet = await openCharacter(gm, ca.name);
    await reloadedSheet.getByRole('button', { name: '标签：受到诅咒', exact: true }).click();
    await expect(gm.locator('.tag-detail-view .tag-markdown')).toContainText('重新编辑后保存');
    tag = (await snapshot(contexts[0], room.id)).characterTags.find((t: { id: string }) => t.id === tag.id);
    await contexts[1].setOffline(true);
    await expect(a.getByTitle('正在重连')).toBeVisible();
    await op(contexts[0], room.id, 'characterTag.update', {
      id: tag.id,
      version: tag.version,
      detailsMarkdown: '离线时公开的新线索',
      visibility: 'OWNER',
      priority: 10,
    });
    await contexts[1].setOffline(false);
    await expect(aSheet.getByRole('button', { name: '标签：受到诅咒', exact: true })).toBeVisible();
    await expect(aDraft).toHaveValue('玩家未保存角色名');
    await a.reload();
    await openCharacter(a, ca.name);
    await a.locator('.character-sheet').getByRole('button', { name: '标签：受到诅咒', exact: true }).click();
    await expect(a.locator('.tag-detail-view')).toContainText('离线时公开的新线索');
    expect((await snapshot(contexts[2], room.id)).characterTags).toHaveLength(0);
    expect((await snapshot(contexts[0], room.id)).tagDefinitions[0].id).toBe(definition.id);
    await gm.locator('.tag-detail-view').getByRole('button', { name: '编辑此角色备注' }).click();
    const removedEditor = gm.locator('.tag-editor');
    await removedEditor.getByLabel('角色专属详细备注').fill('被移除时仍要保留的草稿');
    const latest = (await snapshot(contexts[3], room.id)).characterTags.find((t: { id: string }) => t.id === tag.id);
    await op(contexts[3], room.id, 'characterTag.detach', { id: latest.id, version: latest.version });
    await expect(removedEditor.getByText(/此标签已被其他窗口移除/)).toBeVisible();
    await expect(removedEditor.getByLabel('角色专属详细备注')).toHaveValue('被移除时仍要保留的草稿');
    await expect(removedEditor.getByRole('button', { name: '保存角色备注' })).toBeDisabled();
    await expect(a.getByText('离线时公开的新线索')).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    if (roomId) {
      const room = await db.room.findUnique({ where: { id: roomId }, select: { name: true } });
      if (room?.name.startsWith('E2E tags ')) await db.room.delete({ where: { id: roomId } });
    }
    await db.$disconnect();
  }
});

test('阶段 C/D：标签库、总览、归档、批量独立分配、头像溢出与受控 Markdown', async ({ browser }) => {
  test.setTimeout(100_000);
  const context = await browser.newContext();
  const db = new PrismaClient();
  let roomId: string | undefined;
  try {
    const page = await login(context, 'demo-gm');
    const room = await post(context, '/rooms', { name: `E2E tags library ${randomUUID().slice(0, 8)}` });
    roomId = room.id;
    const ca = await op(context, room.id, 'character.create', { name: '总览角色 A' }),
      cb = await op(context, room.id, 'character.create', { name: '总览角色 B' });
    const definitions = [];
    for (let i = 0; i < 5; i++)
      definitions.push(
        await op(context, room.id, 'tagDefinition.create', {
          name: `线索 ${i}`,
          icon: 'clue',
          color: '#c69452',
          templateDescription: '独立初稿',
          defaultVisibility: 'PUBLIC',
          defaultPriority: i,
        }),
      );
    for (const d of definitions)
      await op(context, room.id, 'characterTag.attach', {
        characterId: ca.id,
        tagDefinitionId: d.id,
        definitionVersion: d.version,
        detailsMarkdown:
          d.name === '线索 4'
            ? '# 重要秘密\n**加粗** 与 *斜体*\n- 列表\n> 引用\n[安全链接](https://example.com)\n[危险链接](javascript:alert(1))\n<script>window.tagsXss=true</script>\n关键词：医院'
            : '普通备注',
      });
    await page.goto(`/rooms/${room.id}`);
    const sheet = await openCharacter(page, ca.name);
    const badges = sheet.locator('.tag-avatar-wrap');
    await expect(badges.locator('.tag-avatar-badge:not(.tag-overflow)')).toHaveCount(3);
    await expect(badges.getByRole('button', { name: '查看全部 5 个可见标签' })).toHaveText('+2');
    await badges.getByRole('button', { name: '标签：线索 4', exact: true }).click();
    const detail = page.locator('.tag-detail-view');
    await expect(detail.getByRole('heading', { name: '重要秘密' })).toBeVisible();
    await expect(detail.locator('strong').filter({ hasText: '加粗' })).toBeVisible();
    await expect(detail.getByRole('link', { name: '安全链接' })).toHaveAttribute('href', 'https://example.com/');
    await expect(detail.getByRole('link', { name: '危险链接' })).toHaveCount(0);
    await expect(detail.locator('script')).toHaveCount(0);
    await page.reload();
    await page.locator('.game-rail').getByRole('button', { name: '标签', exact: true }).click();
    const library = page.locator('.tag-library');
    await library.getByLabel('搜索标签库').fill('线索 0');
    await expect(library.locator('.tag-definition-row')).toHaveCount(1);
    await library.getByRole('button', { name: '批量分配' }).click();
    const batch = page.locator('.tag-attach-form');
    await batch.getByLabel(cb.name, { exact: false }).check();
    await batch.getByLabel('角色专属详细备注').fill('角色 B 的批量独立初稿');
    await batch.getByRole('button', { name: '分配给 1 个角色' }).click();
    const data = await snapshot(context, room.id);
    expect(data.characterTags.find((t: { characterId: string }) => t.characterId === cb.id).detailsMarkdown).toBe(
      '角色 B 的批量独立初稿',
    );
    expect(
      data.characterTags.find(
        (t: { characterId: string; tagDefinitionId: string }) =>
          t.characterId === ca.id && t.tagDefinitionId === definitions[0].id,
      ).detailsMarkdown,
    ).toBe('普通备注');
    page.once('dialog', (dialog) => dialog.accept());
    await library.getByRole('button', { name: '归档定义' }).click();
    await expect(library.locator('.tag-definition-row')).toHaveCount(0);
    await library.getByLabel('显示归档定义').check();
    await expect(library.locator('.tag-definition-row').getByText('已归档', { exact: false })).toBeVisible();
    await library.getByRole('button', { name: '恢复定义' }).click();
    await expect(library.getByRole('button', { name: '批量分配' })).toBeEnabled();
    await library.getByRole('button', { name: '角色标签总览' }).click();
    const overview = page.locator('.tag-overview-panel');
    await overview.getByLabel('搜索角色标签与详情').fill('医院');
    await expect(overview.locator('.tag-overview-row')).toHaveCount(1);
    await overview.getByLabel('按角色筛选').selectOption(cb.id);
    await expect(overview.locator('.tag-overview-row')).toHaveCount(0);
    await overview.getByLabel('按角色筛选').selectOption(ca.id);
    await overview.getByLabel('按优先级筛选').selectOption('high');
    await expect(overview.locator('.tag-overview-row')).toHaveCount(1);
    await overview.locator('.tag-overview-row').click();
    await expect(page.locator('.tag-detail-view')).toContainText('医院');
    await page.screenshot({ path: 'test-results/character-tags-detail.png', animations: 'disabled' });
    await page.setViewportSize({ width: 520, height: 760 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    const reducedSheet = await openCharacter(page, ca.name);
    expect(
      await reducedSheet
        .locator('.tag-avatar-badge')
        .first()
        .evaluate((el) => getComputedStyle(el).animationName),
    ).toBe('none');
    const badgeBox = await reducedSheet.locator('.tag-avatar-badge').first().boundingBox();
    expect(badgeBox!.x).toBeGreaterThanOrEqual(0);
    expect(badgeBox!.x + badgeBox!.width).toBeLessThan(520);
  } finally {
    await context.close();
    if (roomId) {
      const room = await db.room.findUnique({ where: { id: roomId }, select: { name: true } });
      if (room?.name.startsWith('E2E tags ')) await db.room.delete({ where: { id: roomId } });
    }
    await db.$disconnect();
  }
});

test('阶段 E：地图标记可打开详情，Token 拖动与换地图保留角色标签', async ({ browser }) => {
  const context = await browser.newContext();
  const db = new PrismaClient();
  let roomId: string | undefined;
  try {
    const page = await login(context, 'demo-gm');
    const room = await post(context, '/rooms', { name: `E2E tags map ${randomUUID().slice(0, 8)}` });
    roomId = room.id;
    const character = await op(context, room.id, 'character.create', { name: '地图标记角色' });
    const map = await op(context, room.id, 'map.create', { name: '标签地图', width: 1600, height: 900 });
    const other = await op(context, room.id, 'map.create', { name: '第二场景' });
    await op(context, room.id, 'map.activate', { id: map.id });
    const token = await op(context, room.id, 'token.create', {
      mapId: map.id,
      characterId: character.id,
      x: 700,
      y: 500,
    });
    const definition = await op(context, room.id, 'tagDefinition.create', {
      name: '地图诅咒',
      icon: 'curse',
      color: '#b56ce2',
      defaultVisibility: 'PUBLIC',
    });
    const tag = await op(context, room.id, 'characterTag.attach', {
      characterId: character.id,
      tagDefinitionId: definition.id,
      definitionVersion: definition.version,
      detailsMarkdown: '标记绑定角色，移动不丢失',
    });
    await page.goto(`/rooms/${room.id}`);
    await expect(page.getByText('标签地图', { exact: true })).toBeVisible();
    await expect(page.locator('.board-surface canvas').first()).toBeVisible();
    const box = (await page.locator('.board-surface').boundingBox())!;
    const scale = Math.min(1, box.width / 1600, box.height / 900);
    const origin = { x: box.x + Math.max(0, (box.width - 1600) / 2), y: box.y + Math.max(0, (box.height - 900) / 2) };
    const center = { x: origin.x + 700 * scale, y: origin.y + 500 * scale };
    await page.mouse.move(center.x, center.y);
    await page.mouse.down();
    await page.mouse.move(center.x + 60, center.y + 25, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(async () => {
        const data = await snapshot(context, room.id);
        return data.tokens.find((t: { id: string }) => t.id === token.id).version;
      })
      .toBe(1);
    const moved = (await snapshot(context, room.id)).tokens.find((t: { id: string }) => t.id === token.id);
    await page.mouse.move(origin.x + (moved.x + 25) * scale, origin.y + (moved.y - 23) * scale);
    await expect(page.locator('.board-surface [title="地图诅咒"]')).toHaveCount(1);
    await op(context, room.id, 'tagDefinition.update', {
      id: definition.id,
      version: definition.version,
      name: '更新的地图诅咒',
      icon: 'curse',
      color: '#b56ce2',
      defaultVisibility: 'PUBLIC',
    });
    await expect(page.locator('.board-surface [title="地图诅咒"]')).toHaveCount(0);
    await page.mouse.click(origin.x + (moved.x + 25) * scale, origin.y + (moved.y - 23) * scale);
    await expect(page.locator('.tag-detail-view')).toContainText('标记绑定角色，移动不丢失');
    const afterClick = (await snapshot(context, room.id)).tokens.find((t: { id: string }) => t.id === token.id);
    expect(afterClick.version).toBe(moved.version);
    await op(context, room.id, 'map.activate', { id: other.id });
    await expect(page.getByText('第二场景', { exact: true })).toBeVisible();
    expect(
      (await snapshot(context, room.id)).characterTags.find((t: { id: string }) => t.id === tag.id).characterId,
    ).toBe(character.id);
    await expect(page.locator('.tag-detail-view')).toContainText('标记绑定角色，移动不丢失');
  } finally {
    await context.close();
    if (roomId) {
      const room = await db.room.findUnique({ where: { id: roomId }, select: { name: true } });
      if (room?.name.startsWith('E2E tags ')) await db.room.delete({ where: { id: roomId } });
    }
    await db.$disconnect();
  }
});
