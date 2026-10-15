import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { createApplication } from '../src/app';
import { readConfig } from '../src/config';
import { diceCalculation } from '@dnd/shared';

config({ path: 'apps/api/.env' });
test('公开骰全员顶部同步、房间冷却竞态、私密隔离、去重及 API 重启恢复', async () => {
  test.setTimeout(180_000);
  const address = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address;
  expect(address).toBeTruthy();
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '0.0.0.0', done));
  const webPort = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const origin = `http://${address}:${webPort}`;
  const db = new PrismaClient();
  let application = createApplication(db, { ...readConfig(), origin, secureCookie: false });
  let apiPort = 0;
  let web: { listen(): Promise<unknown>; close(): Promise<unknown> } | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const users: any[] = [],
    roomIds: string[] = [];
  const prefix = `e2e-dice-${randomUUID().slice(0, 8)}`;
  async function startApi() {
    await new Promise<void>((done) => application.server.listen(apiPort, '127.0.0.1', done));
    apiPort = (application.server.address() as { port: number }).port;
  }
  try {
    await startApi();
    const apiTarget = `http://127.0.0.1:${apiPort}`;
    const api = origin + '/api';
    const requireWeb = createRequire(resolve('apps/web/package.json'));
    const { createServer: createVite } = await import(pathToFileURL(requireWeb.resolve('vite')).href);
    web = await createVite({
      root: resolve('apps/web'),
      server: {
        host: '0.0.0.0',
        port: webPort,
        strictPort: true,
        proxy: {
          '/api': apiTarget,
          '/uploads': apiTarget,
          '/socket.io': { target: apiTarget, ws: true },
        },
      },
    });
    await web!.listen();
    browser = await chromium.launch({
      channel: process.platform === 'win32' ? 'msedge' : undefined,
      headless: true,
      args: ['--no-proxy-server'],
    });
    const contexts: BrowserContext[] = [];
    async function post(context: BrowserContext, path: string, data: unknown) {
      const response = await context.request.post(api + path, { data });
      expect(response.ok(), await response.text()).toBe(true);
      return response.json();
    }
    for (let index = 0; index < 4; index++) {
      const context = await browser.newContext({
        viewport: { width: 1600, height: 1000 },
        ...(index === 2 ? { reducedMotion: 'reduce' as const } : {}),
      });
      contexts.push(context);
      users.push(await post(context, '/auth/register', { username: `${prefix}-${index}`, password: randomUUID() }));
    }
    const room = await post(contexts[0], '/rooms', { name: prefix });
    roomIds.push(room.id);
    const other = await post(contexts[3], '/rooms', { name: prefix + '-other' });
    roomIds.push(other.id);
    for (const context of contexts.slice(1, 3)) await post(context, '/rooms/join', { inviteCode: room.inviteCode });
    const operation = (index: number, type: string, payload: unknown, id = randomUUID(), targetRoom = room.id) =>
      contexts[index].request.post(`${api}/rooms/${targetRoom}/operations`, { data: { id, type, payload } });
    expect((await operation(1, 'dice.roll', { expression: '1d1001' })).status()).toBe(400);
    expect(await db.diceRoll.count({ where: { roomId: room.id } })).toBe(0);
    expect((await db.room.findUniqueOrThrow({ where: { id: room.id } })).publicDiceAvailableAt).toBeNull();
    const heroResponse = await operation(0, 'character.create', { name: '演出中的人物卡', ownerId: users[1].id });
    expect(heroResponse.ok()).toBe(true);
    const hero = await heroResponse.json();
    const map = await (await operation(0, 'map.create', { name: '演出地图', width: 1400, height: 900 })).json();
    await operation(0, 'map.activate', { id: map.id });
    const token = await (
      await operation(0, 'token.create', { mapId: map.id, characterId: hero.id, x: 850, y: 440 })
    ).json();
    const errors: string[] = [];
    const pages: Page[] = [];
    for (const [index, context] of contexts.entries()) {
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.message));
      await page.addInitScript(() => {
        (window as any).__diceSeen = [];
        (window as any).__dicePhases = [];
        let lastId = '';
        let lastPhase = '';
        new MutationObserver(() => {
          const banner = document.querySelector('.public-dice-banner');
          const id = banner?.getAttribute('data-roll-id');
          const phase = banner?.getAttribute('data-phase');
          if (id && phase && `${id}:${phase}` !== lastPhase) {
            (window as any).__dicePhases.push({ id, phase, animation: getComputedStyle(banner!).animationName });
            lastPhase = `${id}:${phase}`;
          }
          if (id && id !== lastId) {
            (window as any).__diceSeen.push(id);
            lastId = id;
          }
        }).observe(document, { childList: true, subtree: true, attributes: true });
      });
      await page.goto(`${origin}/rooms/${index === 3 ? other.id : room.id}`);
      await expect(page.locator('.party-panel [title="已连接"]')).toBeVisible();
      expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
      pages.push(page);
    }
    const [gm, a, b, outsider] = pages;
    await gm.locator('.game-rail').getByRole('button', { name: '角色', exact: true }).click();
    await gm.getByRole('button', { name: '演出中的人物卡', exact: true }).click();
    await gm.getByRole('button', { name: '关闭角色', exact: true }).click();
    await gm.getByLabel('角色名称').fill('尚未保存的角色名称');
    // Test every member's public button without requiring the dice window for the animation.
    for (const page of [a, b])
      await page.locator('.game-rail').getByRole('button', { name: '骰子', exact: true }).click();
    await a.getByLabel('掷骰表达式').fill('2d6+3');
    const reply = a.waitForResponse(
      (response) => response.url().endsWith('/operations') && response.request().postDataJSON().type === 'dice.roll',
    );
    await a.getByRole('button', { name: '掷出骰子', exact: true }).click();
    const firstResponse = await reply;
    expect(firstResponse.ok()).toBe(true);
    const first = await firstResponse.json();
    // API requests deliberately bypass the disabled buttons and use authenticated cookies.
    const rejected = await Promise.all([0, 1, 2].map((index) => operation(index, 'dice.roll', { expression: '1d20' })));
    for (const response of rejected) {
      expect(response.status()).toBe(429);
      expect(await response.json()).toMatchObject({ code: 'DICE_COOLDOWN', cooldownUntil: first.cooldownUntil });
    }
    expect(await db.diceRoll.count({ where: { roomId: room.id, visibility: 'PUBLIC' } })).toBe(1);
    for (const page of [gm, a, b]) {
      const banner = page.locator('.public-dice-banner');
      await expect(banner).toHaveAttribute('data-roll-id', first.id);
      await expect(banner).toContainText(`玩家 ${users[1].username} 掷出了骰子！`);
      await expect(banner).toContainText('骰子：2d6+3');
      await expect(banner.locator('.die-label strong')).toHaveText(first.details[0].rolls.map(String));
      await expect(banner.locator('.dice-stage')).toHaveClass(/is-compact/);
      await expect(banner.locator('.die-seat')).toHaveCount(2);
      await expect(banner.locator('.die-face')).toHaveCount(12);
      await expect(banner).toContainText('计算：' + diceCalculation(first.details));
      expect(await banner.evaluate((element) => getComputedStyle(element).pointerEvents)).toBe('none');
    }
    await expect(outsider.locator('.public-dice-banner')).toHaveCount(0);
    await expect(a.getByRole('button', { name: '掷出骰子', exact: true })).toBeDisabled();
    await expect(b.getByRole('button', { name: '掷出骰子', exact: true })).toBeDisabled();
    await b.getByLabel('掷骰表达式').fill('3d8+2');
    await expect(b.getByLabel('掷骰表达式')).toHaveValue('3d8+2');
    await expect(gm.getByLabel('角色名称')).toHaveValue('尚未保存的角色名称');
    await gm.getByLabel('角色名称').fill('演出时仍可编辑');
    await expect(gm.getByLabel('角色名称')).toHaveValue('演出时仍可编辑');
    await expect.poll(() => a.locator('.public-dice-banner').getAttribute('data-phase')).toBe('result');
    expect(
      await a
        .locator('.public-dice-banner .die-tumble')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe(
      await a
        .locator('.dice-tray .die-tumble')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
    );
    for (const page of [gm, a, b])
      await expect(page.locator('.public-dice-final strong')).toHaveText(String(first.total));
    const persisted = await db.diceRoll.findUniqueOrThrow({ where: { id: first.id } });
    expect(persisted).toMatchObject({
      userId: users[1].id,
      rollerName: users[1].username,
      rollerRole: 'PLAYER',
      total: first.total,
      details: first.details,
    });
    await gm.screenshot({ path: '.launcher/public-dice-desktop.png' });
    await b.setViewportSize({ width: 900, height: 700 });
    const narrowBounds = await b.locator('.public-dice-banner').boundingBox();
    expect(narrowBounds).not.toBeNull();
    expect(narrowBounds!.x).toBeGreaterThanOrEqual(0);
    expect(narrowBounds!.x + narrowBounds!.width).toBeLessThanOrEqual(900);
    await b.screenshot({ path: '.launcher/public-dice-player.png' });
    await b.setViewportSize({ width: 1600, height: 1000 });
    // The result stays visible, then fades out before the live overlay is removed.
    await expect(gm.locator('.public-dice-banner')).toHaveCount(0);
    for (const page of [gm, a, b]) {
      const phases = await page.evaluate(() => (window as any).__dicePhases);
      expect(phases).toContainEqual({
        id: first.id,
        phase: 'fading',
        animation: page === b ? 'none' : 'public-dice-exit',
      });
    }
    // Private GM result has no public event/deadline and does not consume the other room's allowance.
    const privateResponse = await operation(0, 'dice.roll', {
      expression: '1d100',
      visibility: 'PRIVATE',
      reason: '秘密骰不可见',
    });
    expect(privateResponse.ok()).toBe(true);
    const privateRoll = await privateResponse.json();
    expect(privateRoll).not.toHaveProperty('cooldownUntil');
    expect((await db.room.findUniqueOrThrow({ where: { id: room.id } })).publicDiceAvailableAt?.getTime()).toBe(
      first.cooldownUntil,
    );
    const outsiderRoll = await operation(3, 'dice.roll', { expression: '1d37+4' }, randomUUID(), other.id);
    expect(outsiderRoll.ok()).toBe(true);
    await expect(outsider.locator('.public-dice-banner')).toContainText(`GM ${users[3].username}`);
    for (const page of [a, b]) await expect(page.locator('.dice-tray')).not.toContainText('秘密骰不可见');
    // At/after the shared deadline, an arbitrary dice expression succeeds via UI.
    await expect(b.getByRole('button', { name: '掷出骰子', exact: true })).toBeEnabled();
    const secondReply = b.waitForResponse(
      (response) => response.url().endsWith('/operations') && response.request().postDataJSON().type === 'dice.roll',
    );
    await b.getByRole('button', { name: '掷出骰子', exact: true }).click();
    const second = await (await secondReply).json();
    expect(new Date(second.createdAt).getTime()).toBeGreaterThanOrEqual(first.cooldownUntil);
    await Promise.all(
      [gm, a, b].map((page) => expect(page.locator('.public-dice-banner')).toHaveAttribute('data-roll-id', second.id)),
    );
    expect(
      await b
        .locator('.public-dice-banner .die-tumble')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe('none');
    await expect(gm.getByLabel('角色名称')).toHaveValue('演出时仍可编辑');
    // Refresh during cooldown recovers its deadline without replaying this old animation.
    await a.reload();
    await a.locator('.game-rail').getByRole('button', { name: '骰子', exact: true }).click();
    await expect(a.locator('.public-dice-banner')).toHaveCount(0);
    await expect(a.getByRole('button', { name: '掷出骰子', exact: true })).toBeDisabled();
    await expect(a.locator('.dice-history-description').filter({ hasText: users[2].username })).toContainText(
      `掷出 3d8+2，结果 ${second.total}`,
    );
    // Wait through the actual service clock, then send two different authenticated requests concurrently.
    await expect(a.getByRole('button', { name: '掷出骰子', exact: true })).toBeEnabled();
    const race = await Promise.all([1, 2].map((index) => operation(index, 'dice.roll', { expression: '1d20' })));
    expect(race.map((response) => response.status()).sort()).toEqual([200, 429]);
    expect(await db.diceRoll.count({ where: { roomId: room.id, visibility: 'PUBLIC' } })).toBe(3);
    await expect(a.getByRole('button', { name: '掷出骰子', exact: true })).toBeEnabled();
    const requestId = randomUUID();
    const [gmReply, concurrentRetry] = await Promise.all([
      operation(0, 'dice.roll', { expression: '1d37-2', rollerName: '伪造名称', rollerRole: 'PLAYER' }, requestId),
      operation(0, 'dice.roll', { expression: '1d37-2' }, requestId),
    ]);
    expect(gmReply.ok()).toBe(true);
    const gmRoll = await gmReply.json();
    expect(concurrentRetry.ok()).toBe(true);
    expect((await concurrentRetry.json()).id).toBe(gmRoll.id);
    await Promise.all(
      [gm, a, b].map((page) =>
        expect(page.locator('.public-dice-banner')).toContainText(`GM ${users[0].username} 掷出了骰子！`),
      ),
    );
    const repeat = await operation(0, 'dice.roll', { expression: '1d37-2' }, requestId);
    expect(repeat.ok()).toBe(true);
    expect((await repeat.json()).id).toBe(gmRoll.id);
    expect(await db.diceRoll.count({ where: { roomId: room.id, visibility: 'PUBLIC' } })).toBe(4);
    for (const page of [gm, a, b])
      expect(
        await page.evaluate(
          (id) => (window as any).__diceSeen.filter((value: string) => value === id).length,
          gmRoll.id,
        ),
      ).toBe(1);
    // A real API composition restart preserves saved rolls, request receipts and the live deadline.
    await new Promise<void>((done) => application.io.close(() => done()));
    application = createApplication(db, { ...readConfig(), origin, secureCookie: false });
    await startApi();
    const duringRestart = await operation(1, 'dice.roll', { expression: '1d6' });
    expect(duringRestart.status()).toBe(429);
    const afterRestart = await operation(0, 'dice.roll', { expression: '1d37-2' }, requestId);
    expect(afterRestart.ok()).toBe(true);
    expect((await afterRestart.json()).id).toBe(gmRoll.id);
    // Nickname changes after the roll cannot relabel the saved record.
    await db.user.update({ where: { id: users[0].id }, data: { username: `${prefix}-renamed` } });
    await a.reload();
    await a.locator('.game-rail').getByRole('button', { name: '骰子', exact: true }).click();
    await expect(a.locator('.public-dice-banner')).toHaveCount(0);
    await expect(a.locator('.dice-history-description').filter({ hasText: users[0].username })).toContainText(
      `GM ${users[0].username} 掷出 1d37-2，结果 ${gmRoll.total}`,
    );
    const playerSnapshot = await (await contexts[1].request.get(`${api}/rooms/${room.id}/snapshot`)).json();
    expect(playerSnapshot.rolls.some((roll: any) => roll.id === privateRoll.id)).toBe(false);
    expect(playerSnapshot.rolls).toHaveLength(4);
    expect(playerSnapshot.diceState.cooldownUntil).toBe(gmRoll.cooldownUntil);
    await expect(gm.getByLabel('角色名称')).toHaveValue('演出时仍可编辑');
    // Lose the reply after a real server commit, then retry the UI's original request ID.
    await expect(a.getByRole('button', { name: '掷出骰子', exact: true })).toBeEnabled();
    await a.getByLabel('掷骰表达式').fill('1d100');
    let lostId = '';
    await a.route(`**/api/rooms/${room.id}/operations`, async (route) => {
      lostId = route.request().postDataJSON().id;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.fulfill({ status: 503, json: { error: '测试：服务端已保存但回复丢失' } });
    });
    await a.getByRole('button', { name: '掷出骰子', exact: true }).click();
    await expect(a.getByRole('button', { name: '重试上次掷骰', exact: true })).toBeEnabled();
    const lostReceipt = await db.operationReceipt.findUniqueOrThrow({ where: { id: lostId } });
    const lostRollId = (lostReceipt.result as any).id;
    await a.unroute(`**/api/rooms/${room.id}/operations`);
    const retryReply = a.waitForResponse((response) => response.url().endsWith('/operations'));
    await a.getByRole('button', { name: '重试上次掷骰', exact: true }).click();
    const retried = await retryReply;
    expect(retried.request().postDataJSON().id).toBe(lostId);
    expect((await retried.json()).id).toBe(lostRollId);
    expect(await db.diceRoll.count({ where: { roomId: room.id, visibility: 'PUBLIC' } })).toBe(5);
    await Promise.all(
      [gm, a, b].map((page) => expect(page.locator('.public-dice-banner')).toHaveAttribute('data-roll-id', lostRollId)),
    );
    for (const page of [gm, a, b])
      expect(
        await page.evaluate(
          (id) => (window as any).__diceSeen.filter((value: string) => value === id).length,
          lostRollId,
        ),
      ).toBe(1);
    await gm.getByRole('button', { name: '关闭人物卡', exact: true }).click();
    // The map remains mounted and interactive after multiple broadcasts/reconnection.
    const point = await gm.evaluate((id) => {
      const stage = (window as any).Konva.stages[0],
        p = stage.findOne('#' + id).getAbsolutePosition(),
        rect = stage.container().getBoundingClientRect();
      return { x: p.x + rect.left, y: p.y + rect.top };
    }, token.id);
    await gm.mouse.move(point.x, point.y);
    await gm.mouse.down();
    await gm.mouse.move(point.x + 55, point.y + 25, { steps: 8 });
    await gm.mouse.up();
    await expect.poll(async () => (await db.mapToken.findUniqueOrThrow({ where: { id: token.id } })).version).toBe(1);
    // A member who misses a live roll recovers history, without replaying its performance.
    await expect(b.getByRole('button', { name: '掷出骰子', exact: true })).toBeEnabled();
    await contexts[1].setOffline(true);
    await expect(a.locator('.party-panel [title="正在重连"]')).toBeVisible();
    const missedReply = await operation(0, 'dice.roll', { expression: '1d6', reason: '离线期间的骰子' });
    expect(missedReply.ok()).toBe(true);
    const missed = await missedReply.json();
    await expect(b.locator('.public-dice-banner')).toHaveAttribute('data-roll-id', missed.id);
    await contexts[1].setOffline(false);
    await expect(a.locator('.party-panel [title="已连接"]')).toBeVisible();
    await expect(a.locator('.dice-history-description').filter({ hasText: `${prefix}-renamed` })).toContainText(
      `掷出 1d6，结果 ${missed.total}`,
    );
    await expect(a.locator(`.public-dice-banner[data-roll-id="${missed.id}"]`)).toHaveCount(0);
    expect(await a.evaluate((id) => (window as any).__diceSeen.includes(id), missed.id)).toBe(false);
    // A later arrival sees all public records, without an animation from the snapshot.
    await post(contexts[3], '/rooms/join', { inviteCode: room.inviteCode });
    await outsider.goto(`${origin}/rooms/${room.id}`);
    await expect(outsider.locator('.party-panel [title="已连接"]')).toBeVisible();
    await expect(outsider.locator('.public-dice-banner')).toHaveCount(0);
    await outsider.locator('.game-rail').getByRole('button', { name: '骰子', exact: true }).click();
    await expect(outsider.locator('.dice-history')).toHaveCount(6);
    await expect(outsider.locator('.dice-history-description').filter({ hasText: users[0].username })).toContainText(
      `掷出 1d37-2，结果 ${gmRoll.total}`,
    );
    await expect(outsider.locator('.dice-tray')).not.toContainText('秘密骰不可见');
    expect(errors).toEqual([]);
  } finally {
    application.beginShutdown();
    await browser?.close();
    await web?.close();
    await new Promise<void>((done) => application.io.close(() => done()));
    // Browser aborts can close HTTP sockets before the async snapshot handler finishes.
    // Let that handler finish before disconnecting its shared Prisma client.
    await new Promise((done) => setTimeout(done, 500));
    await db.room.deleteMany({ where: { id: { in: roomIds }, name: { startsWith: prefix } } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
