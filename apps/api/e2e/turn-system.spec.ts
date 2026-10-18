import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { api } from './server-address';
config({ path: 'apps/api/.env' });

async function setup(browser: Browser) {
  const db = new PrismaClient(),
    prefix = `turns-${randomUUID().slice(0, 8)}`,
    contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: { width: 1600, height: 1000 } }))),
    users: any[] = [];
  let roomId = '';
  const post = async (c: BrowserContext, path: string, data: unknown, status = 200) => {
    const response = await c.request.post(api + path, { data });
    expect(response.status(), await response.text()).toBe(status);
    return response.json();
  };
  const op = (type: string, payload: any, status = 200, c = contexts[0], operationId = randomUUID()) =>
    post(c, `/rooms/${roomId}/operations`, { id: operationId, type, payload }, status);
  const snap = async (c = contexts[0]) => {
    const r = await c.request.get(`${api}/rooms/${roomId}/snapshot`);
    expect(r.status()).toBe(200);
    return r.json();
  };
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
    await db.roomMember.update({ where: { roomId_userId: { roomId, userId: users[2].id } }, data: { role: 'GM' } });
    for (const field of [
      { fieldId: 'dex', name: '敏捷', type: 'number', defaultValue: 8 },
      { fieldId: 'power', name: '力量', type: 'number', defaultValue: 40 },
      { fieldId: 'note', name: '备注', type: 'text' },
    ])
      await op('sheet.field.upsert', { version: (await snap()).room.version, field });
    const a = await op('character.create', { name: '晨星', ownerId: users[1].id }),
      b = await op('character.create', { name: '松影', ownerId: users[2].id }),
      c = await op('character.create', { name: '旅者', isNpc: true }),
      hidden = await op('character.create', { name: '不可见头目', isNpc: true, visibility: 'GM' });
    const saved = async (id = a.id) => (await snap()).characters.find((c: any) => c.id === id);
    await op('character.field.set', {
      characterId: b.id,
      version: (await saved(b.id)).version,
      fieldId: 'dex',
      value: 5,
    });
    await op('character.field.set', {
      characterId: c.id,
      version: (await saved(c.id)).version,
      fieldId: 'dex',
      value: 6,
    });
    const map = await op('map.create', { name: '时序测试地图' }),
      otherMap = await op('map.create', { name: '其他地图' });
    await op('map.activate', { id: map.id });
    const token = async (characterId: string, mapId = map.id, visibility = 'PUBLIC') =>
      op('token.create', { mapId, characterId, visibility, x: 300, y: 300 });
    const ta = await token(a.id),
      tb = await token(b.id),
      tc = await token(c.id),
      th = await token(hidden.id),
      duplicate = await token(a.id),
      offMap = await token(c.id, otherMap.id);
    const weights = [
      { fieldId: 'dex', weight: 70, min: 0, max: 10, missing: 'BLOCK' },
      { fieldId: 'power', weight: 30, min: 0, max: 100, missing: 'BLOCK' },
    ];
    const preset = async () => {
      const row = await op('initiative.preset.save', { name: '默认先手', weights });
      await op('initiative.preset.select', { id: row.id, version: (await snap()).room.version });
      return row;
    };
    const definition = (name: string, turns: number | null, visibility = 'PUBLIC', customFields: any[] = []) =>
      op('tagDefinition.create', {
        name,
        icon: 'flame',
        color: '#d4af57',
        defaultVisibility: visibility,
        defaultDurationTurns: turns,
        customFields,
      });
    const attach = (d: any, characterId = a.id, remainingTurns?: number | null) =>
      op('characterTag.attach', {
        characterId,
        tagDefinitionId: d.id,
        definitionVersion: d.version,
        ...(remainingTurns !== undefined ? { remainingTurns } : {}),
      });
    const command = async (
      type: string,
      payload: any = {},
      status = 200,
      c = contexts[0],
      operationId = randomUUID(),
    ) => {
      const session = (await snap()).turnSession;
      return op(type, { sessionId: session.id, version: session.version, ...payload }, status, c, operationId);
    };
    return {
      db,
      contexts,
      roomId,
      room,
      users,
      post,
      op,
      snap,
      saved,
      a,
      b,
      c,
      hidden,
      map,
      otherMap,
      ta,
      tb,
      tc,
      th,
      duplicate,
      offMap,
      weights,
      preset,
      definition,
      attach,
      command,
      cleanup,
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
async function enter(page: Page, roomId: string) {
  await page.goto(`/rooms/${roomId}`);
  await expect(page.getByTitle('已连接', { exact: true })).toBeVisible();
}
const delay = () => new Promise((resolve) => setTimeout(resolve, 450));

async function dynamicSetup(browser: Browser, values = [60, 85, 70]) {
  const f = await setup(browser);
  try {
    for (const [i, c] of [f.a, f.b, f.c].entries())
      await f.op('character.field.set', {
        characterId: c.id,
        version: (await f.saved(c.id)).version,
        fieldId: 'dex',
        value: values[i],
      });
    const preset = await f.op('initiative.preset.save', {
      name: '动态先手',
      weights: [{ fieldId: 'dex', weight: 100, min: 0, max: 100, missing: 'BLOCK' }],
    });
    await f.op('initiative.preset.select', { id: preset.id, version: (await f.snap()).room.version });
    const advance = async () => {
      await delay();
      return f.command('turn.advance');
    };
    const dex = async (characterId: string, value: number) =>
      f.op('character.field.set', {
        characterId,
        version: (await f.saved(characterId)).version,
        fieldId: 'dex',
        value,
      });
    const start = (tokenIds = [f.ta.id, f.tb.id, f.tc.id], totalRounds: number | null = null) =>
      f.op('turn.start', { mapId: f.map.id, tokenIds, totalRounds });
    return { ...f, advance, dex, start, dynamicPreset: preset };
  } catch (error) {
    await f.cleanup();
    throw error;
  }
}

test('轮末动态重建：90→60后新首位B、双GM同轮竞争、幂等、旧响应和离线恢复', async ({ browser }, info) => {
  test.setTimeout(180000);
  const f = await dynamicSetup(browser);
  try {
    const boost = await f.definition('加速', 1, 'PUBLIC', [{ name: '敏捷', value: 30 }]),
      countdown = await f.definition('末位倒计时', 3);
    await f.attach(boost);
    const cState = await f.attach(countdown, f.c.id);
    await f.start();
    const gm = await f.contexts[0].newPage(),
      player = await f.contexts[1].newPage();
    await enter(gm, f.roomId);
    await enter(player, f.roomId);
    const hud = gm.getByRole('region', { name: '回合顺序', exact: true }),
      playerHud = player.getByRole('region', { name: '回合顺序', exact: true }),
      original = await f.snap();
    expect(original.turnSession.participants.map((p: any) => p.score)).toEqual([90, 85, 70]);
    for (const page of [gm, player])
      await page.evaluate(() => {
        (window as any).__roundObservations = [];
        const progress = { starts: 0, maxFraction: 0, reset: false };
        (window as any).__roundProgress = progress;
        const hud = document.querySelector('.turn-hud')!;
        let completing = false;
        const sample = () => {
          const track = hud.querySelector<HTMLElement>('.turn-hud-progress')!;
          if (track.dataset.phase !== 'complete') return;
          progress.maxFraction = Math.max(
            progress.maxFraction,
            track.firstElementChild!.getBoundingClientRect().width / track.getBoundingClientRect().width,
          );
          requestAnimationFrame(sample);
        };
        new MutationObserver(() => {
          const phase = hud.querySelector<HTMLElement>('.turn-hud-progress')?.dataset.phase === 'complete';
          if (phase && !completing) {
            progress.starts++;
            requestAnimationFrame(sample);
          }
          if (!phase && completing) progress.reset = true;
          completing = phase;
        }).observe(hud, { childList: true, subtree: true, attributes: true });
        new MutationObserver(() =>
          (window as any).__roundObservations.push({
            round: hud.getAttribute('data-round'),
            first: hud.querySelector('[data-actor-id]')?.getAttribute('data-actor-id'),
            current: hud.querySelector('[data-current="true"]')?.getAttribute('data-actor-id'),
          }),
        ).observe(hud, { childList: true, subtree: true, attributes: true });
      });
    await f.advance();
    expect((await f.saved()).derived.values.dex).toBe(60);
    let s = (await f.snap()).turnSession;
    expect(s.participants.map((p: any) => p.characterId)).toEqual([f.a.id, f.b.id, f.c.id]);
    expect(s.participants[0].score).toBe(90);
    expect(s.currentCharacterId).toBe(f.b.id);
    await f.advance();
    await expect(hud.locator('[data-current="true"]')).toHaveAttribute('data-actor-id', f.c.id);
    await f.contexts[1].setOffline(true);
    await expect(player.getByTitle('已连接', { exact: true })).toHaveCount(0);
    s = (await f.snap()).turnSession;
    await delay();
    const payload = { sessionId: s.id, version: s.version },
      ids = [randomUUID(), randomUUID()],
      gmContexts = [f.contexts[0], f.contexts[2]],
      responses = await Promise.all(
        gmContexts.map((c, i) =>
          c.request.post(`${api}/rooms/${f.roomId}/operations`, {
            data: { id: ids[i], type: 'turn.advance', payload },
          }),
        ),
      );
    expect(responses.map((r) => r.status()).sort()).toEqual([200, 409]);
    const winner = responses.findIndex((r) => r.status() === 200),
      result = await responses[winner].json();
    const retries = await Promise.all(
      Array.from({ length: 8 }, () => f.op('turn.advance', payload, 200, gmContexts[winner], ids[winner])),
    );
    expect(retries.every((r) => r.afterVersion === result.afterVersion)).toBe(true);
    const fresh = await f.snap();
    expect(fresh.turnSession).toMatchObject({ round: 2, currentCharacterId: f.b.id, version: s.version + 1 });
    expect(fresh.turnSession.participants.map((p: any) => [p.characterId, p.score])).toEqual([
      [f.b.id, 85],
      [f.c.id, 70],
      [f.a.id, 60],
    ]);
    expect(fresh.turnSession.participants.every((p: any) => p.lastActedRound === 0)).toBe(true);
    expect(fresh.characterTags.find((t: any) => t.id === cState.id).remainingTurns).toBe(2);
    await expect(hud).toHaveAttribute('data-round', '2');
    await expect(hud.locator('[data-current="true"]')).toHaveAttribute('data-actor-id', f.b.id);
    await expect.poll(() => gm.evaluate(() => (window as any).__roundProgress.maxFraction)).toBeGreaterThan(0.98);
    await expect(hud.getByRole('progressbar')).toHaveAttribute('data-phase', 'normal');
    await expect(hud.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(await gm.evaluate(() => (window as any).__roundProgress)).toMatchObject({ starts: 1, reset: true });
    expect(
      await gm.evaluate(
        (first: string) =>
          (window as any).__roundObservations
            .filter((r: any) => r.round === '2')
            .every((r: any) => r.first === first && r.current === first),
        f.b.id,
      ),
    ).toBe(true);
    let staleServed = false;
    await gm.route(`**/api/rooms/${f.roomId}/snapshot`, async (route) => {
      if (!staleServed) {
        staleServed = true;
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(original) });
      } else await route.continue();
    });
    await gm.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => staleServed).toBe(true);
    await expect(hud).toHaveAttribute('data-version', String(s.version + 1));
    await expect(hud.locator('[data-current="true"]')).toHaveAttribute('data-actor-id', f.b.id);
    await gm.unroute(`**/api/rooms/${f.roomId}/snapshot`);
    await f.contexts[1].setOffline(false);
    await expect(player.getByTitle('已连接', { exact: true })).toBeVisible();
    await expect(playerHud).toHaveAttribute('data-round', '2');
    await expect(playerHud.locator('[data-actor-id]')).toHaveCount(3);
    expect(
      await playerHud
        .locator('[data-actor-id]')
        .evaluateAll((rows) => rows.map((e) => e.getAttribute('data-actor-id'))),
    ).toEqual([f.b.id, f.c.id, f.a.id]);
    await expect(playerHud.locator('[data-current="true"]')).toHaveAttribute('data-actor-id', f.b.id);
    await expect(playerHud.locator('.has-acted')).toHaveCount(0);
    expect(await player.evaluate(() => (window as any).__roundProgress.starts)).toBe(0);
    expect((await f.snap()).characterTags.find((t: any) => t.id === cState.id).remainingTurns).toBe(2);
    await gm.screenshot({ path: info.outputPath('turn-dynamic-round.png') });
    await player.emulateMedia({ reducedMotion: 'reduce' });
    await expect(playerHud.locator('[data-current="true"]')).toHaveAttribute('data-actor-id', f.b.id);
    expect((await f.snap(f.contexts[1])).turnSession.participants.every((p: any) => p.score === undefined)).toBe(true);
    await f.advance();
    await f.advance();
    await f.advance();
    await expect(playerHud).toHaveAttribute('data-round', '3');
    await expect(playerHud.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(await player.evaluate(() => (window as any).__roundProgress.starts)).toBe(0);
  } finally {
    await f.contexts[1].setOffline(false);
    await f.cleanup();
  }
});

test('末位连续状态到期：C从60变100，新轮首位直接为C且三人各行动一次', async ({ browser }) => {
  const f = await dynamicSetup(browser, [90, 80, 100]);
  try {
    for (const name of ['束缚', '迟缓'])
      await f.attach(await f.definition(name, 1, 'PUBLIC', [{ name: '敏捷', value: -20 }]), f.c.id);
    await f.start();
    expect((await f.snap()).turnSession.participants.map((p: any) => p.score)).toEqual([90, 80, 60]);
    await f.advance();
    await f.advance();
    await f.advance();
    const s = (await f.snap()).turnSession;
    expect(s).toMatchObject({ round: 2, currentCharacterId: f.c.id });
    expect(s.participants.map((p: any) => [p.characterId, p.score])).toEqual([
      [f.c.id, 100],
      [f.a.id, 90],
      [f.b.id, 80],
    ]);
    expect((await f.snap()).characterTags).toHaveLength(0);
    expect((await f.saved(f.c.id)).derived.values.dex).toBe(100);
    const visited = [];
    for (let i = 0; i < 3; i++) {
      visited.push((await f.snap()).turnSession.currentCharacterId);
      await f.advance();
    }
    expect(visited).toEqual([f.c.id, f.a.id, f.b.id]);
    expect((await f.snap()).turnSession.round).toBe(3);
  } finally {
    await f.cleanup();
  }
});

test('中途减速与基础属性变化：本轮B仍先于C，下一轮才使用新属性', async ({ browser }) => {
  const f = await dynamicSetup(browser, [90, 80, 70]);
  try {
    await f.start();
    await f.advance();
    await f.attach(await f.definition('持续减速', null, 'PUBLIC', [{ name: '敏捷', value: -30 }]), f.b.id);
    await f.dex(f.a.id, 88);
    let s = (await f.snap()).turnSession;
    expect(s.participants.map((p: any) => p.score)).toEqual([90, 80, 70]);
    expect(s.currentCharacterId).toBe(f.b.id);
    expect((await f.saved(f.b.id)).derived.values.dex).toBe(50);
    await f.advance();
    expect((await f.snap()).turnSession.currentCharacterId).toBe(f.c.id);
    await f.advance();
    s = (await f.snap()).turnSession;
    expect(s.participants.map((p: any) => [p.characterId, p.score])).toEqual([
      [f.a.id, 88],
      [f.c.id, 70],
      [f.b.id, 50],
    ]);
    expect(s.currentCharacterId).toBe(f.a.id);
  } finally {
    await f.cleanup();
  }
});

test('GM中途重算：保留当前C，之后按新队列D再E；已行动者不复活，同分保留人工顺序', async ({ browser }) => {
  const f = await dynamicSetup(browser, [90, 80, 70]);
  try {
    const d = await f.op('character.create', { name: '守望者', isNpc: true }),
      e = await f.op('character.create', { name: '第五旅人', isNpc: true });
    await f.dex(d.id, 60);
    await f.dex(e.id, 50);
    const td = await f.op('token.create', { mapId: f.map.id, characterId: d.id, x: 100, y: 100 }),
      te = await f.op('token.create', { mapId: f.map.id, characterId: e.id, x: 200, y: 100 });
    await f.start([f.ta.id, f.tb.id, f.tc.id, td.id, te.id]);
    await f.advance();
    await f.advance();
    for (const [id, value] of [
      [d.id, 100],
      [f.a.id, 95],
      [f.c.id, 85],
      [e.id, 80],
      [f.b.id, 75],
    ] as const)
      await f.dex(id, value);
    await f.command('turn.recalculate');
    let s = (await f.snap()).turnSession;
    expect(s.currentCharacterId).toBe(f.c.id);
    expect(s.participants.map((p: any) => p.characterId)).toEqual([d.id, f.a.id, f.c.id, e.id, f.b.id]);
    expect(
      s.participants
        .filter((p: any) => p.lastActedRound === 1)
        .map((p: any) => p.characterId)
        .sort(),
    ).toEqual([f.a.id, f.b.id].sort());
    await f.advance();
    expect((await f.snap()).turnSession.currentCharacterId).toBe(d.id);
    await f.advance();
    expect((await f.snap()).turnSession.currentCharacterId).toBe(e.id);
    await f.advance();
    expect((await f.snap()).turnSession).toMatchObject({ round: 2, currentCharacterId: d.id });
    const manual = [f.b.id, f.a.id, f.c.id, e.id, d.id];
    await f.command('turn.order', { characterIds: manual });
    for (const id of manual) await f.dex(id, 50);
    await f.command('turn.recalculate');
    s = (await f.snap()).turnSession;
    expect(s.participants.map((p: any) => p.characterId)).toEqual(manual);
    expect(s.currentCharacterId).toBe(d.id);
    await f.advance();
    expect((await f.snap()).turnSession.currentCharacterId).toBe(f.b.id);
    for (let i = 0; i < 4; i++) await f.advance();
    s = (await f.snap()).turnSession;
    expect(s).toMatchObject({ round: 3, currentCharacterId: f.b.id });
    expect(s.participants.map((p: any) => p.characterId)).toEqual(manual);
  } finally {
    await f.cleanup();
  }
});

test('单人/上限/延长/空队列与中途加入：无额外扣减，等待后可恢复', async ({ browser }) => {
  const f = await dynamicSetup(browser, [90, 80, 70]);
  try {
    const tag = await f.attach(await f.definition('单人计时', 3));
    await f.start([f.ta.id], 1);
    await f.advance();
    let snapshot = await f.snap();
    expect(snapshot.turnSession).toMatchObject({ round: 1, status: 'LIMIT', currentCharacterId: null });
    expect(snapshot.characterTags.find((t: any) => t.id === tag.id).remainingTurns).toBe(2);
    await f.dex(f.a.id, 50);
    await f.command('turn.total', { totalRounds: null });
    snapshot = await f.snap();
    expect(snapshot.turnSession).toMatchObject({ round: 2, currentCharacterId: f.a.id });
    expect(snapshot.turnSession.participants[0].score).toBe(50);
    await f.advance();
    expect((await f.snap()).turnSession).toMatchObject({ round: 3, currentCharacterId: f.a.id });
    await f.command('turn.remove', { characterId: f.a.id });
    snapshot = await f.snap();
    expect(snapshot.turnSession).toMatchObject({
      status: 'PAUSED',
      round: 3,
      currentCharacterId: null,
      participants: [],
    });
    expect(snapshot.characterTags.find((t: any) => t.id === tag.id).remainingTurns).toBe(1);
    await f.command('turn.resume', {}, 409);
    await f.command('turn.add', { tokenId: f.tb.id, nextRound: true });
    expect((await f.snap()).turnSession.currentCharacterId).toBeNull();
    await f.command('turn.resume');
    expect((await f.snap()).turnSession).toMatchObject({ round: 4, currentCharacterId: f.b.id, status: 'ACTIVE' });
    await f.command('turn.add', { tokenId: f.ta.id, nextRound: false });
    expect((await f.snap()).turnSession.currentCharacterId).toBe(f.b.id);
    await f.command('turn.remove', { characterId: f.b.id });
    expect((await f.snap()).turnSession).toMatchObject({ round: 4, currentCharacterId: f.a.id });
    expect((await f.snap()).characterTags.find((t: any) => t.id === tag.id).remainingTurns).toBe(1);
    await f.advance();
    expect((await f.snap()).turnSession).toMatchObject({ round: 5, currentCharacterId: f.a.id });
    expect((await f.snap()).characterTags).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

test('轮末配置失效时整笔回滚，恢复配置可用同一请求重试，不丢状态或生成半轮', async ({ browser }) => {
  const f = await dynamicSetup(browser, [90, 80, 70]);
  try {
    const tag = await f.attach(await f.definition('最后一人加成', 1, 'PUBLIC', [{ name: '敏捷', value: 5 }]), f.b.id);
    await f.start([f.ta.id, f.tb.id]);
    await f.advance();
    await delay();
    await f.command('initiative.preset.delete', { id: f.dynamicPreset.id, version: f.dynamicPreset.version });
    const before = await f.snap(),
      operationId = randomUUID(),
      payload = { sessionId: before.turnSession.id, version: before.turnSession.version };
    await f.op('turn.advance', payload, 400, f.contexts[0], operationId);
    const after = await f.snap();
    expect(after.turnSession).toEqual(before.turnSession);
    expect(after.characterTags.find((t: any) => t.id === tag.id)).toEqual(
      before.characterTags.find((t: any) => t.id === tag.id),
    );
    expect((await f.saved(f.b.id)).derived.values.dex).toBe(85);
    expect(await f.db.operationReceipt.findUnique({ where: { id: operationId } })).toBeNull();
    await f.preset();
    await f.op('turn.advance', payload, 200, f.contexts[0], operationId);
    expect((await f.snap()).turnSession.round).toBe(2);
    expect((await f.snap()).characterTags).toHaveLength(0);
    expect((await f.saved(f.b.id)).derived.values.dex).toBe(80);
  } finally {
    await f.cleanup();
  }
});

test('单连接压力与大量人物：重复请求只扣一次、快照一致、HUD滚动与无耗时切换', async ({ browser }, info) => {
  test.setTimeout(180000);
  const f = await setup(browser);
  try {
    await f.preset();
    const status = await f.definition('短效敏捷', 1, 'PUBLIC', [{ name: '敏捷', value: 2 }]);
    await f.attach(status);
    const tokens = [f.ta.id, f.tb.id, f.tc.id];
    for (let i = 0; i < 17; i++) {
      const c = await f.op('character.create', { name: `队列人物${i + 1}`, isNpc: true });
      const t = await f.op('token.create', { mapId: f.map.id, characterId: c.id, x: 100 + i * 20, y: 500 });
      tokens.push(t.id);
    }
    await f.op('turn.start', { mapId: f.map.id, tokenIds: tokens });
    const gm = await f.contexts[0].newPage();
    await enter(gm, f.roomId);
    const hud = gm.getByRole('region', { name: '回合顺序', exact: true });
    await expect(hud.locator('.turn-hud-person')).toHaveCount(20);
    const box = await hud.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(680);
    const s = (await f.snap()).turnSession,
      operationId = randomUUID(),
      payload = { sessionId: s.id, version: s.version };
    const responses = await Promise.all([
      ...Array.from({ length: 8 }, () =>
        f.contexts[0].request.post(`${api}/rooms/${f.roomId}/operations`, {
          data: { id: operationId, type: 'turn.advance', payload },
        }),
      ),
      ...Array.from({ length: 8 }, () => f.contexts[1].request.get(`${api}/rooms/${f.roomId}/snapshot`)),
    ]);
    expect(responses.map((r) => r.status())).toEqual(Array(16).fill(200));
    const data = await Promise.all(responses.map((r) => r.json()));
    expect(new Set(data.slice(0, 8).map((row) => row.afterVersion))).toEqual(new Set([1]));
    for (const snapshot of data.slice(8)) {
      const state = snapshot.characterTags.some((tag: any) => tag.tagDefinitionId === status.id);
      expect(state).toBe(snapshot.turnSession.version === 0);
      expect(snapshot.characters.find((c: any) => c.id === f.a.id).derived.values.dex).toBe(state ? 10 : 8);
    }
    expect((await f.snap()).turnSession.version).toBe(1);
    expect((await f.saved()).derived.values.dex).toBe(8);
    const current = (await f.snap()).turnSession,
      last = current.participants.at(-1);
    await f.command('turn.focus', { characterId: last.characterId });
    await expect(hud.locator('[data-current="true"]')).toContainText(last.name);
    await expect.poll(() => hud.locator('.turn-hud-list').evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const a = await hud.locator('[data-current="true"]').boundingBox(),
          b = await hud.locator('.turn-hud-list').boundingBox();
        return !!a && !!b && a.x >= b.x && a.x + a.width <= b.x + b.width;
      })
      .toBe(true);
    await gm.screenshot({ path: info.outputPath('turn-hud-many.png') });
    await f.command('turn.end');

    // Six visible people show current/acted/pending states and two-line names together.
    const longName = '艾瑞莉娅·暮色守望者';
    await f.op('character.update', { id: f.c.id, version: (await f.saved(f.c.id)).version, patch: { name: longName } });
    const focused = await f.definition('专注', 3),
      frost = await f.definition('霜印', 5);
    await f.attach(focused, f.b.id);
    await f.attach(frost, f.c.id);
    const six = tokens.slice(0, 6);
    const characterIds = six.map((id) => (s.participants as any[]).find((p) => p.tokenId === id)!.characterId);
    await f.op('turn.start', { mapId: f.map.id, tokenIds: six });
    await f.command('turn.order', { characterIds });
    await f.command('turn.focus', { characterId: f.a.id });
    await f.command('turn.advance');
    await expect(hud.locator('[data-current="true"]')).toHaveAttribute('data-actor-id', f.b.id);
    await expect(hud.locator('[data-state="acted"]')).toHaveCount(1);
    await expect(hud.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
    await expect(hud.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '6');
    const name = hud.locator('.turn-hud-name').filter({ hasText: longName });
    await expect(name).toHaveAttribute('title', longName);
    expect(await name.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe('normal');
    expect(await name.evaluate((e) => e.getBoundingClientRect().height)).toBeLessThanOrEqual(39);
    const desktop = (await hud.boundingBox())!;
    expect(desktop.y).toBeLessThanOrEqual(70);
    expect(desktop.height).toBeLessThan(235);
    expect(desktop.width).toBeLessThanOrEqual(600);
    await gm.screenshot({ path: info.outputPath('turn-hud-fantasy.png'), animations: 'disabled' });
    await gm.emulateMedia({ reducedMotion: 'reduce' });
    await gm.setViewportSize({ width: 720, height: 880 });
    await expect(hud).toBeVisible();
    let narrow = (await hud.boundingBox())!;
    expect(narrow.y).toBeLessThanOrEqual(126);
    expect(narrow.height).toBeLessThan(230);
    expect(narrow.x).toBeGreaterThanOrEqual(78);
    expect(narrow.x + narrow.width).toBeLessThanOrEqual(720);
    const party = (await gm.locator('.party-panel').boundingBox())!;
    expect(narrow.x + narrow.width + 12).toBeLessThanOrEqual(party.x);
    expect(
      await hud
        .locator('[data-current="true"] .turn-hud-avatar')
        .evaluate((e) => getComputedStyle(e, '::before').animationName),
    ).toBe('none');
    await gm.screenshot({ path: info.outputPath('turn-hud-fantasy-720.png'), animations: 'disabled' });
    await gm.setViewportSize({ width: 480, height: 880 });
    narrow = (await hud.boundingBox())!;
    expect(narrow.y).toBeLessThanOrEqual(126);
    expect(narrow.height).toBeLessThan(230);
    expect(narrow.x).toBeGreaterThanOrEqual(78);
    expect(narrow.x + narrow.width).toBeLessThanOrEqual(480);
    expect(await hud.locator('.turn-hud-list').evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
    await gm.screenshot({ path: info.outputPath('turn-hud-fantasy-480.png'), animations: 'disabled' });
    await f.command('turn.end');
    expect((await f.snap()).combatEvents).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});

test('回合窗口与多人HUD：权重、人物覆盖、状态独立持续时间、到期撤销、轮数上限及重连', async ({ browser }, info) => {
  test.setTimeout(210000);
  const f = await setup(browser);
  try {
    const [gm, player] = await Promise.all(f.contexts.slice(0, 2).map((c) => c.newPage())),
      errors: string[] = [];
    for (const p of [gm, player]) {
      p.on('pageerror', (e) => errors.push(e.message));
      await enter(p, f.roomId);
    }
    await expect(gm.getByRole('region', { name: '回合顺序', exact: true })).toHaveCount(0);
    await expect(player.locator('.game-rail button[title="回合系统"]')).toHaveCount(0);
    await gm.getByTitle('先手权重配置', { exact: true }).click();
    const weights = gm.locator('.turn-panel');
    await weights.getByLabel('先手模板名称', { exact: true }).fill('冒险先手');
    await weights.getByRole('button', { name: '添加属性', exact: true }).click();
    await weights.getByLabel('属性 1', { exact: true }).selectOption('dex');
    await weights.getByLabel('权重 1', { exact: true }).fill('70');
    await weights.getByLabel('量表上限 1', { exact: true }).fill('10');
    await weights.getByRole('button', { name: '添加属性', exact: true }).click();
    await weights.getByLabel('属性 2', { exact: true }).selectOption('power');
    await weights.getByLabel('权重 2', { exact: true }).fill('30');
    await weights.getByRole('button', { name: '保存先手模板', exact: true }).click();
    await expect(weights.getByRole('status')).toContainText('模板已保存');
    await weights.getByRole('button', { name: '设为全局模板', exact: true }).click();
    await expect(weights.getByRole('status')).toContainText('已设为全局模板');
    await gm.getByRole('button', { name: '关闭先手权重配置', exact: true }).click();
    await gm.locator('.game-rail button[title="角色"]').click();
    await gm.getByRole('button', { name: '晨星', exact: true }).click();
    await gm.getByRole('button', { name: '关闭角色', exact: true }).click();
    const individual = gm.locator('.character-initiative');
    await individual.locator('summary').first().click();
    await individual.getByLabel('额外先手修正', { exact: true }).fill('2');
    await individual.getByRole('button', { name: '保存人物先手', exact: true }).click();
    await expect(individual.getByRole('status')).toContainText('已保存');
    expect((await f.saved()).initiativeConfig.bonus).toBe(2);
    await gm.getByRole('button', { name: '关闭人物卡', exact: true }).click();
    await gm.locator('.game-rail button[title="状态"]').click();
    await gm.getByRole('button', { name: '新建状态定义', exact: true }).click();
    const editor = gm.locator('.tag-definition-editor');
    await editor.getByLabel('状态名称', { exact: true }).fill('时序流血');
    await editor.getByLabel('持续回合数持续方式', { exact: true }).selectOption('finite');
    await editor.getByLabel('持续回合数', { exact: true }).fill('3');
    await editor.getByRole('button', { name: '保存状态定义', exact: true }).click();
    await expect(editor).toHaveCount(0);
    const bleed = (await f.snap()).tagDefinitions.find((d: any) => d.name === '时序流血');
    expect(bleed.defaultDurationTurns).toBe(3);
    await gm.getByRole('button', { name: '关闭状态库', exact: true }).click();
    const boost = await f.definition('临时迅捷', 1, 'PUBLIC', [{ name: '敏捷', value: 2 }]),
      secret = await f.definition('秘密计时', 1, 'GM_ONLY'),
      permanent = await f.definition('永久誓约', null);
    await gm.locator('.game-rail button[title="角色"]').click();
    await gm.getByRole('button', { name: '晨星', exact: true }).click();
    await gm.getByRole('button', { name: '关闭角色', exact: true }).click();
    await gm.locator('.sheet-actions').getByRole('button', { name: '管理状态', exact: true }).click();
    await gm.getByRole('button', { name: '关闭人物卡', exact: true }).click();
    const manager = gm.locator('.tag-manager');
    await manager.getByRole('button', { name: '从状态库选择', exact: true }).click();
    await manager.getByRole('button', { name: '时序流血', exact: false }).click();
    await expect(manager.getByLabel('剩余回合数', { exact: true })).toHaveValue('3');
    await manager.getByRole('button', { name: '添加到此角色', exact: true }).click();
    await expect(manager.locator('.tag-attach-form')).toHaveCount(0);
    await gm.getByRole('button', { name: '关闭角色状态', exact: true }).click();
    const aBleed = (await f.snap()).characterTags.find(
        (tag: any) => tag.tagDefinitionId === bleed.id && tag.characterId === f.a.id,
      ),
      bBleed = await f.attach(bleed, f.b.id, 5),
      boostState = await f.attach(boost);
    await f.attach(secret);
    await f.attach(permanent);
    await gm.getByTitle('回合系统', { exact: true }).click();
    const panel = gm.locator('.turn-panel');
    await expect(panel).toContainText('时序测试地图');
    await expect(panel.getByLabel('参战 晨星', { exact: true })).toHaveCount(1);
    await expect(panel).not.toContainText('其他地图');
    await panel.getByLabel('参战 晨星', { exact: true }).check();
    await panel.getByLabel('参战 松影', { exact: true }).check();
    await panel.getByLabel('预计总轮数', { exact: true }).fill('1');
    await panel.getByRole('button', { name: '进入回合模式', exact: true }).click();
    await expect(panel.getByRole('button', { name: '结束当前回合', exact: true })).toBeVisible();
    await gm.getByRole('button', { name: '关闭回合系统', exact: true }).click();
    const hud = gm.getByRole('region', { name: '回合顺序', exact: true }),
      playerHUD = player.getByRole('region', { name: '回合顺序', exact: true });
    await expect(hud).toBeVisible();
    await expect(playerHUD).toBeVisible();
    await expect(hud.locator('[data-current="true"]')).toContainText('晨星');
    await expect(playerHUD).not.toContainText('秘密计时');
    await expect(playerHUD.getByLabel('晨星：时序流血 剩余 3 回合', { exact: true })).toBeVisible();
    await expect(gm.getByRole('button', { name: '关闭回合系统', exact: true })).toHaveCount(0);
    expect(
      await hud.locator('header .eyebrow').evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
    ).toBeGreaterThanOrEqual(14);
    expect(
      await hud
        .locator('.turn-hud-name')
        .first()
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
    ).toBeGreaterThanOrEqual(14);
    await gm.screenshot({ path: info.outputPath('turn-hud-desktop.png') });
    const old = (await f.snap()).turnSession;
    expect(old.participants.map((p: any) => p.characterId)).toEqual([f.a.id, f.b.id]);
    expect(old.participants[0].score).toBe(84);
    await gm.getByRole('button', { name: '结束回合', exact: true }).dblclick();
    await expect(playerHUD.locator('[data-current="true"]')).toContainText('松影');
    await expect(playerHUD.getByLabel('晨星：时序流血 剩余 2 回合', { exact: true })).toBeVisible();
    await expect.poll(async () => (await f.snap()).turnSession.version).toBe(1);
    let snapshot = await f.snap();
    expect(snapshot.characterTags.find((s: any) => s.id === aBleed.id).remainingTurns).toBe(2);
    expect(snapshot.characterTags.find((s: any) => s.id === bBleed.id).remainingTurns).toBe(5);
    expect(snapshot.characterTags.some((s: any) => s.id === boostState.id)).toBe(false);
    expect((await f.saved()).derived.values.dex).toBe(8);
    expect(snapshot.turnSession.participants[0].score).toBe(84);
    expect(snapshot.characterTags.find((s: any) => s.definition.name === '永久誓约').remainingTurns).toBeNull();
    expect((await f.snap(f.contexts[1])).turnSession.transition.changed.map((s: any) => s.name)).not.toContain(
      '秘密计时',
    );
    await expect(gm.getByRole('button', { name: '结束回合', exact: true })).toBeEnabled();
    await delay();
    await gm.getByRole('button', { name: '结束回合', exact: true }).click();
    await expect(gm.getByLabel('回合计数器', { exact: true })).toContainText('已达预计轮数');
    expect((await f.snap()).turnSession).toMatchObject({ round: 1, status: 'LIMIT' });
    const endControl = gm.locator('.turn-end-control');
    await expect(endControl.getByRole('button', { name: '结束回合模式', exact: true })).toBeEnabled();
    await expect(
      player.locator('.turn-end-control').getByRole('button', { name: '结束回合模式', exact: true }),
    ).toHaveCount(0);
    gm.once('dialog', (d) => d.dismiss());
    await endControl.getByRole('button', { name: '结束回合模式', exact: true }).click();
    expect((await f.snap()).turnSession.status).toBe('LIMIT');
    await gm.screenshot({ path: info.outputPath('turn-limit-actions.png') });
    await endControl.getByRole('button', { name: '延长轮数', exact: true }).click();
    await gm.locator('.turn-panel').getByRole('button', { name: '改为不限轮数', exact: true }).click();
    await expect(gm.getByLabel('回合计数器', { exact: true })).toContainText('第 2 轮');
    await gm.getByRole('button', { name: '关闭回合系统', exact: true }).click();
    await player.reload();
    await expect(playerHUD.locator('[data-current="true"]')).toContainText('晨星');
    await expect(playerHUD.locator('.is-expiring')).toHaveCount(0);
    expect((await f.snap()).characterTags.find((s: any) => s.id === aBleed.id).remainingTurns).toBe(2);
    await player.emulateMedia({ reducedMotion: 'reduce' });
    await player.setViewportSize({ width: 720, height: 880 });
    await expect(playerHUD).toBeVisible();
    const bounds = await playerHUD.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(78);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(720);
    await expect(player.locator('.konvajs-content').first()).toBeVisible();
    expect(
      await playerHUD
        .locator('.turn-hud-name')
        .first()
        .evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
    ).toBeGreaterThanOrEqual(13);
    await player.screenshot({ path: info.outputPath('turn-hud-compact.png') });
    await gm.getByTitle('回合系统', { exact: true }).click();
    await gm.locator('.turn-panel').getByRole('button', { name: '暂停回合', exact: true }).click();
    await expect(player.getByLabel('回合计数器', { exact: true })).toContainText('已暂停');
    for (const page of [gm, player])
      await page.evaluate(() => {
        (window as any).__turnExit = { frames: [], inert: false, animation: '', duration: '', pointerEvents: '' };
        new MutationObserver(() => {
          const node = document.querySelector<HTMLElement>('.turn-hud.is-leaving');
          if (!node || (window as any).__turnExit.animation) return;
          const style = getComputedStyle(node),
            result = (window as any).__turnExit;
          Object.assign(result, {
            inert: node.inert,
            animation: style.animationName,
            duration: style.animationDuration,
            pointerEvents: style.pointerEvents,
          });
          const sample = () => {
            if (!node.isConnected) return;
            result.frames.push(Number(getComputedStyle(node).opacity));
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
      });
    gm.once('dialog', (d) => d.accept());
    await gm.locator('.turn-panel').getByRole('button', { name: '结束回合模式', exact: true }).click();
    await expect(hud).toHaveCount(0);
    await expect(playerHUD).toHaveCount(0);
    await expect(gm.locator('.turn-hud')).toHaveCount(0);
    const exit = await gm.evaluate(() => (window as any).__turnExit);
    expect(exit).toMatchObject({ inert: true, animation: 'turn-hud-exit', duration: '0.24s', pointerEvents: 'none' });
    expect(exit.frames.some((opacity: number) => opacity < 0.9)).toBe(true);
    expect(await player.evaluate(() => (window as any).__turnExit.animation)).toBe('');
    snapshot = await f.snap();
    expect(snapshot.characterTags.find((s: any) => s.id === aBleed.id).remainingTurns).toBe(2);
    expect(snapshot.combatEvents).toHaveLength(0);
    await gm.getByRole('button', { name: '关闭回合系统', exact: true }).click();
    await expect(gm.getByRole('button', { name: '关闭回合系统', exact: true })).toHaveCount(0);
    await f.op('turn.start', { mapId: f.map.id, tokenIds: [f.ta.id], totalRounds: 1 });
    await expect(endControl.getByRole('button', { name: '结束回合', exact: true })).toBeEnabled();
    await endControl.getByRole('button', { name: '结束回合', exact: true }).click();
    await expect(endControl.getByRole('button', { name: '结束回合模式', exact: true })).toBeEnabled();
    expect((await f.snap()).characterTags.find((s: any) => s.id === aBleed.id).remainingTurns).toBe(1);
    let failedEnds = 0;
    await gm.route('**/api/rooms/*/operations', async (route) => {
      if (route.request().postDataJSON().type === 'turn.end') {
        failedEnds++;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ error: '验证结束失败后可重试' }),
        });
      } else await route.continue();
    });
    gm.once('dialog', (d) => d.accept());
    await endControl.getByRole('button', { name: '结束回合模式', exact: true }).click();
    await expect(endControl.getByRole('alert')).toContainText('验证结束失败后可重试');
    expect(failedEnds).toBe(2);
    await gm.screenshot({ path: info.outputPath('turn-end-retry.png') });
    expect((await f.snap()).turnSession.status).toBe('LIMIT');
    await gm.unroute('**/api/rooms/*/operations');
    gm.once('dialog', (d) => d.accept());
    await endControl.getByRole('button', { name: '结束回合模式', exact: true }).click();
    await expect(hud).toHaveCount(0);
    await expect(playerHUD).toHaveCount(0);
    expect((await f.snap()).turnSession).toBeNull();
    expect((await f.snap()).characterTags.find((s: any) => s.id === aBleed.id).remainingTurns).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test('服务器权威与并发：幂等、双GM、权限、私密过滤、地图绑定、增减与固定排序', async ({ browser }) => {
  test.setTimeout(180000);
  const f = await setup(browser);
  try {
    const preset = await f.preset();
    await f.op('initiative.character', {
      characterId: f.a.id,
      version: (await f.saved()).version,
      config: { bonus: 0 },
    });
    const trait = await f.op('template.create', { name: '无数值特性', kind: 'TRAIT', data: {} });
    await f.op('template.apply', { characterId: f.a.id, templateId: trait.id });
    const actor = await f.saved();
    const response = await f.op(
      'template.enable',
      { characterId: f.a.id, version: actor.version, field: 'traits', instanceId: actor.traits[0].id, enabled: false },
      200,
      f.contexts[1],
    );
    expect(response).not.toHaveProperty('initiativeConfig');
    const lobby = await f.contexts[1].request.get(api + '/rooms');
    expect((await lobby.json()).find((room: any) => room.id === f.roomId)).not.toHaveProperty('initiativePresetId');

    await f.op(
      'initiative.character',
      { characterId: f.a.id, version: (await f.saved()).version, config: { bonus: 3 } },
      403,
      f.contexts[1],
    );
    await f.op(
      'initiative.preset.save',
      { name: '错误模板', weights: [{ ...f.weights[0], fieldId: 'note', weight: 100 }] },
      400,
    );
    await f.op('initiative.preset.save', { name: '错误权重', weights: [{ ...f.weights[0], weight: 99 }] }, 400);
    await f.op('turn.start', { mapId: f.map.id, tokenIds: [f.ta.id, f.duplicate.id] }, 400);
    await f.op('turn.start', { mapId: f.map.id, tokenIds: [f.ta.id, f.offMap.id] }, 400);
    const d = await f.definition('倒计时', 3),
      expire = await f.definition('数值增益', 1, 'PUBLIC', [{ name: '敏捷', value: 1 }]),
      privateState = await f.definition('不能泄露的私密状态', 1, 'GM_ONLY'),
      ownerState = await f.definition('仅本人计时', 2, 'OWNER');
    const ta = await f.attach(d),
      tb = await f.attach(d, f.b.id, 5);
    await f.attach(expire);
    await f.attach(privateState);
    await f.attach(ownerState);
    await f.op(
      'characterTag.attach',
      { characterId: f.a.id, tagDefinitionId: d.id, definitionVersion: d.version },
      409,
    );
    await f.op('tagDefinition.update', { ...d, name: d.name, defaultDurationTurns: 9 });
    expect((await f.snap()).characterTags.find((s: any) => s.id === ta.id).remainingTurns).toBe(3);
    const hiddenToken = await f.op('token.create', {
      mapId: f.map.id,
      characterId: f.c.id,
      visibility: 'GM',
      x: 400,
      y: 400,
    });
    await f.op('turn.start', {
      mapId: f.map.id,
      tokenIds: [f.ta.id, f.tb.id, f.th.id, hiddenToken.id],
      totalRounds: 2,
    });
    let s = (await f.snap()).turnSession;
    const startScore = s.participants.find((p: any) => p.characterId === f.a.id).score;
    const player = await f.snap(f.contexts[1]);
    expect(player.turnSession.participants.map((p: any) => p.characterId)).toEqual([f.a.id, f.b.id]);
    expect(JSON.stringify(player.turnSession)).not.toContain('不可见头目');
    expect(JSON.stringify(player.turnSession)).not.toContain(hiddenToken.id);
    expect(JSON.stringify(player)).not.toContain('不能泄露的私密状态');
    expect(player.turnSession.participants[0].states.map((t: any) => t.name)).toContain('仅本人计时');
    expect(player.turnSession.participants[0]).not.toHaveProperty('score');
    expect(player.turnSession.participants[0]).not.toHaveProperty('calculation');
    expect(player.characters[0]).not.toHaveProperty('initiativeConfig');
    expect(player.initiativePresets).toEqual([]);
    expect(player.room).not.toHaveProperty('initiativePresetId');
    const p = { sessionId: s.id, version: s.version },
      operationId = randomUUID();
    const first = await f.op('turn.advance', p, 200, f.contexts[0], operationId),
      retry = await f.op('turn.advance', p, 200, f.contexts[0], operationId);
    expect(retry).toEqual(first);
    expect((await f.snap()).characterTags.find((t: any) => t.id === ta.id).remainingTurns).toBe(2);
    expect((await f.saved()).derived.values.dex).toBe(8);
    expect((await f.snap()).turnSession.participants.find((p: any) => p.characterId === f.a.id).score).toBe(startScore);
    await f.op('turn.advance', p, 409);
    await f.command('turn.advance', {}, 403, f.contexts[1]);
    await f.op('turn.advance', p, 403, f.contexts[1], operationId);
    expect(JSON.stringify((await f.snap(f.contexts[1])).turnSession.transition)).not.toContain('不能泄露的私密状态');
    await delay();
    s = (await f.snap()).turnSession;
    const concurrent = await Promise.all(
      f.contexts
        .filter((_, i) => i !== 1)
        .map((c) =>
          c.request.post(`${api}/rooms/${f.roomId}/operations`, {
            data: { id: randomUUID(), type: 'turn.advance', payload: { sessionId: s.id, version: s.version } },
          }),
        ),
    );
    expect(concurrent.map((r) => r.status()).sort()).toEqual([200, 409]);
    expect((await f.snap()).turnSession.version).toBe(s.version + 1);
    const receipt = await f.db.operationReceipt.findUniqueOrThrow({ where: { id: operationId } });
    expect((receipt.result as any).transition.changed.some((row: any) => row.after === 0)).toBe(true);
    await f.command('turn.pause');
    await f.command('turn.advance', {}, 409);
    await f.command('turn.resume');
    const before = (await f.snap()).turnSession;
    await f.op('character.field.set', {
      characterId: f.b.id,
      version: (await f.saved(f.b.id)).version,
      fieldId: 'dex',
      value: 10,
    });
    expect((await f.snap()).turnSession.participants.map((p: any) => p.characterId)).toEqual(
      before.participants.map((p: any) => p.characterId),
    );
    await f.command('turn.recalculate');
    expect((await f.snap()).turnSession.participants[0].characterId).toBe(f.b.id);
    expect((await f.snap()).turnSession.currentCharacterId).toBe(before.currentCharacterId);
    await f.op('map.activate', { id: f.otherMap.id });
    expect((await f.snap()).turnSession.mapId).toBe(f.map.id);
    await f.command('turn.add', { tokenId: f.offMap.id }, 400);
    const current = (await f.snap()).turnSession.currentCharacterId,
      remaining = await f.db.characterTag.findMany({ where: { roomId: f.roomId, characterId: current } });
    await f.command('turn.remove', { characterId: current });
    expect(await f.db.characterTag.findMany({ where: { roomId: f.roomId, characterId: current } })).toEqual(remaining);
    // Remove the hidden representative, then add the public representative for NEXT round.
    if ((await f.snap()).turnSession.participants.some((p: any) => p.characterId === f.c.id))
      await f.command('turn.remove', { characterId: f.c.id });
    await f.command('turn.add', { tokenId: f.tc.id, nextRound: true });
    s = (await f.snap()).turnSession;
    expect(s.participants.find((p: any) => p.characterId === f.c.id).firstRound).toBe(s.round + 1);
    await f.command('turn.focus', { characterId: f.c.id }, 400);
    const pending = s.participants.find(
      (p: any) => p.firstRound <= s.round && p.lastActedRound < s.round && p.characterId !== s.currentCharacterId,
    );
    if (pending) {
      const tags = await f.db.characterTag.findMany({ where: { roomId: f.roomId } });
      await f.command('turn.focus', { characterId: pending.characterId });
      expect(await f.db.characterTag.findMany({ where: { roomId: f.roomId } })).toEqual(tags);
    }
    const reverse = (await f.snap()).turnSession.participants.map((p: any) => p.characterId).reverse();
    await f.command('turn.order', { characterIds: reverse });
    expect((await f.snap()).turnSession.participants.map((p: any) => p.characterId)).toEqual(reverse);
    const source = await f.saved();
    const copy = await f.op('character.copy', { id: f.a.id });
    expect(copy.id).not.toBe(source.id);
    const copiedTags = await f.db.characterTag.findMany({ where: { characterId: copy.id } });
    expect(copiedTags.map((t) => t.remainingTurns).sort()).toEqual(
      (await f.db.characterTag.findMany({ where: { characterId: f.a.id } })).map((t) => t.remainingTurns).sort(),
    );
    const copyToken = await f.op('token.create', { mapId: f.map.id, characterId: copy.id, x: 500, y: 500 });
    await f.command('turn.add', { tokenId: copyToken.id, nextRound: false });
    s = (await f.snap()).turnSession;
    expect(s.participants.find((row: any) => row.characterId === copy.id).firstRound).toBe(s.round);
    const sourceStates = await f.db.characterTag.findMany({ where: { characterId: f.a.id }, orderBy: { id: 'asc' } });
    await f.command('turn.focus', { characterId: copy.id });
    await delay();
    await f.command('turn.skip');
    expect(await f.db.characterTag.findMany({ where: { characterId: f.a.id }, orderBy: { id: 'asc' } })).toEqual(
      sourceStates,
    );
    expect(
      (await f.db.characterTag.findMany({ where: { characterId: copy.id } })).find((t) => t.tagDefinitionId === d.id)!
        .remainingTurns,
    ).toBe(sourceStates.find((t) => t.tagDefinitionId === d.id)!.remainingTurns! - 1);
    await f.command('turn.end');
    expect((await f.snap()).turnSession).toBeNull();
    expect(await f.db.characterTag.findUnique({ where: { id: tb.id } })).not.toBeNull();
    expect(await f.db.combatEvent.count({ where: { roomId: f.roomId } })).toBe(0);
    // A hidden map has no player-facing turn session, even with a public character.
    const privateMap = await f.op('map.create', { name: '秘密地图', visibility: 'GM' }),
      privateToken = await f.op('token.create', { mapId: privateMap.id, characterId: f.a.id, x: 300, y: 300 });
    await f.op('turn.start', { mapId: privateMap.id, tokenIds: [privateToken.id] });
    expect((await f.snap(f.contexts[1])).turnSession).toBeNull();
    await f.command('turn.end');
    expect((await f.snap()).initiativePresets.some((row: any) => row.id === preset.id)).toBe(true);
  } finally {
    await f.cleanup();
  }
});
