import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { createRequire } from 'node:module';
import { api, apiBase } from './server-address';

config({ path: 'apps/api/.env' });
const { io } = createRequire(new URL('../../web/package.json', import.meta.url))('socket.io-client');
async function table(browser: Browser) {
  const db = new PrismaClient(),
    prefix = `draft-${randomUUID().slice(0, 8)}`;
  const contexts = await Promise.all(
    [0, 1, 2, 3].map((i) =>
      browser.newContext({
        viewport: { width: i === 2 ? 1000 : 1600, height: 1050 },
        reducedMotion: i === 2 ? 'reduce' : 'no-preference',
      }),
    ),
  );
  const users: any[] = [];
  let roomId: string | undefined;
  const post = async (context: BrowserContext, path: string, data: unknown, status = 200) => {
    const response = await context.request.post(api + path, { data });
    expect(response.status(), await response.text()).toBe(status);
    return response.json();
  };
  const op = (type: string, payload: any, context = contexts[0], status = 200, id = randomUUID()) =>
    post(context, `/rooms/${roomId}/operations`, { id, type, payload }, status);
  const snap = async () => (await contexts[0].request.get(`${api}/rooms/${roomId}/snapshot`)).json();
  const list = async (context = contexts[0]) =>
    (await (await context.request.get(`${api}/rooms/${roomId}/combat-drafts`)).json()).drafts;
  const put = async (id: string, body: any, context = contexts[0], status = 200) => {
    const response = await context.request.put(`${api}/rooms/${roomId}/combat-drafts/${id}`, { data: body });
    expect(response.status(), await response.text()).toBe(status);
    return response.json();
  };
  const close = async (id: string, context = contexts[0], status = 200) => {
    const response = await context.request.delete(`${api}/rooms/${roomId}/combat-drafts/${id}`);
    expect(response.status(), await response.text()).toBe(status);
  };
  async function cleanup() {
    await Promise.all(contexts.map((c) => c.close()));
    if (roomId) await db.room.deleteMany({ where: { id: roomId, name: prefix } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  }
  try {
    for (const [i, c] of contexts.entries())
      users.push(await post(c, '/auth/register', { username: `${prefix}-${i}`, password: randomUUID() }));
    const room = await post(contexts[0], '/rooms', { name: prefix }, 201);
    roomId = room.id;
    for (const c of contexts.slice(1, 3)) await post(c, '/rooms/join', { inviteCode: room.inviteCode });
    await op('sheet.field.upsert', {
      version: (await snap()).room.version,
      field: { fieldId: 'dex', name: '敏捷', type: 'number', defaultValue: 15 },
    });
    const a = await op('character.create', { name: '霜刃', ownerId: users[1].id });
    const b = await op('character.create', { name: '守望者', ownerId: users[2].id });
    const c = await op('character.create', { name: '影狼', isNpc: true });
    const secret = await op('character.create', { name: '隐秘守卫', isNpc: true, visibility: 'GM' });
    const setDex = async (id: string, value: number) =>
      op('character.field.set', {
        characterId: id,
        fieldId: 'dex',
        value,
        version: (await snap()).characters.find((x: any) => x.id === id).version,
      });
    await setDex(a.id, 17);
    await setDex(b.id, 12);
    const pages = await Promise.all(contexts.slice(0, 3).map((c) => c.newPage()));
    const errors: string[] = [];
    for (const p of pages) p.on('pageerror', (e) => errors.push(e.message));
    await Promise.all(
      pages.map(async (p) => {
        await p.goto(`/rooms/${roomId}`);
        await expect(p.getByTitle('已连接', { exact: true })).toBeVisible();
      }),
    );
    return {
      db,
      contexts,
      pages,
      users,
      roomId: roomId!,
      a,
      b,
      c,
      secret,
      op,
      put,
      close,
      list,
      snap,
      setDex,
      errors,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
const open = (page: Page) => page.locator('.quick-bar').getByRole('button', { name: '战斗', exact: true }).click();
const card = (page: Page, id?: string) => page.locator(`.combat-draft-card${id ? `[data-draft-id="${id}"]` : ''}`);

test('属性判定与单连接压力：智力对敏捷、同骰保存、权限、地图操作及刷新合并', async ({ browser }) => {
  test.setTimeout(180000);
  const t = await table(browser),
    [gm, player] = t.pages;
  try {
    await t.op('sheet.field.upsert', {
      version: (await t.snap()).room.version,
      field: { fieldId: 'int', name: '智力', type: 'number', defaultValue: 22 },
    });
    await open(gm);
    await expect(gm.getByLabel('记录类型', { exact: true }).locator('option')).toHaveText([
      '动作声明',
      '结果裁定',
      'GM 裁定',
      '自由备注',
    ]);
    await expect(gm.getByLabel('判定', { exact: true }).locator('option')).toHaveText([
      '敏捷',
      '力量',
      '体质',
      '智力',
      '感知',
      '魅力',
    ]);
    await gm.getByLabel('声明角色', { exact: true }).selectOption(t.a.id);
    await gm.getByLabel('判定', { exact: true }).selectOption('智力');
    await gm.getByLabel('关联目标', { exact: true }).selectOption(t.b.id);
    await expect(card(gm)).toHaveAttribute('data-phase', 'settled');
    const preview = (await t.list())[0];
    expect(preview.contest.attacker).toMatchObject({ attributeName: '智力', bonus: 4 });
    expect(preview.contest.defender).toMatchObject({ attributeName: '敏捷', bonus: 0 });
    await expect(card(player)).toHaveAttribute('data-event-id', preview.eventId);
    await expect(card(player).locator('.is-attacker .draft-bonus')).toContainText('智力');
    await gm.getByRole('button', { name: '保存记录', exact: true }).click();
    await expect(gm.getByLabel('战斗结果广播', { exact: true })).toBeVisible();
    const record = await t.db.combatEvent.findFirstOrThrow({ where: { roomId: t.roomId, kind: 'DECLARATION' } });
    expect((record.data as any).contest.attacker).toMatchObject({
      attributeName: '智力',
      d20: preview.contest.attacker.d20,
      bonus: 4,
      total: preview.contest.attacker.total,
    });
    await gm.getByRole('button', { name: '关闭战斗', exact: true }).click();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const id = randomUUID();
      ids.push(id);
      await t.put(id, { revision: 1, actorId: t.a.id, targetId: t.b.id, actorAttribute: '智力' });
    }
    const map = await t.op('map.create', { name: '数据库压力地图', width: 1200, height: 800 });
    await t.op('map.activate', { id: map.id });
    let token = await t.op('token.create', { mapId: map.id, characterId: t.a.id, x: 100, y: 100 });
    const reads = Array.from({ length: 36 }, (_, i) =>
      t.contexts[i % 3].request.get(`${api}/rooms/${t.roomId}/combat-drafts`).then(async (r) => {
        expect(r.status(), await r.text()).toBe(200);
        expect((await r.json()).drafts).toHaveLength(8);
      }),
    );
    const movements = (async () => {
      for (let i = 0; i < 6; i++)
        token = await t.op('token.move', { id: token.id, version: token.version, x: 200 + i * 20, y: 200 });
    })();
    const rulers = Array.from({ length: 6 }, async () => {
      const drawing = await t.op('drawing.add', {
        mapId: map.id,
        kind: 'RULER',
        data: { shape: 'CONE', distance: 30, x: 200, y: 200 },
      });
      await t.op('drawing.undo', { id: drawing.id });
    });
    await Promise.all([...reads, movements, ...rulers]);
    expect((await t.snap()).tokens.find((x: any) => x.id === token.id)).toMatchObject({ x: 300, y: 200 });
    // A burst queues one follow-up read rather than dozens of simultaneous HTTP requests.
    let started = 0,
      concurrent = 0,
      peak = 0;
    await player.route('**/combat-drafts', async (route) => {
      started++;
      concurrent++;
      peak = Math.max(peak, concurrent);
      await new Promise((done) => setTimeout(done, 250));
      await route.continue();
      concurrent--;
    });
    await player.evaluate((roomId) => {
      for (let i = 0; i < 40; i++) window.dispatchEvent(new CustomEvent('dnd:combat-drafts', { detail: { roomId } }));
    }, t.roomId);
    await expect.poll(() => started).toBe(2);
    await expect.poll(() => concurrent).toBe(0);
    expect(peak).toBe(1);
    await player.unroute('**/combat-drafts');
    for (const id of ids) await t.close(id);
    const scoped = randomUUID();
    const intField = (await t.snap()).room.sheetSchema.find((f: any) => f.fieldId === 'int');
    await t.op('sheet.field.upsert', {
      version: (await t.snap()).room.version,
      field: { ...intField, visibility: 'GM' },
    });
    await t.put(scoped, { revision: 1, actorId: t.a.id, targetId: t.b.id, actorAttribute: '智力' });
    expect(await t.list(t.contexts[1])).toEqual([]);
    expect(await t.list(t.contexts[2])).toEqual([]);
    await t.close(scoped);
    expect(t.errors).toEqual([]);
  } finally {
    await t.cleanup();
  }
});

test('临时对抗主视窗：选目标同步、换人取消、原保存广播及同骰复用、并发与关闭', async ({ browser }, info) => {
  test.setTimeout(180000);
  const t = await table(browser),
    [gm, a, b] = t.pages;
  try {
    const records = () => t.db.combatEvent.count({ where: { roomId: t.roomId, kind: 'DECLARATION' } });
    await open(gm);
    await expect(card(gm)).toHaveCount(0);
    expect(await t.list()).toEqual([]);
    await gm.getByLabel('声明角色', { exact: true }).selectOption(t.a.id);
    await gm.getByLabel('关联目标', { exact: true }).selectOption(t.b.id);
    await expect.poll(async () => (await t.list()).length).toBe(1);
    let draft = (await t.list())[0];
    for (const page of t.pages) {
      await expect(card(page, draft.id)).toHaveAttribute('data-phase', 'settled');
      await expect(card(page, draft.id)).toHaveAttribute('data-event-id', draft.eventId);
      await expect(card(page, draft.id).locator('.is-attacker .draft-total')).toHaveText(
        String(draft.contest.attacker.total),
      );
      await expect(card(page, draft.id).locator('.is-defender .draft-total')).toHaveText(
        String(draft.contest.defender.total),
      );
      expect(await card(page, draft.id).evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
    }
    expect(await records()).toBe(0);
    await gm.screenshot({ path: info.outputPath('desktop-settled.png') });
    await b.screenshot({ path: info.outputPath('narrow-reduced.png') });
    await gm.getByLabel('关联目标', { exact: true }).selectOption(t.c.id);
    await gm.getByLabel('关联目标', { exact: true }).selectOption(t.b.id);
    await gm.getByLabel('关联目标', { exact: true }).selectOption(t.c.id);
    await expect.poll(async () => (await t.list())[0]?.contest.defender.id).toBe(t.c.id);
    draft = (await t.list())[0];
    for (const page of t.pages) {
      await expect(card(page)).toHaveCount(1);
      await expect(card(page)).toHaveAttribute('data-event-id', draft.eventId);
      await expect(card(page).locator('.is-defender > strong')).toHaveText('影狼');
    }
    await gm.getByLabel('声明角色', { exact: true }).selectOption(t.b.id);
    await expect.poll(async () => (await t.list())[0]?.contest.attacker.id).toBe(t.b.id);
    await gm.getByLabel('关联目标', { exact: true }).selectOption('');
    for (const page of t.pages) await expect(card(page)).toHaveCount(0);
    expect(await records()).toBe(0);
    await gm.getByLabel('声明角色', { exact: true }).selectOption(t.a.id);
    await gm.getByLabel('关联目标', { exact: true }).selectOption(t.b.id);
    await expect(card(gm)).toHaveAttribute('data-phase', 'settled');
    const before = (await t.list())[0],
      savedRequests: any[] = [];
    gm.on('request', (req) => {
      if (req.url().endsWith('/operations') && req.method() === 'POST') {
        const body = req.postDataJSON();
        if (body.type === 'combat.record') savedRequests.push(body);
      }
    });
    await gm.getByRole('button', { name: '保存记录', exact: true }).click();
    for (const page of t.pages) {
      await expect(page.getByLabel('战斗结果广播', { exact: true })).toBeVisible();
      await expect(card(page)).toHaveCount(0);
    }
    await expect.poll(records).toBe(1);
    const record = await t.db.combatEvent.findFirstOrThrow({ where: { roomId: t.roomId, kind: 'DECLARATION' } }),
      contest = (record.data as any).contest;
    expect([
      contest.attacker.d20,
      contest.defender.d20,
      contest.attacker.total,
      contest.defender.total,
      contest.hit,
    ]).toEqual([
      before.contest.attacker.d20,
      before.contest.defender.d20,
      before.contest.attacker.total,
      before.contest.defender.total,
      before.contest.hit,
    ]);
    expect((await t.db.combatDraft.findUniqueOrThrow({ where: { id: before.id } })).state).toBe('SAVED');
    const duplicate = await t.contexts[0].request.post(`${api}/rooms/${t.roomId}/operations`, {
      data: savedRequests[0],
    });
    expect(duplicate.status()).toBe(200);
    expect((await duplicate.json()).id).toBe(record.id);
    expect(await records()).toBe(1);
    await t.op('combat.record', savedRequests[0].payload, t.contexts[0], 409);
    await gm.getByRole('button', { name: '关闭战斗', exact: true }).click();
    await open(a);
    await a.getByLabel('关联目标', { exact: true }).selectOption(t.b.id);
    await expect(card(a)).toHaveAttribute('data-phase', 'settled');
    const playerDraft = (await t.list())[0];
    await open(gm);
    await gm.getByLabel('声明角色', { exact: true }).selectOption(t.c.id);
    await gm.getByLabel('关联目标', { exact: true }).selectOption(t.b.id);
    for (const page of t.pages) await expect(card(page)).toHaveCount(2);
    expect(new Set((await t.list()).map((d: any) => d.id)).size).toBe(2);
    await a.getByRole('button', { name: '关闭战斗', exact: true }).click();
    for (const page of t.pages) {
      await expect(card(page, playerDraft.id)).toHaveCount(0);
      await expect(card(page)).toHaveCount(1);
    }
    await gm.getByRole('button', { name: '关闭战斗', exact: true }).click();
    for (const page of t.pages) await expect(card(page)).toHaveCount(0);
    expect(await records()).toBe(1);
    await open(gm);
    await gm.getByLabel('记录类型', { exact: true }).selectOption('RESULT');
    await gm.getByLabel('声明角色', { exact: true }).selectOption(t.a.id);
    await gm.getByLabel('关联目标', { exact: true }).selectOption(t.b.id);
    await gm.getByLabel('行动或裁定内容', { exact: true }).fill('保留本次对抗的结果记录');
    await expect(card(gm)).toHaveAttribute('data-phase', 'settled');
    const resultDraft = (await t.list())[0];
    await gm.getByRole('button', { name: '保存记录', exact: true }).click();
    await expect.poll(async () => t.db.combatEvent.count({ where: { roomId: t.roomId, kind: 'RESULT' } })).toBe(1);
    const resultEvent = await t.db.combatEvent.findFirstOrThrow({ where: { roomId: t.roomId, kind: 'RESULT' } });
    expect((resultEvent.data as any).contest.attacker.d20).toBe(resultDraft.contest.attacker.d20);
    await expect(card(gm)).toHaveCount(0);
    expect(t.errors).toEqual([]);
  } finally {
    await t.cleanup();
  }
});

test('临时对抗权威边界：版本竞态、失效不补骰、私密隔离、离线恢复与失败重试', async ({ browser }) => {
  test.setTimeout(180000);
  const t = await table(browser),
    [gm, a, b] = t.pages;
  const cookies = await t.contexts[2].cookies(apiBase),
    notices: any[] = [];
  const socket = io(apiBase, {
    autoConnect: false,
    extraHeaders: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
  });
  try {
    await new Promise<void>((resolve) => {
      socket.on('connect', () => socket.emit('room:join', t.roomId, () => resolve()));
      socket.connect();
    });
    socket.on('combatDraft.changed', (data) => notices.push(data));
    const id = randomUUID(),
      body = { revision: 1, actorId: t.a.id, targetId: t.b.id, privateRecord: false };
    const initial = await t.put(id, body);
    await expect.poll(() => notices.length).toBeGreaterThan(0);
    const repeated = await t.put(id, body);
    expect(repeated.eventId).toBe(initial.eventId);
    expect(repeated.contest).toEqual(initial.contest);
    await t.put(id, body, t.contexts[1], 403);
    expect((await t.contexts[3].request.get(`${api}/rooms/${t.roomId}/combat-drafts`)).status()).toBe(403);
    await Promise.all([
      t.put(id, { ...body, revision: 3, targetId: t.c.id }),
      t.contexts[0].request.put(`${api}/rooms/${t.roomId}/combat-drafts/${id}`, { data: { ...body, revision: 2 } }),
    ]);
    expect((await t.list())[0].contest.defender.id).toBe(t.c.id);
    const latest = (await t.list())[0],
      payload = {
        kind: 'DECLARATION',
        actorId: t.a.id,
        targetId: t.c.id,
        note: '版本边界',
        draftId: id,
        draftRevision: latest.revision,
        draftEventId: latest.eventId,
      };
    await t.setDex(t.a.id, 18);
    await t.op('combat.record', payload, t.contexts[0], 409);
    expect(await t.db.combatEvent.count({ where: { roomId: t.roomId } })).toBe(0);
    expect(await t.list()).toEqual([]);
    const refreshed = await t.put(id, { ...body, revision: 4, targetId: t.c.id });
    expect(refreshed.eventId).not.toBe(latest.eventId);
    await t.db.combatDraft.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await t.put(id, { ...body, revision: 4, targetId: t.c.id }, t.contexts[0], 409);
    await t.op('combat.record', { ...payload, draftRevision: 4, draftEventId: refreshed.eventId }, t.contexts[0], 409);
    await t.close(id);
    await t.put(id, { ...body, revision: 5 }, t.contexts[0], 409);
    await t.close(randomUUID(), t.contexts[3], 403);
    const secretId = randomUUID();
    await t.put(secretId, { ...body, actorId: t.secret.id });
    await expect.poll(async () => (await t.list()).length).toBe(1);
    expect(await t.list(t.contexts[1])).toEqual([]);
    expect(await t.list(t.contexts[2])).toEqual([]);
    await t.close(secretId);
    const privateId = randomUUID();
    await t.put(privateId, { ...body, privateRecord: true });
    expect(await t.list(t.contexts[1])).toEqual([]);
    await t.close(privateId);
    await t.put(randomUUID(), { ...body, privateRecord: true }, t.contexts[1], 403);
    await t.put(randomUUID(), { ...body, actorId: t.a.id, targetId: t.secret.id }, t.contexts[1], 403);
    const field = (await t.snap()).room.sheetSchema.find((f: any) => f.fieldId === 'dex');
    await t.op('sheet.field.upsert', { version: (await t.snap()).room.version, field: { ...field, visibility: 'GM' } });
    const hiddenFieldId = randomUUID();
    await t.put(hiddenFieldId, body);
    expect(await t.list(t.contexts[1])).toEqual([]);
    expect(await t.list(t.contexts[2])).toEqual([]);
    await t.close(hiddenFieldId);
    await t.op('sheet.field.upsert', {
      version: (await t.snap()).room.version,
      field: { ...field, visibility: 'ALL' },
    });
    const expiringId = randomUUID();
    await t.put(expiringId, body);
    await expect(card(b, expiringId)).toBeVisible();
    await t.db.combatDraft.update({ where: { id: expiringId }, data: { expiresAt: new Date(Date.now() + 500) } });
    const c = (await t.snap()).characters.find((c: any) => c.id === t.c.id);
    await t.op('character.update', { id: c.id, version: c.version, patch: { description: '租约到期检查' } });
    await expect(card(b, expiringId)).toHaveCount(0);
    await t.close(expiringId);
    expect(notices.every((n) => Object.keys(n).join(',') === 'roomId' && n.roomId === t.roomId)).toBe(true);
    await open(gm);
    await gm.getByLabel('声明角色', { exact: true }).selectOption(t.a.id);
    await gm.getByLabel('关联目标', { exact: true }).selectOption(t.b.id);
    await expect(card(a)).toHaveAttribute('data-phase', 'settled');
    const active = (await t.list())[0];
    await a.reload();
    await expect(a.getByTitle('已连接', { exact: true })).toBeVisible();
    await expect(card(a)).toHaveAttribute('data-event-id', active.eventId);
    await expect(card(a)).toHaveAttribute('data-phase', 'settled');
    expect(await card(a).evaluate((e) => e.classList.contains('has-entry'))).toBe(false);
    await t.contexts[1].setOffline(true);
    await expect(card(a)).toHaveCount(0);
    await gm.getByLabel('关联目标', { exact: true }).selectOption('');
    await expect(card(gm)).toHaveCount(0);
    await t.contexts[1].setOffline(false);
    await expect(a.getByTitle('已连接', { exact: true })).toBeVisible();
    await expect(card(a)).toHaveCount(0);
    await gm.getByLabel('关联目标', { exact: true }).selectOption(t.b.id);
    await expect(card(gm)).toHaveAttribute('data-phase', 'settled');
    const prepared = (await t.list())[0];
    let attempts = 0;
    await gm.route('**/api/rooms/*/operations', async (route) => {
      if (route.request().postDataJSON().type !== 'combat.record') return route.continue();
      attempts++;
      if (attempts === 1) return route.fulfill({ status: 500, json: { error: '模拟保存前失败' } });
      if (attempts === 2) {
        await route.fetch();
        return route.abort();
      }
      return route.continue();
    });
    await gm.getByRole('button', { name: '保存记录', exact: true }).click();
    await expect(gm.getByRole('button', { name: '重试保存上次记录', exact: true })).toBeVisible();
    expect(await t.db.combatEvent.count({ where: { roomId: t.roomId } })).toBe(0);
    for (const page of t.pages) await expect(page.getByLabel('战斗结果广播', { exact: true })).toHaveCount(0);
    await gm.getByRole('button', { name: '重试保存上次记录', exact: true }).click();
    await expect.poll(async () => t.db.combatEvent.count({ where: { roomId: t.roomId } })).toBe(1);
    await expect(gm.getByRole('button', { name: '重试保存上次记录', exact: true })).toBeEnabled();
    await gm.getByRole('button', { name: '重试保存上次记录', exact: true }).click();
    await expect(gm.getByRole('button', { name: '保存记录', exact: true })).toBeVisible();
    const saved = await t.db.combatEvent.findMany({ where: { roomId: t.roomId, kind: 'DECLARATION' } });
    expect(saved).toHaveLength(1);
    expect((saved[0].data as any).contest.attacker.d20).toBe(prepared.contest.attacker.d20);
    expect((saved[0].data as any).contest.defender.d20).toBe(prepared.contest.defender.d20);
    await expect(card(gm)).toHaveCount(0);
    expect(t.errors.filter((e) => !e.includes('Failed to fetch'))).toEqual([]);
  } finally {
    socket.disconnect();
    await t.cleanup();
  }
});
