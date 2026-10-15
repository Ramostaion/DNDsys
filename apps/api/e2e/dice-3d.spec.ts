import { api } from './server-address';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config({ path: 'apps/api/.env' });

async function post(context: BrowserContext, path: string, data: unknown) {
  const response = await context.request.post(api + path, { data });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function openDice(context: BrowserContext, roomId: string) {
  const page = await context.newPage();
  await page.goto(`/rooms/${roomId}`);
  await page.locator('.game-rail').getByRole('button', { name: '骰子', exact: true }).click();
  await expect(page.locator('.dice-stage')).toBeVisible();
  return page;
}
async function roll(page: Page, expression: string, reason: string, visibility = 'PUBLIC') {
  await page.getByLabel('掷骰表达式').fill(expression);
  await page.getByLabel('掷骰原因').fill(reason);
  await page.getByLabel('可见范围').selectOption(visibility);
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/operations') && r.request().postDataJSON()?.type === 'dice.roll',
  );
  await page.getByRole('button', { name: '掷出骰子', exact: true }).click();
  const data = await (await response).json();
  await expect(page.locator('.dice-result')).toContainText(reason);
  return data;
}
async function saveStage(page: Page, path: string) {
  await page.locator('.dice-stage').evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
  });
  await page.locator('.dice-stage').screenshot({ path });
}

test('3D 骰子展示真实点数、公开同步、私密隔离与减少动效', async ({ browser }, info) => {
  const gm = await browser.newContext(),
    a = await browser.newContext(),
    b = await browser.newContext({ reducedMotion: 'reduce' });
  const db = new PrismaClient();
  let roomId: string | undefined;
  try {
    await post(gm, '/auth/login', { username: 'demo-gm', password: 'demo12345' });
    await post(a, '/auth/login', { username: 'demo-player-1', password: 'demo12345' });
    await post(b, '/auth/login', { username: 'demo-player-2', password: 'demo12345' });
    const room = await post(gm, '/rooms', { name: `E2E Dice 3D ${randomUUID().slice(0, 8)}` });
    roomId = room.id;
    await post(a, '/rooms/join', { inviteCode: room.inviteCode });
    await post(b, '/rooms/join', { inviteCode: room.inviteCode });
    const gmPage = await openDice(gm, room.id),
      aPage = await openDice(a, room.id),
      bPage = await openDice(b, room.id);
    const errors: string[] = [];
    for (const page of [gmPage, aPage, bPage]) {
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (/same key|unique.*key/i.test(message.text())) errors.push(message.text());
      });
    }
    expect(
      await gmPage.locator('.die-orientation').evaluate((element) => getComputedStyle(element).transformStyle),
    ).toBe('preserve-3d');

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await gmPage.route(`**/api/rooms/${room.id}/operations`, async (route) => {
      await gate;
      await route.continue();
    });
    await gmPage.getByLabel('掷骰原因').fill('3D 公开 D20');
    const reply = gmPage.waitForResponse((r) => r.url().endsWith('/operations'));
    await gmPage.getByRole('button', { name: '掷出骰子', exact: true }).click();
    await expect(gmPage.locator('.dice-stage')).toHaveClass(/is-rolling/);
    await expect(gmPage.locator('.dice-stage')).toBeInViewport({ ratio: 0.9 });
    await expect(gmPage.locator('.dice-stage')).toContainText('等待落定');
    expect(await gmPage.locator('.die-tumble').evaluate((element) => getComputedStyle(element).animationName)).toBe(
      'die-spin',
    );
    await expect(gmPage.locator('.die-face').first()).toHaveText('✧');
    release();
    const d20 = await (await reply).json();
    await gmPage.unroute(`**/api/rooms/${room.id}/operations`);
    await expect(gmPage.locator('.dice-result')).toContainText('3D 公开 D20');
    await expect(aPage.locator('.dice-result')).toContainText('3D 公开 D20');
    await expect(bPage.locator('.dice-result')).toContainText('3D 公开 D20');
    await expect(gmPage.locator('.die-face-result')).toHaveText(String(d20.details[0].rolls[0]));
    await expect(gmPage.locator('.dice-result-number')).toHaveText(String(d20.total));
    expect(await bPage.locator('.die-tumble').evaluate((element) => getComputedStyle(element).animationName)).toBe(
      'none',
    );
    await saveStage(gmPage, info.outputPath('dice-d20.png'));

    const d6 = await roll(gmPage, '2d6+3', '3D 双骰');
    await expect(gmPage.locator('.die-seat')).toHaveCount(2);
    await expect(gmPage.locator('.die-face-result')).toHaveText(d6.details[0].rolls.map(String));
    expect(d6.total).toBe(d6.details[0].rolls.reduce((sum: number, n: number) => sum + n, 3));
    await saveStage(gmPage, info.outputPath('dice-2d6.png'));
    await gmPage.screenshot({ path: info.outputPath('dice-window.png') });

    const custom = await roll(gmPage, '1d37-2', '3D 任意面数');
    await expect(gmPage.locator('.die-face-result')).toHaveText(String(custom.details[0].rolls[0]));
    await expect(gmPage.locator('.die-label')).toContainText('D37');
    await expect(bPage.locator('.dice-result')).toContainText('3D 任意面数');
    await saveStage(gmPage, info.outputPath('dice-d37.png'));
    await roll(gmPage, '100d6', '3D 百颗骰');
    await expect(gmPage.locator('.die-seat')).toHaveCount(6);
    await expect(gmPage.locator('.dice-stage')).toContainText('共 100 颗');
    await roll(gmPage, '5', '3D 纯修正');
    await expect(gmPage.locator('.die-seat')).toHaveCount(0);
    await expect(gmPage.locator('.dice-stage')).toContainText('没有骰子');

    await roll(gmPage, '1d20', '3D GM 秘密', 'PRIVATE');
    await expect(aPage.locator('.dice-result')).toContainText('3D 纯修正');
    await expect(bPage.locator('.dice-result')).toContainText('3D 纯修正');
    await expect(aPage.getByText('3D GM 秘密', { exact: false })).toHaveCount(0);
    await roll(aPage, '1d8', '3D 玩家秘密', 'PRIVATE');
    await expect(gmPage.locator('.dice-result')).toContainText('3D 玩家秘密');
    await expect(bPage.locator('.dice-result')).toContainText('3D 纯修正');
    const otherSnapshot = await (await b.request.get(api + `/rooms/${room.id}/snapshot`)).json();
    expect(otherSnapshot.rolls.some((r: any) => r.reason.includes('秘密'))).toBe(false);

    await gmPage.getByLabel('3D 掷骰动效').uncheck();
    await roll(gmPage, '1d6', '3D 动效关闭');
    expect(await gmPage.locator('.die-tumble').evaluate((element) => getComputedStyle(element).animationName)).toBe(
      'none',
    );
    await gmPage.reload();
    await gmPage.locator('.game-rail').getByRole('button', { name: '骰子', exact: true }).click();
    await expect(gmPage.getByLabel('3D 掷骰动效')).not.toBeChecked();
    await expect(gmPage.locator('.dice-stage')).not.toHaveClass(/is-landing/);

    await gmPage.route(`**/api/rooms/${room.id}/operations`, (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: '测试断线，请稍后重试' }),
      }),
    );
    await gmPage.getByRole('button', { name: '掷出骰子', exact: true }).click();
    await expect(gmPage.locator('.dice-tray')).toContainText('测试断线，请稍后重试');
    await expect(gmPage.locator('.dice-stage')).not.toHaveClass(/is-rolling/);
    await expect(gmPage.getByRole('button', { name: '重试上次掷骰', exact: true })).toBeEnabled();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([gm.close(), a.close(), b.close()]);
    if (roomId) await db.room.delete({ where: { id: roomId } });
    await db.$disconnect();
  }
});
