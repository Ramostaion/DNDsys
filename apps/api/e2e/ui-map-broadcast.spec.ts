import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { api } from './server-address';

config({ path: 'apps/api/.env' });
test('第二批 UI：本地棋子选择、四种量尺预览、连续广播排布与窄屏恢复', async ({ browser }, info) => {
  test.setTimeout(150_000);
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1600, height: 1050 } }),
    browser.newContext({ viewport: { width: 900, height: 700 }, reducedMotion: 'reduce' }),
  ]);
  const db = new PrismaClient(),
    prefix = `map-ui-${randomUUID().slice(0, 8)}`,
    users: { id: string; username: string }[] = [];
  let roomId: string | undefined;
  const post = async (context: BrowserContext, path: string, data: unknown) => {
    const result = await context.request.post(api + path, { data });
    expect(result.ok(), await result.text()).toBe(true);
    return result.json();
  };
  const op = (type: string, payload: Record<string, unknown>) =>
    post(contexts[0], `/rooms/${roomId}/operations`, { id: randomUUID(), type, payload });
  const snap = async () => (await contexts[0].request.get(`${api}/rooms/${roomId}/snapshot`)).json();
  const point = (page: Page, x: number, y: number) =>
    page.evaluate(
      ({ x, y }) => {
        const stage = (window as any).Konva.stages.find((s: any) => s.container().isConnected),
          p = stage.getAbsoluteTransform().point({ x, y }),
          box = stage.container().getBoundingClientRect();
        return { x: p.x + box.left, y: p.y + box.top };
      },
      { x, y },
    );
  try {
    for (const [index, context] of contexts.entries())
      users.push(await post(context, '/auth/register', { username: `${prefix}-${index}`, password: randomUUID() }));
    const room = await post(contexts[0], '/rooms', { name: prefix });
    roomId = room.id;
    await post(contexts[1], '/rooms/join', { inviteCode: room.inviteCode });
    await op('sheet.field.upsert', {
      version: (await snap()).room.version,
      field: { fieldId: 'dex', name: '敏捷', type: 'number', defaultValue: 12 },
    });
    const hero = await op('character.create', { name: '地图游侠', ownerId: users[1].id }),
      enemy = await op('character.create', { name: '地图守卫', isNpc: true });
    const map = await op('map.create', { name: '反馈地图', width: 1400, height: 900 });
    await op('map.activate', { id: map.id });
    const token = await op('token.create', { characterId: hero.id, mapId: map.id, x: 450, y: 350 });
    const pages = await Promise.all(contexts.map((context) => context.newPage())),
      [gm, player] = pages,
      errors: string[] = [];
    for (const page of pages) {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`/rooms/${roomId}`);
      await expect(page.locator('[title="已连接"]')).toBeVisible();
      await expect(page.locator('.konvajs-content canvas').first()).toBeVisible();
    }
    const selected = (page: Page) =>
      page.evaluate(() => {
        const stage = (window as any).Konva.stages.find((s: any) => s.container().isConnected);
        return stage.find('.token-selection-ring').length;
      });
    const origin = await point(gm, 450, 350);
    await gm.mouse.click(origin.x, origin.y);
    await expect.poll(() => selected(gm)).toBe(1);
    expect(await selected(player)).toBe(0);
    await expect(gm.locator('.map-selection-label')).toContainText('地图游侠');
    await gm.keyboard.press('Escape');
    await expect.poll(() => selected(gm)).toBe(0);
    for (const [shape, x, y] of [
      ['LINE', 350, 220],
      ['CIRCLE', 650, 400],
      ['SQUARE', 900, 500],
      ['CONE', 460, 350],
    ] as const) {
      await gm.locator('.board-tools').getByRole('button', { name: '量尺', exact: true }).click();
      await gm.getByLabel('量尺形状', { exact: true }).selectOption(shape);
      await gm.getByLabel('量尺距离', { exact: true }).fill('10');
      const at = await point(gm, x, y);
      await gm.mouse.move(at.x, at.y);
      const preview = await gm.evaluate(() => {
        const stage = (window as any).Konva.stages.find((s: any) => s.container().isConnected),
          preview = stage.findOne('.ruler-preview');
        return {
          visible: preview?.visible(),
          x: preview?.x(),
          y: preview?.y(),
          listening: preview?.listening(),
          line: preview?.findOne('Line')?.points(),
          circle: preview?.findOne('Circle')?.radius(),
          wedge: preview?.findOne('Wedge')?.radius(),
          side: preview?.findOne('Rect')?.width(),
        };
      });
      expect(preview.visible).toBe(true);
      expect(preview.listening).toBe(false);
      await expect(gm.locator('.character-hover-card')).toHaveCount(0);
      if (shape === 'LINE') expect(preview.line).toEqual([0, 0, 200, 0]);
      if (shape === 'CIRCLE') expect(preview.circle).toBe(100);
      if (shape === 'SQUARE') expect(preview.side).toBeCloseTo(200 / Math.SQRT2);
      if (shape === 'CONE') {
        expect(preview.wedge).toBe(200);
        expect(preview.x).toBeCloseTo(478);
        expect(preview.y).toBeCloseTo(350);
        await gm.screenshot({ path: info.outputPath('cone-preview.png') });
      }
      const reply = gm.waitForResponse(
        (response) =>
          response.url().endsWith('/operations') && response.request().postDataJSON()?.type === 'drawing.add',
      );
      await gm.mouse.click(at.x, at.y);
      expect((await reply).ok()).toBe(true);
      const saved = (await snap()).drawings.find((drawing: any) => drawing.data.shape === shape);
      expect(saved.data.x).toBeCloseTo(preview.x);
      expect(saved.data.y).toBeCloseTo(preview.y);
    }
    await gm.locator('.board-tools').getByRole('button', { name: '量尺', exact: true }).click();
    const cancelAt = await point(gm, 1050, 650);
    await gm.mouse.move(cancelAt.x, cancelAt.y);
    await gm.keyboard.press('Escape');
    await expect(gm.locator('.map-tool-status')).toContainText('平移地图');
    expect((await snap()).drawings).toHaveLength(4);
    await op('combat.start', { characterIds: [hero.id, enemy.id] });
    const first = await op('dice.roll', { expression: '1d20+3', reason: '布局验证', visibility: 'PUBLIC' });
    const combat = await op('combat.record', {
      kind: 'DECLARATION',
      actorId: hero.id,
      targetId: enemy.id,
      note: '同时广播',
    });
    async function layout(page: Page) {
      await expect(page.locator('.room-broadcasts')).toHaveAttribute('data-has-turn', 'true');
      await expect(page.locator('.public-dice-banner')).toBeVisible();
      await expect(page.locator('.combat-result-banner')).toBeVisible();
      const dice = (await page.locator('.public-dice-banner').boundingBox())!,
        record = (await page.locator('.combat-result-banner').boundingBox())!,
        turn = (await page.locator('.turn-banner').boundingBox())!;
      expect(record.y).toBeGreaterThanOrEqual(dice.y + dice.height + 6);
      expect(dice.y).toBeGreaterThanOrEqual(turn.y + turn.height);
      expect(dice.x).toBeGreaterThanOrEqual(78);
      expect(record.x + record.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(
        await page.locator('.room-broadcasts').evaluate((element) => getComputedStyle(element).pointerEvents),
      ).toBe('none');
    }
    for (const page of pages) {
      await expect(page.locator('.combat-result-banner')).toHaveAttribute('data-record-id', combat.id);
      await layout(page);
    }
    expect(
      await player.locator('.public-dice-banner').evaluate((element) => getComputedStyle(element).animationName),
    ).toBe('none');
    await gm.screenshot({ path: info.outputPath('broadcast-desktop.png') });
    const nextCombat = await op('combat.record', {
      kind: 'DECLARATION',
      actorId: enemy.id,
      targetId: hero.id,
      note: '连续广播',
    });
    await expect(gm.locator('.combat-result-banner')).toHaveAttribute('data-record-id', nextCombat.id);
    await expect(gm.locator('.broadcast-summary.is-combat')).toHaveCount(1);
    await expect.poll(() => Date.now() - new Date(first.createdAt).getTime()).toBeGreaterThan(2050);
    const nextDice = await op('dice.roll', { expression: '2d6+3', reason: '连续公开骰', visibility: 'PUBLIC' });
    await expect(gm.locator('.public-dice-banner')).toHaveAttribute('data-roll-id', nextDice.id);
    await expect(gm.locator('.broadcast-summary.is-dice')).toHaveCount(1);
    expect(await gm.locator('.broadcast-summary').count()).toBeLessThanOrEqual(2);
    await player.screenshot({ path: info.outputPath('broadcast-narrow.png') });
    await expect(gm.locator('.public-dice-banner')).toHaveCount(0);
    await expect(gm.locator('.combat-result-banner')).toHaveCount(0);
    await expect(gm.locator('.broadcast-summary')).toHaveCount(0);
    await op('dice.roll', { expression: '1d20', reason: 'GM私密骰不广播', visibility: 'PRIVATE' });
    await expect(player.locator('.public-dice-banner')).toHaveCount(0);
    await gm.reload();
    await expect(gm.locator('[title="已连接"]')).toBeVisible();
    await expect(gm.locator('.room-broadcasts > aside')).toHaveCount(0);
    await expect(gm.locator('.broadcast-summary')).toHaveCount(0);
    expect((await snap()).tokens.find((t: any) => t.id === token.id)).toMatchObject({ x: 450, y: 350 });
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    if (roomId) await db.room.deleteMany({ where: { id: roomId, name: prefix } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
