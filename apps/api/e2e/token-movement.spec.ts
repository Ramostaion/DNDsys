import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { createApplication } from '../src/app';
import { readConfig } from '../src/config';

config({ path: 'apps/api/.env' });

async function node(page: Page, id: string) {
  return page.evaluate((id) => {
    const stage = (window as any).Konva?.stages.find((s: any) => s.container().isConnected);
    const token = stage?.findOne('#' + id);
    return token ? { x: token.x(), y: token.y() } : null;
  }, id);
}
async function record(page: Page, id: string) {
  await page.evaluate((id) => {
    const win = window as any;
    win.moveSamples = [];
    const start = performance.now();
    const frame = () => {
      const stage = win.Konva?.stages.find((s: any) => s.container().isConnected);
      const token = stage?.findOne('#' + id);
      if (token) {
        const fx = stage.find('.token-move-effects');
        const guide = stage.findOne('#move-effects-' + id)?.findOne('.token-move-guide');
        const arrows = guide?.find('.token-move-arrow') || [];
        win.moveSamples.push({
          t: performance.now() - start,
          x: token.x(),
          y: token.y(),
          fx: fx.some((g: any) => g.visible()),
          ghost: fx.some((g: any) => g.visible() && g.find('.token-move-ghost').some((c: any) => c.opacity() > 0)),
          guideAlpha: guide?.opacity() || 0,
          arrows: arrows.length,
          angle: arrows[0]?.rotation(),
          path: guide?.findOne('.token-move-path')?.points() || [],
          ring: fx.some(
            (g: any) =>
              g.visible() && g.getChildren().some((c: any) => c.getClassName() === 'Circle' && c.opacity() > 0),
          ),
        });
      }
      if (performance.now() - start < 2500) requestAnimationFrame(frame);
    };
    frame();
  }, id);
}
async function dragStart(page: Page, id: string, to: { x: number; y: number }) {
  const points = await page.evaluate(
    ({ id, to }) => {
      const stage = (window as any).Konva.stages.find((s: any) => s.container().isConnected);
      const token = stage.findOne('#' + id),
        box = stage.container().getBoundingClientRect();
      const a = token.getAbsolutePosition(),
        b = stage.getAbsoluteTransform().point(to);
      return { a: { x: a.x + box.left, y: a.y + box.top }, b: { x: b.x + box.left, y: b.y + box.top } };
    },
    { id, to },
  );
  await page.mouse.move(points.a.x, points.a.y);
  await page.mouse.down();
  await page.mouse.move(points.b.x, points.b.y, { steps: 10 });
}

test('棋子移动：三账号与同账号多窗口平滑回放、去重、连续移动、权限、重连和减少动态效果', async ({ browser }) => {
  test.setTimeout(180000);
  const reservation = createServer();
  await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>((done) => reservation.close(() => done()));
  const origin = `http://127.0.0.1:${port}`,
    api = origin + '/api',
    db = new PrismaClient();
  let activeQueries = 0,
    lastQueryAt = Date.now();
  const serverDb = db.$extends({
    query: {
      async $allOperations({ args, query }) {
        activeQueries++;
        try {
          return await query(args);
        } finally {
          activeQueries--;
          lastQueryAt = Date.now();
        }
      },
    },
  });
  const application = createApplication(serverDb as unknown as PrismaClient, {
    ...readConfig(),
    origin,
    secureCookie: false,
    webDir: resolve('apps/web/dist'),
  });
  const sent: { userId: string; event: string; data: any }[] = [];
  application.io.on('connection', (socket) =>
    socket.onAnyOutgoing((event, envelope) => {
      if (event === 'change') sent.push({ userId: socket.data.user.id, event: envelope.event, data: envelope.data });
    }),
  );
  await new Promise<void>((done) => application.server.listen(port, '127.0.0.1', done));
  const prefix = `e2e-move-${randomUUID().slice(0, 8)}`,
    users: any[] = [],
    roomIds: string[] = [],
    contexts: BrowserContext[] = [],
    errors: string[] = [];
  const post = async (index: number, path: string, data: unknown) => {
    const response = await contexts[index].request.post(api + path, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  let room: any;
  const op = (index: number, type: string, payload: unknown, id = randomUUID()) =>
    post(index, `/rooms/${room.id}/operations`, { id, type, payload });
  try {
    for (let i = 0; i < 5; i++) {
      contexts.push(
        await browser.newContext({
          viewport: { width: 1600, height: 1000 },
          ...(i === 3 ? { reducedMotion: 'reduce' } : {}),
        }),
      );
      users.push(await post(i, '/auth/register', { username: `${prefix}-${i}`, password: randomUUID() }));
    }
    room = await post(0, '/rooms', { name: prefix });
    roomIds.push(room.id);
    const other = await post(4, '/rooms', { name: prefix + '-other' });
    roomIds.push(other.id);
    for (let i = 1; i < 4; i++) await post(i, '/rooms/join', { inviteCode: room.inviteCode });
    const hero = await op(0, 'character.create', { name: '沙盘游侠', ownerId: users[1].id });
    const map = await op(0, 'map.create', { name: '移动演示地图', width: 1600, height: 1000 });
    await op(0, 'map.activate', { id: map.id });
    const token = await op(0, 'token.create', { mapId: map.id, characterId: hero.id, x: 400, y: 400 });
    contexts.push(
      await browser.newContext({
        storageState: await contexts[0].storageState(),
        viewport: { width: 1600, height: 1000 },
      }),
    );
    const pages: Page[] = [];
    for (let i = 0; i < 6; i++) {
      const page = await contexts[i].newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${origin}/rooms/${i === 4 ? other.id : room.id}`);
      await expect(page.locator('.party-panel [title="已连接"]')).toBeVisible();
      if (i !== 4) await expect.poll(() => node(page, token.id)).toEqual({ x: 400, y: 400 });
      pages.push(page);
    }
    const [gm, a, b, reduced, outsider, gmOtherTab] = pages;
    for (const page of [gm, a, b, reduced, gmOtherTab]) await record(page, token.id);
    await dragStart(gm, token.id, { x: 800, y: 600 });
    // No mouse-path packets: observers stay at A until the drag is committed.
    expect(await node(a, token.id)).toEqual({ x: 400, y: 400 });
    expect(await node(b, token.id)).toEqual({ x: 400, y: 400 });
    const response = gm.waitForResponse(
      (r) => r.url().endsWith('/operations') && r.request().postDataJSON().type === 'token.move',
    );
    await gm.mouse.up();
    const first = await (await response).json();
    expect(first.movement).toMatchObject({
      from: { x: 400, y: 400 },
      actorId: users[0].id,
      version: token.version + 1,
    });
    expect(Math.abs(first.x - 800)).toBeLessThan(2);
    expect(Math.abs(first.y - 600)).toBeLessThan(2);
    const firstPoint = { x: first.x, y: first.y };
    for (const page of [a, b, gmOtherTab]) {
      await expect
        .poll(() =>
          page.evaluate(() => (window as any).moveSamples.some((s: any) => s.x > 410 && s.x < 790 && s.fx && s.ghost)),
        )
        .toBe(true);
      if (page === a) await page.screenshot({ path: '.launcher/token-movement-glide.png' });
      await expect.poll(() => node(page, token.id)).toEqual(firstPoint);
      await expect.poll(() => page.evaluate(() => (window as any).moveSamples.some((s: any) => s.ring))).toBe(true);
      const samples = await page.evaluate(() => (window as any).moveSamples);
      const direction = (Math.atan2(first.y - 400, first.x - 400) * 180) / Math.PI;
      const directed = samples.filter((s: any) => s.arrows > 1 && s.guideAlpha > 0.5);
      expect(directed.length).toBeGreaterThan(0);
      for (const sample of directed) expect(sample.angle).toBeCloseTo(direction);
      expect(samples.some((s: any) => s.x === first.x && s.guideAlpha > 0 && s.guideAlpha < 0.9)).toBe(true);
      let previous = 400;
      for (const sample of samples) {
        expect(sample.x).toBeGreaterThanOrEqual(previous - 0.01);
        expect(sample.y - 400).toBeCloseTo(((sample.x - 400) * (first.y - 400)) / (first.x - 400));
        previous = sample.x;
      }
    }
    for (const page of [gm, reduced]) {
      await expect.poll(() => node(page, token.id)).toEqual(firstPoint);
      expect(await page.evaluate(() => (window as any).moveSamples.some((s: any) => s.fx))).toBe(false);
      expect(await page.evaluate(() => (window as any).moveSamples.some((s: any) => s.arrows))).toBe(false);
    }
    const stored = await db.mapToken.findUniqueOrThrow({ where: { id: token.id } });
    expect(stored).toMatchObject({ ...firstPoint, version: first.version });
    const delivered = sent.filter((n) => n.event === 'token.moved' && n.data.eventId === first.movement.eventId);
    expect(delivered.map((n) => n.userId).sort()).toEqual(
      [users[0].id, users[0].id, users[1].id, users[2].id, users[3].id].sort(),
    );
    // A retried request returns the same receipt without a second broadcast or version increment.
    const retry = await op(
      0,
      'token.move',
      { id: token.id, x: 800, y: 600, version: token.version },
      first.movement.eventId,
    );
    expect(retry).toEqual(first);
    expect(sent.filter((n) => n.event === 'token.moved' && n.data.eventId === first.movement.eventId)).toHaveLength(
      delivered.length,
    );
    // A player drag animates for GM and another player, and not for the dragging browser.
    for (const page of [gm, a, b]) await record(page, token.id);
    await dragStart(a, token.id, { x: 500, y: 500 });
    const playerResponse = a.waitForResponse(
      (r) => r.url().endsWith('/operations') && r.request().postDataJSON().type === 'token.move',
    );
    await a.mouse.up();
    const second = await (await playerResponse).json(),
      secondPoint = { x: second.x, y: second.y };
    for (const page of [gm, b]) {
      await expect
        .poll(() => page.evaluate(() => (window as any).moveSamples.some((s: any) => s.x < 790 && s.x > 510 && s.fx)))
        .toBe(true);
      await expect.poll(() => node(page, token.id)).toEqual(secondPoint);
    }
    expect(await a.evaluate(() => (window as any).moveSamples.some((s: any) => s.fx))).toBe(false);
    await gm.locator('.game-rail').getByRole('button', { name: '角色', exact: true }).click();
    await gm.getByRole('button', { name: '沙盘游侠', exact: true }).click();
    await gm.getByRole('button', { name: '关闭角色', exact: true }).click();
    await gm.getByLabel('角色名称', { exact: true }).fill('尚未保存的移动期间草稿');
    // Two accepted moves while the first is still being presented retarget from the displayed position.
    let current = await db.mapToken.findUniqueOrThrow({ where: { id: token.id } });
    const one = await op(0, 'token.move', {
      id: token.id,
      version: current.version,
      x: 1000,
      y: 500,
      from: { x: -999, y: -999 },
    });
    expect(one.movement.from).toEqual(secondPoint);
    await expect
      .poll(async () => {
        const p = await node(b, token.id);
        return p && p.x > 510 && p.x < 990;
      })
      .toBe(true);
    await op(0, 'token.move', { id: token.id, version: one.version, x: 1100, y: 650 });
    await expect
      .poll(() =>
        b.evaluate((id) => {
          const guide = (window as any).Konva.stages[0].findOne('#move-effects-' + id)?.findOne('.token-move-guide');
          const path = guide?.findOne('.token-move-path')?.points();
          return path && path.length === 4 && path[2] > 1000 && path[3] > 600;
        }, token.id),
      )
      .toBe(true);
    for (const page of [gm, a, b, reduced]) await expect.poll(() => node(page, token.id)).toEqual({ x: 1100, y: 650 });
    await expect(gm.getByLabel('角色名称', { exact: true })).toHaveValue('尚未保存的移动期间草稿');
    // Failed stale writes cannot alter the final position.
    const conflict = await contexts[1].request.post(`${api}/rooms/${room.id}/operations`, {
      data: { id: randomUUID(), type: 'token.move', payload: { id: token.id, version: token.version, x: 0, y: 0 } },
    });
    expect(conflict.status()).toBe(409);
    // Zoom and pan change only the view transform, never world-space movement.
    await b.mouse.move(600, 500);
    await b.mouse.wheel(0, -220);
    await b.mouse.move(300, 700);
    await b.mouse.down();
    await b.mouse.move(340, 730, { steps: 4 });
    await b.mouse.up();
    current = await db.mapToken.findUniqueOrThrow({ where: { id: token.id } });
    await record(b, token.id);
    await op(0, 'token.move', { id: token.id, version: current.version, x: 700, y: 450 });
    await expect
      .poll(() => b.evaluate(() => (window as any).moveSamples.some((s: any) => s.fx && s.x < 1090 && s.x > 710)))
      .toBe(true);
    await expect.poll(() => node(b, token.id)).toEqual({ x: 700, y: 450 });
    await expect
      .poll(() =>
        b.evaluate(() => !(window as any).Konva.stages[0].find('.token-move-effects').some((g: any) => g.visible())),
      )
      .toBe(true);
    expect(await b.evaluate(() => (window as any).Konva.stages[0].find('.token-move-arrow').length)).toBe(0);
    await b.screenshot({ path: '.launcher/token-movement-settled.png' });
    // Disconnect, move, then reconnect: recover the final snapshot without replaying old effects.
    await contexts[2].setOffline(true);
    current = await db.mapToken.findUniqueOrThrow({ where: { id: token.id } });
    await op(0, 'token.move', { id: token.id, version: current.version, x: 900, y: 550 });
    await contexts[2].setOffline(false);
    await expect(b.locator('.party-panel [title="已连接"]')).toBeVisible();
    await expect.poll(() => node(b, token.id)).toEqual({ x: 900, y: 550 });
    await record(b, token.id);
    await b.reload();
    await expect.poll(() => node(b, token.id)).toEqual({ x: 900, y: 550 });
    expect(
      await b.evaluate(() => (window as any).Konva.stages[0].find('.token-move-effects').some((g: any) => g.visible())),
    ).toBe(false);
    // A refused UI drag rolls back to the latest confirmed position.
    await a.route('**/operations', async (route) => {
      if (route.request().postDataJSON().type === 'token.move')
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({ error: '测试移动冲突' }),
        });
      else await route.continue();
    });
    await dragStart(a, token.id, { x: 700, y: 600 });
    await a.mouse.up();
    await expect(a.locator('.toast')).toContainText('测试移动冲突');
    await expect.poll(() => node(a, token.id)).toEqual({ x: 900, y: 550 });
    await a.unroute('**/operations');
    // Two different tokens have independent guides, with opposite directions, and both clear.
    const companion = await op(0, 'character.create', { name: '同行守卫', ownerId: users[2].id });
    const companionToken = await op(0, 'token.create', { mapId: map.id, characterId: companion.id, x: 1100, y: 800 });
    await expect.poll(() => node(b, companionToken.id)).toEqual({ x: 1100, y: 800 });
    current = await db.mapToken.findUniqueOrThrow({ where: { id: token.id } });
    await Promise.all([
      op(0, 'token.move', { id: token.id, version: current.version, x: 1300, y: 550 }),
      op(0, 'token.move', { id: companionToken.id, version: companionToken.version, x: 500, y: 800 }),
    ]);
    await expect
      .poll(() =>
        b.evaluate(
          ([firstId, secondId]) => {
            const stage = (window as any).Konva.stages[0];
            const guides = [firstId, secondId].map((id) =>
              stage.findOne('#move-effects-' + id)?.findOne('.token-move-guide'),
            );
            const arrows = guides.map((g) => g?.findOne('.token-move-arrow'));
            return (
              guides.every((g) => g?.opacity() > 0) && arrows[0]?.rotation() === 0 && arrows[1]?.rotation() === 180
            );
          },
          [token.id, companionToken.id],
        ),
      )
      .toBe(true);
    await expect.poll(() => node(b, token.id)).toEqual({ x: 1300, y: 550 });
    await expect.poll(() => node(b, companionToken.id)).toEqual({ x: 500, y: 800 });
    await expect.poll(() => b.evaluate(() => (window as any).Konva.stages[0].find('.token-move-arrow').length)).toBe(0);
    // Each visibility gate is applied before broadcasting any coordinates.
    const secretHero = await op(0, 'character.create', { name: '隐藏哨兵', visibility: 'GM', isNpc: true });
    const hiddenToken = await op(0, 'token.create', {
      mapId: map.id,
      characterId: hero.id,
      visibility: 'GM',
      x: 50,
      y: 50,
    });
    const hiddenCharacterToken = await op(0, 'token.create', {
      mapId: map.id,
      characterId: secretHero.id,
      x: 100,
      y: 50,
    });
    for (const hidden of [hiddenToken, hiddenCharacterToken]) {
      const moved = await op(0, 'token.move', { id: hidden.id, version: hidden.version, x: 200, y: 200 });
      const notices = sent.filter((n) => n.event === 'token.moved' && n.data.eventId === moved.movement.eventId);
      expect(notices).toHaveLength(2);
      expect(notices.every((n) => n.userId === users[0].id)).toBe(true);
      expect(await node(a, hidden.id)).toBeNull();
      const denied = await contexts[1].request.post(`${api}/rooms/${room.id}/operations`, {
        data: { id: randomUUID(), type: 'token.move', payload: { id: hidden.id, x: 250, y: 250 } },
      });
      expect(denied.status()).toBe(403);
    }
    const privateMap = await op(0, 'map.create', { name: 'GM 密室', visibility: 'GM' });
    const privateMapToken = await op(0, 'token.create', { mapId: privateMap.id, characterId: hero.id, x: 100, y: 100 });
    await op(0, 'map.activate', { id: privateMap.id });
    const privateMove = await op(0, 'token.move', {
      id: privateMapToken.id,
      version: privateMapToken.version,
      x: 300,
      y: 300,
    });
    expect(
      sent
        .filter((n) => n.event === 'token.moved' && n.data.eventId === privateMove.movement.eventId)
        .every((n) => n.userId === users[0].id),
    ).toBe(true);
    expect(sent.some((n) => n.userId === users[4].id && n.event === 'token.moved')).toBe(false);
    expect(await outsider.locator('.board-surface').count()).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    application.beginShutdown();
    await new Promise<void>((done) => application.io.close(() => done()));
    // Aborted browser requests may still be finishing their snapshot queries.
    await expect.poll(() => activeQueries === 0 && Date.now() - lastQueryAt > 200).toBe(true);
    await db.room.deleteMany({ where: { id: { in: roomIds }, name: { startsWith: prefix } } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
