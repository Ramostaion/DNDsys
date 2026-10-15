import { api, apiBase } from './server-address';
import { test as base, expect, type BrowserContext, type Page, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve, join, sep, dirname } from 'node:path';
import { rm, readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import express from 'express';
import { registerOperations } from '../src/operations';
import { errorHandler } from '../src/error-handler';
import { createApplication } from '../src/app';
import { readConfig } from '../src/config';

config({ path: 'apps/api/.env' });

const picture = sharp({ create: { width: 1000, height: 600, channels: 3, background: '#895532' } })
  .png()
  .toBuffer();
async function post(context: BrowserContext, path: string, data: unknown) {
  const response = await context.request.post(api + path, { data });
  const body = await response.json();
  expect(response.ok(), `${path}: ${JSON.stringify(body)}`).toBe(true);
  return body;
}
const op = (context: BrowserContext, roomId: string, type: string, payload: Record<string, unknown>) =>
  post(context, `/rooms/${roomId}/operations`, { id: randomUUID(), type, payload });
async function snapshot(context: BrowserContext, roomId: string) {
  const response = await context.request.get(`${api}/rooms/${roomId}/snapshot`);
  expect(response.ok()).toBe(true);
  return response.json();
}
async function denied(context: BrowserContext, roomId: string, type: string, payload: Record<string, unknown>) {
  const response = await context.request.post(`${api}/rooms/${roomId}/operations`, {
    data: { id: randomUUID(), type, payload },
  });
  expect(response.status(), await response.text()).toBe(403);
}
async function closeWindow(page: Page, label: string) {
  const close = page.getByRole('button', { name: label, exact: true });
  await page
    .locator('.window')
    .filter({ has: close })
    .locator('.window-title')
    .click({ position: { x: 20, y: 20 } });
  await close.click();
}
async function openCharacter(page: Page, name: string, npc = false) {
  await page.locator('.game-rail').getByRole('button', { name: '角色', exact: true }).click();
  if (npc) await page.getByRole('tab', { name: /^NPC/ }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await closeWindow(page, '关闭角色');
  await expect(page.locator('.character-sheet')).toBeVisible();
}
async function placeWindow(page: Page, panel: Locator, left: number, top: number) {
  const title = page.locator('.window').filter({ has: panel }).locator('.window-title');
  await title.evaluate(async (element) => {
    await Promise.all(
      element
        .closest('.window')!
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const box = (await title.boundingBox())!;
  await title.click({ position: { x: box.width - 10, y: 20 } });
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(left + 20, top + 20, { steps: 8 });
  await page.mouse.up();
}
type Table = {
  gmContext: BrowserContext;
  aContext: BrowserContext;
  bContext: BrowserContext;
  gm: Page;
  a: Page;
  b: Page;
  room: any;
  ca: any;
  cb: any;
  users: any[];
  db: PrismaClient;
};
const test = base.extend<{ table: Table }>({
  table: async ({ browser }, use) => {
    const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
    const db = new PrismaClient(),
      users: any[] = [],
      prefix = `e2e-fix-${randomUUID().slice(0, 8)}`;
    let room: any;
    try {
      for (const [index, context] of contexts.entries())
        users.push(await post(context, '/auth/register', { username: `${prefix}-${index}`, password: randomUUID() }));
      room = await post(contexts[0], '/rooms', { name: `E2E usability ${prefix}` });
      for (const context of contexts.slice(1)) await post(context, '/rooms/join', { inviteCode: room.inviteCode });
      const ca = await op(contexts[0], room.id, 'character.create', { name: '角色甲', ownerId: users[1].id });
      const cb = await op(contexts[0], room.id, 'character.create', { name: '角色乙', ownerId: users[2].id });
      const pages = await Promise.all(
        contexts.map(async (context) => {
          const page = await context.newPage();
          await page.goto(`/rooms/${room.id}`);
          await expect(page.locator('.game-rail')).toBeVisible();
          return page;
        }),
      );
      await use({
        gmContext: contexts[0],
        aContext: contexts[1],
        bContext: contexts[2],
        gm: pages[0],
        a: pages[1],
        b: pages[2],
        room,
        ca,
        cb,
        users,
        db,
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      if (room) {
        const saved = await db.room.findUnique({ where: { id: room.id }, select: { name: true } });
        if (saved?.name === `E2E usability ${prefix}`) {
          await db.room.delete({ where: { id: room.id } });
          const uploadRoot = resolve('apps/api', process.env.UPLOAD_DIR || 'uploads'),
            target = resolve(uploadRoot, room.id);
          if (target.startsWith(uploadRoot + sep) && dirname(target) === uploadRoot)
            await rm(target, { recursive: true, force: true });
        }
      }
      await db.user.deleteMany({
        where: { id: { in: users.map((user) => user.id) }, username: { startsWith: prefix + '-' } },
      });
      await db.$disconnect();
    }
  },
});

// Opt-in owned runtime for backend changes: no launcher or user service restart required.
let isolated: ReturnType<typeof createApplication> | undefined;
let isolatedDb: PrismaClient | undefined;
let isolatedQueries = 0,
  isolatedLastQuery = Date.now();
test.beforeAll(async () => {
  if (process.env.DND_E2E_ISOLATED !== '1') return;
  const address = new URL(apiBase);
  if (!['localhost', '127.0.0.1'].includes(address.hostname)) throw new Error('临时测试服务只监听本机');
  isolatedDb = new PrismaClient();
  const tracked = isolatedDb.$extends({
    query: {
      async $allOperations({ args, query }) {
        isolatedQueries++;
        try {
          return await query(args);
        } finally {
          isolatedQueries--;
          isolatedLastQuery = Date.now();
        }
      },
    },
  });
  isolated = createApplication(tracked as unknown as PrismaClient, {
    ...readConfig(),
    origin: address.origin,
    secureCookie: false,
    webDir: resolve('apps/web/dist'),
  });
  await new Promise<void>((done, reject) => {
    isolated!.server.once('error', reject);
    isolated!.server.listen(Number(address.port), address.hostname, done);
  });
});
test.afterAll(async () => {
  if (!isolated) return;
  isolated.beginShutdown();
  await new Promise<void>((done) => isolated!.io.close(() => done()));
  await expect.poll(() => isolatedQueries === 0 && Date.now() - isolatedLastQuery > 200).toBe(true);
  await isolatedDb?.$disconnect();
});

test('敏捷对抗声明自动双 D20、四类角色、全员广播、最新数值、历史及重试去重', async ({ table: t }) => {
  test.setTimeout(180_000);
  for (const page of [t.gm, t.a, t.b]) {
    await page.setViewportSize({ width: 1600, height: 1050 });
    if (page === t.b) await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      (window as any).combatNotices = [];
      (window as any).combatPhases = [];
      const capture = (banner: Element) => {
        (window as any).combatPhases.push({
          id: banner.getAttribute('data-record-id'),
          phase: banner.getAttribute('data-phase'),
          animation: getComputedStyle(banner).animationName,
          keyframes: banner
            .getAnimations()
            .flatMap(
              (animation) => (animation.effect as KeyframeEffect)?.getKeyframes().map((frame) => frame.opacity) || [],
            ),
        });
      };
      const watch = () =>
        new MutationObserver((entries) => {
          for (const entry of entries) {
            if (
              entry.type === 'attributes' &&
              entry.target instanceof Element &&
              entry.target.matches('.combat-result-banner')
            )
              capture(entry.target);
            for (const node of entry.addedNodes)
              if (node instanceof HTMLElement) {
                const banners = [
                  ...(node.matches('.combat-result-banner') ? [node] : []),
                  ...node.querySelectorAll('.combat-result-banner'),
                ];
                for (const banner of banners) {
                  (window as any).combatNotices.push(banner.getAttribute('data-record-id'));
                  capture(banner);
                }
              }
          }
        }).observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['data-phase'],
        });
      if (document.body) watch();
      else addEventListener('DOMContentLoaded', watch, { once: true });
    });
  }
  await t.db.roomMember.update({
    where: { roomId_userId: { roomId: t.room.id, userId: t.users[2].id } },
    data: { permissions: { characterBasics: true } },
  });
  const state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: { fieldId: 'dex', name: '敏捷', type: 'number', defaultValue: 11, group: '基础信息', editableBy: 'GM' },
  });
  const npc = await op(t.gmContext, t.room.id, 'character.create', { name: '哥布林', isNpc: true }),
    secondNpc = await op(t.gmContext, t.room.id, 'character.create', { name: '骷髅战士', isNpc: true });
  async function dex(id: string, value: number) {
    const c = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === id);
    await op(t.gmContext, t.room.id, 'character.field.set', {
      characterId: id,
      fieldId: 'dex',
      version: c.version,
      value,
    });
  }
  await dex(t.ca.id, 14);
  const item = await op(t.gmContext, t.room.id, 'item.create', {
    name: '灵巧戒指',
    kind: '饰品',
    data: { customFields: [{ name: '敏捷', value: 3 }] },
  });
  const entry = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: t.ca.id,
    itemId: item.id,
    quantity: 1,
  });
  await op(t.gmContext, t.room.id, 'equipment.set', { characterId: t.ca.id, slot: '饰品1', entryId: entry.id });
  const npcArmor = await op(t.gmContext, t.room.id, 'item.create', {
    name: '哥布林轻甲',
    kind: '装备',
    data: { customFields: [{ name: '敏捷', value: 1 }] },
  });
  const npcEntry = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: npc.id,
    itemId: npcArmor.id,
    quantity: 1,
  });
  await op(t.gmContext, t.room.id, 'equipment.set', { characterId: npc.id, slot: '胸部', entryId: npcEntry.id });
  await op(t.gmContext, t.room.id, 'combat.start', { characterIds: [t.ca.id, t.cb.id, npc.id, secondNpc.id] });
  for (const page of [t.gm, t.a, t.b]) {
    await page.reload();
    await expect(page.locator('[title="已连接"]')).toBeVisible();
  }
  await openCharacter(t.b, '角色乙');
  await t.b.getByLabel('角色名称', { exact: true }).fill('仍在编辑的角色名');
  for (const page of [t.gm, t.a])
    await page.locator('.game-rail').getByRole('button', { name: '战斗', exact: true }).click();
  const form = t.a.locator('.manual-combat');
  await form.getByLabel('声明角色', { exact: true }).selectOption(t.ca.id);
  await form.getByLabel('关联目标', { exact: true }).selectOption(npc.id);
  const saving = t.a.waitForResponse(
    (r) => r.url().endsWith('/operations') && r.request().postDataJSON().type === 'combat.record',
  );
  await form.getByRole('button', { name: '保存记录', exact: true }).click();
  const first = await (await saving).json(),
    contest = first.data.contest;
  expect(contest.attacker).toMatchObject({ name: '角色甲', base: 14, effective: 17, bonus: 2 });
  expect(contest.version).toBe(4);
  expect(contest.attacker.total).toBe(Math.max(1, 2 + contest.attacker.d20));
  expect(contest.attacker.modifiers[0].name).toBe('灵巧戒指');
  expect(contest.defender.total).toBe(contest.defender.d20);
  expect(contest.defender.modifiers[0].name).toBe('装备修正（来源不可见）');
  expect(
    (await snapshot(t.gmContext, t.room.id)).combatEvents.find((event: any) => event.id === first.id).data.contest
      .defender.modifiers[0].name,
  ).toBe('哥布林轻甲');
  for (const side of [contest.attacker, contest.defender]) {
    expect(side.d20).toBeGreaterThanOrEqual(1);
    expect(side.d20).toBeLessThanOrEqual(20);
  }
  const shown = form.locator('.agility-result').first();
  await expect(shown).toContainText(contest.reason);
  await expect(shown).toContainText('MAX(1, 14 + 3) = 17');
  await expect(shown).toContainText(`MAX(1, 2 + ${contest.attacker.d20}) = ${contest.attacker.total}`);
  const info = shown.getByRole('button', { name: '角色甲的敏捷属性加值说明' });
  const tooltip = t.a.getByRole('tooltip', { name: '敏捷加值表与计算过程' });
  await expect(tooltip).toHaveCount(0);
  await info.hover();
  await expect(tooltip).toBeVisible();
  await expect(tooltip.getByRole('row').filter({ hasText: '16–18' })).toContainText('（本次）');
  await expect(tooltip.getByRole('row').filter({ hasText: '16–18' })).toContainText('+2');
  await expect(tooltip).toContainText('有效敏捷：MAX(1, 14 + 3) = 17');
  await expect(tooltip).toContainText(`最终判定：MAX(1, 2 + ${contest.attacker.d20}) = ${contest.attacker.total}`);
  const helpBox = (await tooltip.boundingBox())!;
  expect(helpBox.x).toBeGreaterThanOrEqual(0);
  expect(helpBox.y).toBeGreaterThanOrEqual(0);
  expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(1600);
  expect(helpBox.y + helpBox.height).toBeLessThanOrEqual(1050);
  await t.a.mouse.move(1200, 800);
  await expect(tooltip).toHaveCount(0);
  await info.focus();
  await expect(tooltip).toBeVisible();
  await info.press('Escape');
  await expect(tooltip).toHaveCount(0);
  for (const page of [t.gm, t.a, t.b]) {
    await expect(page.getByRole('status', { name: '战斗结果广播' })).toHaveAttribute('data-record-id', first.id);
    await expect(page.getByRole('status', { name: '战斗结果广播' })).toContainText(contest.message);
    await expect(page.getByRole('status', { name: '战斗结果广播' })).toContainText(
      `MAX(1, 2 + D20(${contest.attacker.d20})) = ${contest.attacker.total}`,
    );
    expect(
      await page.getByRole('status', { name: '战斗结果广播' }).evaluate((el) => getComputedStyle(el).pointerEvents),
    ).toBe('none');
  }
  await expect(t.b.getByLabel('角色名称', { exact: true })).toHaveValue('仍在编辑的角色名');
  // Observe the complete exit, including an account requesting reduced motion.
  for (const page of [t.gm, t.a, t.b]) {
    await expect
      .poll(() =>
        page.evaluate(
          (id) => (window as any).combatPhases.some((entry: any) => entry.id === id && entry.phase === 'fading'),
          first.id,
        ),
      )
      .toBe(true);
    const phases = await page.evaluate(
      (id) => (window as any).combatPhases.filter((entry: any) => entry.id === id),
      first.id,
    );
    if (page === t.b) expect(phases.every((entry: any) => entry.animation === 'none')).toBe(true);
    else {
      expect(phases.some((entry: any) => entry.phase === 'visible' && entry.animation === 'combat-notice-arrive')).toBe(
        true,
      );
      const exit = phases.find((entry: any) => entry.phase === 'fading');
      expect(exit.animation).toBe('combat-notice-depart');
      expect(exit.keyframes.map(String)).toContain('1');
      expect(exit.keyframes.map(String)).toContain('0');
    }
    await expect(page.getByRole('status', { name: '战斗结果广播' })).toHaveCount(0);
  }
  await expect(t.b.getByLabel('角色名称', { exact: true })).toHaveValue('仍在编辑的角色名');
  expect((await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id).currentHp).toBe(0);
  expect((await snapshot(t.gmContext, t.room.id)).room.publicDiceAvailableAt).toBeNull();
  const agilityCheck = await op(t.aContext, t.room.id, 'dice.roll', {
    characterId: t.ca.id,
    expression: '1d20+敏捷属性加值',
    visibility: 'PRIVATE',
    reason: '敏捷属性加值用于其他判定',
  });
  expect(agilityCheck.details.find((part: any) => part.kind === 'attribute').value).toBe(2);
  await op(t.gmContext, t.room.id, 'equipment.set', { characterId: t.ca.id, slot: '饰品1', entryId: null });
  await dex(t.ca.id, 100);
  const pairs = [
    [t.ca.id, npc.id],
    [npc.id, t.ca.id],
    [t.ca.id, t.cb.id],
    [npc.id, secondNpc.id],
  ];
  for (const [actorId, targetId] of pairs) {
    const record = await op(t.gmContext, t.room.id, 'combat.record', {
      kind: 'DECLARATION',
      actorId,
      targetId,
      note: '四类角色对抗',
    });
    expect(record.data.contest.attacker.id).toBe(actorId);
    expect(record.data.contest.defender.id).toBe(targetId);
    if (actorId === t.ca.id) expect(record.data.contest.hit).toBe(true);
    if (actorId === npc.id && targetId === t.ca.id) expect(record.data.contest.hit).toBe(false);
  }
  await denied(t.aContext, t.room.id, 'combat.record', {
    kind: 'DECLARATION',
    actorId: npc.id,
    targetId: t.ca.id,
    note: '玩家越权 NPC',
  });
  async function slow(enabled: boolean) {
    const actor = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
    await op(t.gmContext, t.room.id, 'character.update', {
      id: actor.id,
      version: actor.version,
      patch: {
        statuses: [
          {
            id: 'slow',
            name: '迟缓',
            enabled,
            modifierRows: [{ targetFieldId: 'dex', operation: 'ADD', value: -120 }],
          },
        ],
      },
    });
  }
  await slow(true);
  const slowed = await op(t.gmContext, t.room.id, 'combat.record', {
    kind: 'DECLARATION',
    actorId: t.ca.id,
    targetId: npc.id,
    note: '实时状态影响',
  });
  expect(slowed.data.contest.attacker).toMatchObject({ base: 100, rawEffective: -20, effective: 1, bonus: -4 });
  expect(slowed.data.contest.attacker.total).toBe(Math.max(1, -4 + slowed.data.contest.attacker.d20));
  await slow(false);
  const recovered = await op(t.gmContext, t.room.id, 'combat.record', {
    kind: 'DECLARATION',
    actorId: t.ca.id,
    targetId: npc.id,
    note: '状态失效后恢复',
  });
  expect(recovered.data.contest.attacker.effective).toBe(100);
  const prior = (await snapshot(t.gmContext, t.room.id)).combatEvents.find((event: any) => event.id === first.id);
  expect(prior.data.contest.attacker.effective).toBe(17);
  await t.a.reload();
  await expect(t.a.locator('.game-rail')).toBeVisible();
  await expect(t.a.getByRole('status', { name: '战斗结果广播' })).toHaveCount(0);
  await t.a.locator('.game-rail').getByRole('button', { name: '战斗', exact: true }).click();
  const history = t.a.locator('.combat-event').filter({ has: t.a.locator(`[data-record-id="${first.id}"]`) });
  await history.locator('summary').click();
  await expect(history).toContainText('当前有效敏捷');
  await expect(history).toContainText('17');
  // Lose the first HTTP reply after a real commit; the visible retry reuses its original operation ID.
  const playerForm = t.a.locator('.manual-combat');
  await playerForm.getByLabel('声明角色', { exact: true }).selectOption(t.ca.id);
  await playerForm.getByLabel('关联目标', { exact: true }).selectOption(npc.id);
  let lose = true,
    lostId = '';
  await t.a.route('**/api/rooms/*/operations', async (route) => {
    if (lose && route.request().postDataJSON().type === 'combat.record') {
      lose = false;
      lostId = route.request().postDataJSON().id;
      const response = await route.fetch();
      expect(response.ok()).toBe(true);
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: '保存回复丢失测试' }),
      });
    } else await route.continue();
  });
  await playerForm.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(playerForm.getByRole('button', { name: '重试保存上次记录' })).toBeEnabled();
  const saved = await t.db.operationReceipt.findUniqueOrThrow({ where: { id: lostId } }),
    savedRecord = saved.result as any;
  await playerForm.getByRole('button', { name: '重试保存上次记录' }).click();
  await expect(playerForm.locator('.agility-result').first()).toHaveAttribute('data-record-id', savedRecord.id);
  expect(
    await t.db.combatEvent.count({
      where: { roomId: t.room.id, data: { path: ['contest', 'operationId'], equals: lostId } },
    }),
  ).toBe(1);
  expect(
    await t.a.evaluate(
      (id) => (window as any).combatNotices.filter((seen: string) => seen === id).length,
      savedRecord.id,
    ),
  ).toBe(1);
  await t.a.unroute('**/api/rooms/*/operations');
  const duplicateId = randomUUID(),
    request = {
      id: duplicateId,
      type: 'combat.record',
      payload: { kind: 'DECLARATION', actorId: t.ca.id, targetId: npc.id, note: '并发重复点击' },
    };
  const responses = await Promise.all([
    t.aContext.request.post(`${api}/rooms/${t.room.id}/operations`, { data: request }),
    t.aContext.request.post(`${api}/rooms/${t.room.id}/operations`, { data: request }),
  ]);
  for (const response of responses) expect(response.ok(), await response.text()).toBe(true);
  const records = await Promise.all(responses.map((response) => response.json()));
  expect(records[0].id).toBe(records[1].id);
  expect(records[0].data.contest.attacker.d20).toBe(records[1].data.contest.attacker.d20);
  await expect
    .poll(() =>
      t.a.evaluate((id) => (window as any).combatNotices.filter((seen: string) => seen === id).length, records[0].id),
    )
    .toBe(1);
  const renamed = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
  await op(t.gmContext, t.room.id, 'character.update', {
    id: t.ca.id,
    version: renamed.version,
    patch: { name: '亚瑟新名' },
  });
  expect(
    (await snapshot(t.gmContext, t.room.id)).combatEvents.find((event: any) => event.id === first.id).data.contest
      .attacker.name,
  ).toBe('角色甲');
  const gmForm = t.gm.locator('.manual-combat');
  await gmForm.getByLabel('声明角色', { exact: true }).selectOption(npc.id);
  await gmForm.getByLabel('关联目标', { exact: true }).selectOption(t.ca.id);
  await gmForm.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(gmForm.locator('.agility-result').first()).toContainText('成功闪避');
  await expect(gmForm.locator('.agility-result').first()).toContainText('亚瑟新名');
  const combatWindow = t.gm.locator('.window').filter({ has: gmForm });
  const corner = (await combatWindow.locator('.resize-se').boundingBox())!;
  await t.gm.mouse.move(corner.x + 4, corner.y + 4);
  await t.gm.mouse.down();
  await t.gm.mouse.move(corner.x + 224, corner.y + 344, { steps: 8 });
  await t.gm.mouse.up();
  await gmForm.locator('.agility-result').first().scrollIntoViewIfNeeded();
  await t.gm.screenshot({ path: '.launcher/agility-contest.png' });
  await gmForm
    .locator('.agility-result')
    .first()
    .getByRole('button', { name: /敏捷属性加值说明/ })
    .last()
    .hover();
  const gmTooltip = t.gm.getByRole('tooltip', { name: '敏捷加值表与计算过程' });
  await expect(gmTooltip).toContainText('加值计算：4 + floor((100 − 21) / 2) = 43');
  await t.gm.screenshot({ path: '.launcher/agility-bonus-info.png' });
  await t.gm.mouse.move(1200, 800);
  await expect(gmTooltip).toHaveCount(0);
  const before = await t.db.combatEvent.count({ where: { roomId: t.room.id } });
  const ordinary = await op(t.gmContext, t.room.id, 'combat.record', {
    kind: 'NOTE',
    actorId: t.ca.id,
    targetId: npc.id,
    note: '保留自由备注',
  });
  expect(ordinary.data.contest).toBeUndefined();
  const noTarget = await op(t.gmContext, t.room.id, 'combat.record', {
    kind: 'DECLARATION',
    actorId: t.ca.id,
    note: '无目标声明',
  });
  expect(noTarget.data.skippedReason).toContain('未选择关联目标');
  await t.db.character.update({ where: { id: npc.id }, data: { fieldValues: { dex: '' } } });
  const invalid = await op(t.gmContext, t.room.id, 'combat.record', {
    kind: 'DECLARATION',
    actorId: t.ca.id,
    targetId: npc.id,
    note: '非法敏捷保留记录',
  });
  expect(invalid.data.contest).toBeUndefined();
  expect(invalid.data.skippedReason).toContain('敏捷数据无效');
  expect(await t.db.combatEvent.count({ where: { roomId: t.room.id } })).toBe(before + 3);
});

test('敏捷判定持久快照、广播失败仍提交、私密隔离与 API 重建恢复', async ({ table: t }) => {
  let state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: { fieldId: 'dex', name: '敏捷', type: 'number', defaultValue: 14, group: '基础信息' },
  });
  const hidden = await op(t.gmContext, t.room.id, 'character.create', {
    name: '秘密魔王',
    isNpc: true,
    visibility: 'GM',
  });
  const privateRecord = await op(t.gmContext, t.room.id, 'combat.record', {
    kind: 'DECLARATION',
    actorId: hidden.id,
    targetId: t.ca.id,
    note: '私密对抗',
  });
  expect(privateRecord.visibility).toBe('PRIVATE');
  expect(privateRecord.data.contest.broadcast.scope).toBe('GM');
  expect((await snapshot(t.aContext, t.room.id)).combatEvents.some((event: any) => event.id === privateRecord.id)).toBe(
    false,
  );
  await expect(t.a.getByRole('status', { name: '战斗结果广播' })).toHaveCount(0);
  const app = express();
  app.use(express.json());
  registerOperations(
    app,
    t.db,
    (req, _res, next) => {
      req.user = { id: t.users[0].id, username: t.users[0].username };
      next();
    },
    () => {
      throw new Error('模拟广播失败');
    },
    () => {
      throw new Error('模拟广播失败');
    },
  );
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const operationId = randomUUID();
  let failed: any;
  try {
    const response = await t.gmContext.request.post(
      `http://127.0.0.1:${(server.address() as any).port}/api/rooms/${t.room.id}/operations`,
      {
        data: {
          id: operationId,
          type: 'combat.record',
          payload: { kind: 'DECLARATION', actorId: t.ca.id, targetId: t.cb.id, note: '广播失败仍保存' },
        },
      },
    );
    expect(response.status()).toBe(200);
    failed = await response.json();
    expect(failed.data.contest.broadcast.status).toBe('FAILED');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
  const stored = await t.db.combatEvent.findUniqueOrThrow({ where: { id: failed.id } });
  expect((stored.data as any).contest).toEqual(failed.data.contest);
  const application = createApplication(t.db, readConfig());
  await new Promise<void>((resolve) => application.server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://localhost:${(application.server.address() as any).port}/api/rooms/${t.room.id}`;
    const replay = await t.gmContext.request.post(url + '/operations', {
      data: {
        id: operationId,
        type: 'combat.record',
        payload: { kind: 'DECLARATION', actorId: t.ca.id, targetId: t.cb.id, note: '重启后重试' },
      },
    });
    expect(replay.ok()).toBe(true);
    expect((await replay.json()).data.contest).toEqual(failed.data.contest);
    const restored = await (await t.gmContext.request.get(url + '/snapshot')).json();
    expect(restored.combatEvents.find((event: any) => event.id === failed.id).data.contest).toEqual(
      failed.data.contest,
    );
  } finally {
    application.beginShutdown();
    await new Promise<void>((resolve) => application.io.close(() => resolve()));
  }
  expect(
    await t.db.combatEvent.count({
      where: { roomId: t.room.id, data: { path: ['contest', 'operationId'], equals: operationId } },
    }),
  ).toBe(1);
  // Existing version 1 snapshots must keep their original operand and saved result.
  const oldContest = structuredClone(failed.data.contest);
  oldContest.version = 1;
  for (const side of [oldContest.attacker, oldContest.defender]) side.total = side.effective + side.d20;
  oldContest.hit = oldContest.attacker.total > oldContest.defender.total;
  oldContest.comparison = `${oldContest.attacker.total} ${oldContest.hit ? '>' : oldContest.attacker.total === oldContest.defender.total ? '=' : '<'} ${oldContest.defender.total}`;
  const legacy = await t.db.combatEvent.create({
    data: {
      roomId: t.room.id,
      userId: t.users[0].id,
      actorId: t.ca.id,
      targetId: t.cb.id,
      kind: 'DECLARATION',
      data: { manual: true, note: '旧规则历史记录', contest: oldContest },
    },
  });
  await t.gm.reload();
  await t.gm.locator('.game-rail').getByRole('button', { name: '战斗', exact: true }).click();
  const history = t.gm.locator('.contest-history').filter({ has: t.gm.locator(`[data-record-id="${legacy.id}"]`) });
  await history.locator('summary').click();
  await expect(history).toContainText('历史规则：判定值 = 完整有效敏捷 + D20。');
  await expect(history).toContainText(
    `${oldContest.attacker.effective} + ${oldContest.attacker.d20} = ${oldContest.attacker.total}`,
  );
  expect((await t.db.combatEvent.findUniqueOrThrow({ where: { id: legacy.id } })).data).toEqual(legacy.data);
  state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: { ...state.room.sheetSchema.find((f: any) => f.fieldId === 'dex'), visibility: 'GM' },
  });
  const publicState = await snapshot(t.aContext, t.room.id);
  expect(publicState.characters.find((c: any) => c.id === t.ca.id).derived.values.敏捷属性加值).toBeUndefined();
  expect(publicState.characters.find((c: any) => c.id === t.ca.id).derived.agility).toBeNull();
  const skipped = await op(t.aContext, t.room.id, 'combat.record', {
    kind: 'DECLARATION',
    actorId: t.ca.id,
    targetId: t.cb.id,
    note: '不泄露私密敏捷',
  });
  expect(skipped.data.contest).toBeUndefined();
  expect(skipped.data.skippedReason).toContain('公开字段');
  await t.db.room.update({ where: { id: t.room.id }, data: { sheetSchema: [] } });
  const missing = await op(t.gmContext, t.room.id, 'combat.record', {
    kind: 'DECLARATION',
    actorId: t.ca.id,
    targetId: t.cb.id,
    note: '没有敏捷词条仍保存',
  });
  expect(missing.data.contest).toBeUndefined();
  expect(missing.data.skippedReason).toContain('缺少敏捷词条');
});

test('护盾独立资源在所有血条上方显示，GM 编辑增减、属性加成、权限隔离及旧卡持久同步', async ({ table: t }) => {
  test.setTimeout(120_000);
  for (const page of [t.gm, t.a, t.b]) await page.setViewportSize({ width: 1600, height: 1050 });
  let state = await snapshot(t.gmContext, t.room.id);
  const shield = state.room.sheetSchema.find((f: any) => f.resourceKind === 'shield');
  expect(shield).toBeTruthy();
  const mine = (s: any) => s.characters.find((c: any) => c.id === t.ca.id);
  expect(mine(state).derived.values[shield.fieldId]).toBe(0);
  expect(mine(state).inventoryVisible).toBe(true);
  expect(state.room.sheetSchema.some((f: any) => f.isResource && f.resourceKind !== 'shield')).toBe(false);
  await op(t.gmContext, t.room.id, 'sheet.health.configure', { version: state.room.version, create: true });
  state = await snapshot(t.gmContext, t.room.id);
  const hp = state.room.sheetSchema.find((f: any) => f.resourceKind === 'health');
  const set = async (fieldId: string, value: number, characterId = t.ca.id) => {
    const c = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === characterId);
    return op(t.gmContext, t.room.id, 'character.field.set', { characterId, fieldId, value, version: c.version });
  };
  await set(shield.maxFieldId, 30);
  await set(shield.fieldId, 12);
  const npc = await op(t.gmContext, t.room.id, 'character.create', { name: '护盾守卫', isNpc: true });
  await set(shield.maxFieldId, 15, npc.id);
  await set(shield.fieldId, 8, npc.id);
  const gmHero = await op(t.gmContext, t.room.id, 'character.create', { name: 'GM护盾角色', ownerId: t.users[0].id });
  await set(shield.maxFieldId, 10, gmHero.id);
  await set(shield.fieldId, 7, gmHero.id);
  const map = await op(t.gmContext, t.room.id, 'map.create', { name: '双资源地图', width: 1400, height: 900 });
  await op(t.gmContext, t.room.id, 'map.activate', { id: map.id });
  const token = await op(t.gmContext, t.room.id, 'token.create', {
    characterId: t.ca.id,
    mapId: map.id,
    x: 350,
    y: 350,
  });
  await op(t.gmContext, t.room.id, 'token.create', { characterId: npc.id, mapId: map.id, x: 650, y: 350 });
  for (const [page, label, text] of [
    [t.gm, 'GM护盾角色', '7 / 10'],
    [t.a, '角色甲', '12 / 30'],
  ] as const) {
    const hero = page.locator('.hero-chip').filter({ hasText: label });
    await expect(hero.getByLabel('护盾详情', { exact: true })).toContainText(text);
    const positions = await hero.evaluate((element) => ({
      shield: element.querySelector('[aria-label="护盾详情"]')!.getBoundingClientRect().top,
      health: element.querySelector('[aria-label="生命详情"]')!.getBoundingClientRect().top,
    }));
    expect(positions.shield).toBeLessThan(positions.health);
  }
  for (const page of [t.gm, t.a, t.b]) {
    await expect
      .poll(() =>
        page.evaluate((id) => {
          const stage = (window as any).Konva?.stages?.find((s: any) => s.findOne(`#${id}`));
          const node = stage?.findOne(`#${id}`);
          return node
            ? {
                shield: node.findOne('.token-shield')?.findOne('Text')?.text(),
                health: node.findOne('.token-health')?.findOne('Text')?.text(),
                above: node.findOne('.token-shield')?.y() < node.findOne('.token-health')?.y(),
              }
            : null;
        }, token.id),
      )
      .toEqual({ shield: '12/30', health: '20/20', above: true });
  }
  const canvasPoint = await t.b.evaluate((id) => {
    const stage = (window as any).Konva.stages.find((s: any) => s.findOne(`#${id}`));
    const position = stage.findOne(`#${id}`).getAbsolutePosition(),
      bounds = stage.container().getBoundingClientRect();
    return { x: bounds.left + position.x, y: bounds.top + position.y };
  }, token.id);
  await t.b.mouse.move(canvasPoint.x, canvasPoint.y);
  const hover = t.b.getByRole('tooltip', { name: '角色概览' });
  await expect(hover.getByLabel('护盾详情', { exact: true })).toContainText('12 / 30');
  expect(
    await hover.evaluate(
      (el) =>
        el.querySelector('[aria-label="护盾详情"]')!.getBoundingClientRect().top <
        el.querySelector('[aria-label="生命详情"]')!.getBoundingClientRect().top,
    ),
  ).toBe(true);
  await t.b.mouse.move(100, 120);
  await openCharacter(t.gm, '角色甲');
  await openCharacter(t.a, '角色甲');
  const panel = t.gm.locator('.character-sheet');
  const current = panel.locator(`[data-field-id="${shield.fieldId}"]`);
  const max = panel.locator(`[data-field-id="${shield.maxFieldId}"]`);
  await expect(current.getByRole('progressbar', { name: '护盾条' })).toBeVisible();
  expect(
    await panel.evaluate(
      (el) =>
        el.querySelector('.shield-section')!.getBoundingClientRect().top <
        el.querySelector('[aria-label="生命条"]')!.getBoundingClientRect().top,
    ),
  ).toBe(true);
  await expect(t.a.getByLabel('当前护盾原始值')).toHaveCount(0);
  await max.getByLabel('护盾上限原始值').fill('40');
  await max.getByRole('button', { name: '设定', exact: true }).click();
  await expect(current.locator('strong.text-amber-300')).toHaveText('12 / 40');
  await current.getByLabel('当前护盾原始值').fill('20');
  await current.getByRole('button', { name: '设定', exact: true }).click();
  await expect(current.locator('strong.text-amber-300')).toHaveText('20 / 40');
  await current.getByLabel('当前护盾增减量').fill('5');
  await current.getByRole('button', { name: '−', exact: true }).click();
  await expect(current.locator('strong.text-amber-300')).toHaveText('15 / 40');
  await current.getByRole('button', { name: '+', exact: true }).click();
  await expect(current.locator('strong.text-amber-300')).toHaveText('20 / 40');
  let fail = true;
  await t.gm.route('**/api/rooms/*/operations', async (route) => {
    if (fail && route.request().postDataJSON().type === 'character.field.set') {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: '护盾保存失败测试' }),
      });
    } else await route.continue();
  });
  await current.getByLabel('当前护盾原始值').fill('25');
  await current.getByRole('button', { name: '设定', exact: true }).click();
  await expect(current).toContainText('护盾保存失败测试');
  await expect(current.getByLabel('当前护盾原始值')).toHaveValue('25');
  await expect(current.locator('strong.text-amber-300')).toHaveText('20 / 40');
  await current.getByRole('button', { name: '设定', exact: true }).click();
  await expect(current.locator('strong.text-amber-300')).toHaveText('25 / 40');
  await t.gm.unroute('**/api/rooms/*/operations');
  await t.db.roomMember.update({
    where: { roomId_userId: { roomId: t.room.id, userId: t.users[1].id } },
    data: { permissions: { characterValues: true, editAllCharacters: true } },
  });
  for (const fieldId of [shield.fieldId, shield.maxFieldId])
    await denied(t.aContext, t.room.id, 'character.field.set', {
      characterId: t.ca.id,
      fieldId,
      value: 99,
      version: mine(await snapshot(t.gmContext, t.room.id)).version,
    });
  const item = await op(t.gmContext, t.room.id, 'item.create', {
    name: '护盾增幅戒指',
    kind: '饰品',
    data: { customFields: [{ name: '护盾上限', type: 'number', value: 5 }] },
  });
  const entry = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: t.ca.id,
    itemId: item.id,
    quantity: 1,
  });
  await op(t.gmContext, t.room.id, 'equipment.set', { characterId: t.ca.id, slot: '饰品1', entryId: entry.id });
  await expect(current.locator('strong.text-amber-300')).toHaveText('25 / 45');
  expect(mine(await snapshot(t.gmContext, t.room.id)).derived.values[hp.fieldId]).toBe(20);
  await set(shield.fieldId, 0);
  expect(mine(await snapshot(t.aContext, t.room.id)).inventoryVisible).toBe(true);
  await set(shield.fieldId, 25);
  await set(hp.fieldId, 0);
  expect(mine(await snapshot(t.aContext, t.room.id)).inventoryVisible).toBe(false);
  await set(hp.fieldId, 20);
  await t.a.reload();
  await expect(
    t.a.locator('.hero-chip').filter({ hasText: '角色甲' }).getByLabel('护盾详情', { exact: true }),
  ).toContainText('25 / 45');
  await openCharacter(t.a, '角色甲');
  await expect(t.a.locator('.shield-section strong.text-amber-300')).toHaveText('25');
  await expect(t.a.getByLabel('当前护盾原始值')).toHaveCount(0);
  await t.a.screenshot({ path: '.launcher/shield-player.png' });
  state = await snapshot(t.gmContext, t.room.id);
  const copy = await op(t.gmContext, t.room.id, 'character.copy', { id: t.ca.id });
  expect(copy.fieldValues[shield.fieldId]).toBe(25);
  expect(copy.fieldValues[shield.maxFieldId]).toBe(40);
  const logs = (await snapshot(t.gmContext, t.room.id)).logs.filter((log: any) => log.data?.fieldId === shield.fieldId);
  expect(logs.some((log: any) => log.data.previousValue === 20 && log.data.newValue === 15)).toBe(true);
  await t.db.room.update({ where: { id: t.room.id }, data: { sheetMode: false, sheetSchema: [] } });
  await set(shield.fieldId, 24);
  await t.gm.reload();
  await openCharacter(t.gm, '角色甲');
  await expect(t.gm.locator('.shield-section strong.text-amber-300').first()).toHaveText('24 / 45');
  await expect(t.gm.getByLabel('当前护盾原始值')).toHaveValue('24');
  expect(mine(await snapshot(t.gmContext, t.room.id)).currentHp).toBe(0);
});

test('人物卡显示技能特性和可见标签，模板库隐藏状态，标签同步撤回并兼容旧卡', async ({ table: t }) => {
  test.setTimeout(120_000);
  for (const page of [t.gm, t.a, t.b]) await page.setViewportSize({ width: 1600, height: 1050 });
  let state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: { fieldId: 'magic', name: '法伤', type: 'number', defaultValue: 10 },
  });
  for (const [kind, name] of [
    ['SKILL', '侦察'],
    ['STATUS', '历史鼓舞'],
    ['TRAIT', '历史夜视'],
    ['SPECIAL', '历史契约'],
  ]) {
    const template = await op(t.gmContext, t.room.id, 'template.create', {
      kind,
      name,
      data: kind === 'STATUS' ? { modifierRows: [{ targetFieldId: 'magic', operation: 'ADD', value: 3 }] } : {},
    });
    await op(t.gmContext, t.room.id, 'template.apply', { characterId: t.ca.id, templateId: template.id, shared: true });
  }
  await openCharacter(t.gm, '角色甲');
  await t.gm.locator('.sheet-actions').getByRole('button', { name: '管理标签', exact: true }).click();
  const manager = t.gm.locator('.tag-manager');
  await manager.getByRole('button', { name: '添加标签', exact: true }).click();
  await manager.getByLabel('标签名称', { exact: true }).fill('受伤标记');
  await manager.getByRole('button', { name: '保存标签定义', exact: true }).click();
  await manager.getByLabel('角色专属详细备注').fill('右手缠着绷带');
  await manager.getByRole('button', { name: '添加到此角色', exact: true }).click();
  await expect(manager.locator('.attached-tag-list')).toContainText('受伤标记');
  await closeWindow(t.gm, '关闭角色标签');
  state = await snapshot(t.gmContext, t.room.id);
  let publicTag = state.characterTags[0];
  const publicDefinition = state.tagDefinitions[0];
  publicTag = await op(t.gmContext, t.room.id, 'characterTag.update', {
    id: publicTag.id,
    version: publicTag.version,
    detailsMarkdown: '右手缠着绷带',
    visibility: 'PUBLIC',
    priority: 0,
  });
  for (const [visibility, name] of [
    ['OWNER', '私人誓言'],
    ['GM_ONLY', '秘密诅咒'],
  ]) {
    const definition = await op(t.gmContext, t.room.id, 'tagDefinition.create', {
      name,
      icon: 'star',
      color: '#c69452',
      defaultVisibility: visibility,
    });
    await op(t.gmContext, t.room.id, 'characterTag.attach', {
      tagDefinitionId: definition.id,
      definitionVersion: definition.version,
      characterId: t.ca.id,
    });
  }
  await openCharacter(t.a, '角色甲');
  await openCharacter(t.b, '角色甲');
  const gmSkills = t.gm.locator('.character-skills'),
    ownSkills = t.a.locator('.character-skills'),
    otherSkills = t.b.locator('.character-skills');
  for (const panel of [gmSkills, ownSkills, otherSkills]) {
    await expect(panel.getByRole('heading', { name: '技能·标签·特性', exact: true })).toBeVisible();
    await expect(panel).toContainText('侦察');
    await expect(panel).toContainText('历史夜视');
    for (const name of ['历史鼓舞', '历史契约']) await expect(panel).not.toContainText(name);
  }
  await expect(gmSkills.getByRole('button', { name: /^技能栏标签：/ })).toHaveCount(3);
  await expect(ownSkills.getByRole('button', { name: /^技能栏标签：/ })).toHaveCount(2);
  await expect(otherSkills.getByRole('button', { name: /^技能栏标签：/ })).toHaveCount(1);
  await otherSkills.getByRole('button', { name: '技能栏标签：受伤标记', exact: true }).click();
  await expect(t.b.locator('.tag-detail-view')).toContainText('右手缠着绷带');
  publicTag = await op(t.gmContext, t.room.id, 'characterTag.update', {
    id: publicTag.id,
    version: publicTag.version,
    detailsMarkdown: '收回公开备注',
    visibility: 'GM_ONLY',
    priority: 0,
  });
  await expect(otherSkills.getByRole('button', { name: /^技能栏标签：/ })).toHaveCount(0);
  await expect(t.b.locator('.tag-detail-view')).toHaveCount(0);
  await expect(ownSkills.getByRole('button', { name: '技能栏标签：受伤标记', exact: true })).toHaveCount(0);
  publicTag = await op(t.gmContext, t.room.id, 'characterTag.update', {
    id: publicTag.id,
    version: publicTag.version,
    detailsMarkdown: '正在恢复',
    visibility: 'PUBLIC',
    priority: 0,
  });
  await op(t.gmContext, t.room.id, 'tagDefinition.update', { ...publicDefinition, name: '恢复标记' });
  await expect(otherSkills.getByRole('button', { name: '技能栏标签：恢复标记', exact: true })).toBeVisible();
  await gmSkills.scrollIntoViewIfNeeded();
  await t.gm.screenshot({ path: '.launcher/ui-skills-tags.png', animations: 'disabled' });
  await t.gm.locator('.sheet-actions').getByRole('button', { name: '技能', exact: true }).click();
  const library = t.gm.locator('.template-library');
  await expect(library.getByRole('button', { name: 'Buff/状态', exact: true })).toHaveCount(0);
  await expect(library.getByRole('button', { name: '技能', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(library.locator('.ability-list-card')).toHaveCount(1);
  await library.getByRole('button', { name: '全部', exact: true }).click();
  await expect(library.locator('.ability-list-card')).toHaveCount(3);
  await expect(library).not.toContainText('历史鼓舞');
  await library.getByRole('button', { name: '新建', exact: true }).click();
  await expect(t.gm.getByLabel('类型', { exact: true }).locator('option')).toHaveCount(3);
  await expect(t.gm.getByLabel('类型', { exact: true }).locator('option[value="STATUS"]')).toHaveCount(0);
  await closeWindow(t.gm, '关闭能力模板库');
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await expect(ownSkills).toContainText('恢复标记');
  let character = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
  expect(character.statuses).toHaveLength(1);
  expect(character.traits).toHaveLength(1);
  expect(character.skills).toHaveLength(2);
  expect(character.derived.values.magic).toBe(13);
  await op(t.gmContext, t.room.id, 'characterTag.detach', { id: publicTag.id, version: publicTag.version });
  await expect(ownSkills.getByRole('button', { name: '技能栏标签：恢复标记', exact: true })).toHaveCount(0);
  await t.db.room.update({ where: { id: t.room.id }, data: { sheetMode: false } });
  character = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
  await op(t.gmContext, t.room.id, 'character.update', {
    id: t.ca.id,
    version: character.version,
    patch: { currentHp: 10 },
  });
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await expect(t.a.locator('.sheet-section-heading h3').last()).toHaveText('技能·标签·特性');
  await expect(ownSkills).toContainText('侦察');
  await expect(ownSkills).toContainText('私人誓言');
  await expect(ownSkills).not.toContainText('历史鼓舞');
});

test('人物卡特性与共享模板实时同步，停用不被更新重置，副本权限及旧卡刷新保持一致', async ({ table: t }) => {
  test.setTimeout(120_000);
  for (const page of [t.gm, t.a, t.b]) await page.setViewportSize({ width: 1600, height: 1050 });
  const state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: { fieldId: 'magic', name: '法伤', type: 'number', defaultValue: 10 },
  });
  const template = await op(t.gmContext, t.room.id, 'template.create', {
    kind: 'TRAIT',
    name: '夜视特性',
    description: '可看清黑暗环境',
    data: { modifierRows: [{ targetFieldId: 'magic', operation: 'ADD', value: 5 }] },
  });
  await openCharacter(t.gm, '角色甲');
  await openCharacter(t.a, '角色甲');
  await openCharacter(t.b, '角色乙');
  const gmTraits = t.gm.locator('.character-skills .character-trait'),
    ownTraits = t.a.locator('.character-skills .character-trait'),
    copyTraits = t.b.locator('.character-skills .character-trait');
  await t.gm.locator('.sheet-actions').getByRole('button', { name: '技能', exact: true }).click();
  const library = t.gm.locator('.template-library');
  await library.getByRole('button', { name: '特性', exact: true }).click();
  await library
    .locator('.ability-list-card')
    .filter({ hasText: '夜视特性' })
    .getByRole('button', { name: '共享', exact: true })
    .click();
  await closeWindow(t.gm, '关闭能力模板库');
  await op(t.gmContext, t.room.id, 'template.apply', { characterId: t.cb.id, templateId: template.id, shared: false });
  for (const panel of [gmTraits, ownTraits, copyTraits]) {
    await expect(panel).toContainText('夜视特性');
    await expect(panel).toHaveAttribute('title', '可看清黑暗环境');
  }
  await expect(ownTraits.getByRole('button')).toHaveCount(0);
  await expect(copyTraits.getByRole('button')).toHaveCount(0);
  const current = async (id = t.ca.id) =>
    (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === id);
  let character = await current();
  expect(character.derived.values.magic).toBe(15);
  await denied(t.aContext, t.room.id, 'template.enable', {
    characterId: character.id,
    field: 'traits',
    instanceId: character.traits[0].id,
    enabled: false,
    version: character.version,
  });
  await gmTraits.getByRole('button', { name: '停用特性：夜视特性', exact: true }).click();
  await expect(ownTraits).toContainText('已停用');
  expect((await current()).derived.values.magic).toBe(10);
  await op(t.gmContext, t.room.id, 'template.update', {
    id: template.id,
    version: template.version,
    patch: {
      name: '强化夜视',
      description: '黑暗中看得更远',
      data: { enabled: true, modifierRows: [{ targetFieldId: 'magic', operation: 'ADD', value: 8 }] },
    },
  });
  for (const panel of [gmTraits, ownTraits]) {
    await expect(panel).toContainText('强化夜视');
    await expect(panel).toContainText('已停用');
    await expect(panel).toHaveAttribute('title', '黑暗中看得更远');
  }
  character = await current();
  expect(character.traits[0]).toMatchObject({ kind: 'TRAIT', enabled: false, shared: true });
  expect(character.derived.values.magic).toBe(10);
  await expect(copyTraits).toContainText('夜视特性');
  await expect(copyTraits).toHaveAttribute('title', '可看清黑暗环境');
  expect((await current(t.cb.id)).derived.values.magic).toBe(15);
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await expect(ownTraits).toContainText('强化夜视');
  await expect(ownTraits).toContainText('已停用');
  await gmTraits.getByRole('button', { name: '启用特性：强化夜视', exact: true }).click();
  await expect(ownTraits).not.toContainText('已停用');
  expect((await current()).derived.values.magic).toBe(18);
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[1].id}/permissions`, {
    characterValues: true,
    templateInstall: true,
  });
  await ownTraits.getByRole('button', { name: '停用特性：强化夜视', exact: true }).click();
  await expect(gmTraits).toContainText('已停用');
  await expect(copyTraits.getByRole('button')).toHaveCount(0);
  await t.db.room.update({ where: { id: t.room.id }, data: { sheetMode: false } });
  character = await current();
  await op(t.gmContext, t.room.id, 'character.update', {
    id: character.id,
    version: character.version,
    patch: { currentHp: 10 },
  });
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await expect(ownTraits).toContainText('强化夜视');
  await expect(ownTraits).toContainText('已停用');
  await ownTraits.getByRole('button', { name: '移除特性：强化夜视', exact: true }).click();
  await expect(ownTraits).toHaveCount(0);
  await expect(gmTraits).toHaveCount(0);
  expect((await current()).traits).toHaveLength(0);
  await expect(copyTraits).toContainText('夜视特性');
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await expect(ownTraits).toHaveCount(0);
  await expect(t.a.locator('.character-skills')).toContainText('尚未添加技能、标签或特性');
});

test('穿戴离开背包并腾格，卸装满格回滚，玩家生命上限与物品库隐藏', async ({ table: t }) => {
  test.setTimeout(120_000);
  for (const page of [t.gm, t.a]) await page.setViewportSize({ width: 1600, height: 1050 });
  let state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.health.configure', { version: state.room.version, create: true });
  state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: { fieldId: 'magic', name: '法伤', type: 'number', defaultValue: 10 },
  });
  let ca = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
  await op(t.gmContext, t.room.id, 'character.update', {
    id: ca.id,
    version: ca.version,
    patch: { inventorySlots: 1 },
  });
  const item = await op(t.gmContext, t.room.id, 'item.create', {
      name: '穿戴戒指',
      kind: '饰品',
      data: { customFields: [{ name: '法伤', value: 5 }] },
    }),
    secret = await op(t.gmContext, t.room.id, 'item.create', { name: '尚未发放的秘密物品', kind: '杂物' });
  const entry = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: t.ca.id,
    itemId: item.id,
    quantity: 2,
  });
  await op(t.gmContext, t.room.id, 'inventory.instance.update', {
    id: entry.id,
    version: entry.version,
    data: { name: '独立戒指', description: '保留实例备注' },
  });
  await openCharacter(t.a, '角色甲');
  const sheet = t.a.locator('.character-sheet');
  await expect(sheet.getByText('生命上限', { exact: true })).toHaveCount(0);
  await expect(sheet.locator('.grid-card').filter({ hasText: '当前生命' }).locator('strong.text-amber-300')).toHaveText(
    '20',
  );
  await expect(t.a.locator('.game-rail').getByRole('button', { name: '物品', exact: true })).toHaveCount(0);
  expect((await snapshot(t.aContext, t.room.id)).items.map((i: any) => i.id)).toEqual([item.id]);
  await openCharacter(t.gm, '角色甲');
  await expect(t.gm.locator('.character-sheet').getByText('生命上限', { exact: true })).toBeVisible();
  await t.gm.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true }).click();
  await closeWindow(t.gm, '关闭人物卡');
  const pack = t.gm.locator('.inventory-panel');
  await pack.getByRole('button', { name: '查看装备', exact: true }).click();
  const gear = t.gm.locator('.equipment-panel');
  await placeWindow(t.gm, pack, 130, 75);
  await placeWindow(t.gm, gear, 820, 75);
  const cell = pack.getByRole('button', { name: '背包格 1：独立戒指', exact: true });
  await cell.dragTo(gear.getByLabel('装备部位 饰品1', { exact: true }));
  await expect(cell).toContainText('×1');
  await cell.dragTo(gear.getByLabel('装备部位 饰品2', { exact: true }));
  await expect(pack.getByRole('button', { name: '背包格 1：空', exact: true })).toBeVisible();
  await expect(pack.locator('.badge').first()).toHaveText('0 / 1 格');
  ca = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
  expect(ca.inventory[0].quantity).toBe(2);
  expect(ca.inventory[0].position).toBeLessThan(-1);
  expect(ca.derived.values.magic).toBe(20);
  await t.gm.screenshot({ path: '.launcher/ui-equipped-backpack.png', animations: 'disabled' });
  const iron = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: t.ca.id,
    itemId: secret.id,
    quantity: 1,
    position: 0,
  });
  await expect(pack.getByRole('button', { name: '背包格 1：尚未发放的秘密物品', exact: true })).toBeVisible();
  await gear.getByLabel('饰品1装备', { exact: true }).selectOption('');
  await expect(gear.getByRole('alert')).toContainText('背包已满');
  expect((await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id).equipment).toHaveLength(
    2,
  );
  await op(t.gmContext, t.room.id, 'inventory.update', { id: iron.id, version: iron.version, quantity: 0 });
  await expect(pack.getByRole('button', { name: '背包格 1：空', exact: true })).toBeVisible();
  await gear
    .getByLabel('装备物品 饰品1：独立戒指', { exact: true })
    .dragTo(pack.getByRole('button', { name: '背包格 1：空', exact: true }));
  await expect(cell).toContainText('×1');
  ca = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
  expect(ca.inventory[0].data.description).toBe('保留实例备注');
  expect(ca.derived.values.magic).toBe(15);
  await gear.getByLabel('饰品2装备', { exact: true }).selectOption('');
  await expect(cell).toContainText('×2');
  await t.a.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true }).click();
  await closeWindow(t.a, '关闭人物卡');
  await expect(t.a.getByRole('button', { name: '背包格 1：独立戒指', exact: true })).toContainText('×2');
  await t.a.getByRole('button', { name: '背包格 1：独立戒指', exact: true }).click();
  await t.a.getByRole('button', { name: '查看物品卡', exact: true }).click();
  await expect(t.a.locator('.item-editor').getByLabel('名称', { exact: true })).toHaveValue('穿戴戒指');
  await expect(t.a.getByRole('button', { name: '保存物品卡', exact: true })).toHaveCount(0);
  await t.gm.reload();
  await openCharacter(t.gm, '角色甲');
  await t.gm.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true }).click();
  await expect(t.gm.getByRole('button', { name: '背包格 1：独立戒指', exact: true })).toContainText('×2');
});

test('跨角色直接穿戴不占背包格，满格替换保留原物品，旧人物卡玩家隐藏上限', async ({ table: t }) => {
  const current = async (id = t.ca.id) =>
    (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === id);
  const a = await current();
  await op(t.gmContext, t.room.id, 'character.update', { id: a.id, version: a.version, patch: { inventorySlots: 1 } });
  const ring = await op(t.gmContext, t.room.id, 'item.create', { name: '跨角色戒指', kind: '饰品' }),
    other = await op(t.gmContext, t.room.id, 'item.create', { name: '替换戒指', kind: '饰品' }),
    iron = await op(t.gmContext, t.room.id, 'item.create', { name: '占格铁锭', kind: '杂物' });
  const filled = await op(t.gmContext, t.room.id, 'inventory.add', {
      characterId: t.ca.id,
      itemId: iron.id,
      quantity: 1,
    }),
    source = await op(t.gmContext, t.room.id, 'inventory.add', { characterId: t.cb.id, itemId: ring.id, quantity: 1 });
  const received = await op(t.gmContext, t.room.id, 'inventory.transfer', {
    id: source.id,
    version: source.version,
    targetCharacterId: t.ca.id,
    quantity: 1,
    targetSlot: '饰品1',
    targetEquipmentId: null,
  });
  expect(received.position).toBeLessThan(-1);
  expect((await current()).inventory.find((e: any) => e.id === filled.id).position).toBe(0);
  const replacement = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: t.cb.id,
    itemId: other.id,
    quantity: 1,
  });
  const worn = (await current()).equipment[0];
  const payload = {
    id: replacement.id,
    version: replacement.version,
    targetCharacterId: t.ca.id,
    quantity: 1,
    targetSlot: '饰品1',
    targetEquipmentId: worn.id,
  };
  const response = await t.gmContext.request.post(`${api}/rooms/${t.room.id}/operations`, {
    data: { id: randomUUID(), type: 'inventory.transfer', payload },
  });
  expect(response.status()).toBe(409);
  expect((await current()).equipment[0].id).toBe(worn.id);
  expect((await current(t.cb.id)).inventory.find((e: any) => e.id === replacement.id).quantity).toBe(1);
  await op(t.gmContext, t.room.id, 'inventory.update', { id: filled.id, version: filled.version, quantity: 0 });
  await op(t.gmContext, t.room.id, 'inventory.transfer', payload);
  const target = await current();
  expect(target.inventory.find((e: any) => e.itemId === ring.id).position).toBe(0);
  expect(target.inventory.find((e: any) => e.itemId === other.id).position).toBeLessThan(-1);
  await t.db.room.update({ where: { id: t.room.id }, data: { sheetMode: false } });
  const legacy = await current();
  await op(t.gmContext, t.room.id, 'character.update', {
    id: legacy.id,
    version: legacy.version,
    patch: { currentHp: 12 },
  });
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await expect(t.a.locator('.sheet-vital').first().locator('.sheet-vital-value')).toHaveText('12');
  await expect(t.a.locator('.sheet-vital').first().locator('small')).toHaveCount(0);
  await t.gm.reload();
  await openCharacter(t.gm, '角色甲');
  await expect(t.gm.locator('.sheet-vital').first().locator('small')).toBeVisible();
});

test('玩家对归零角色可双向拖拽与按钮取放，放回装备实时重算且本人仍被禁止', async ({ table: t }) => {
  test.setTimeout(120_000);
  await t.b.setViewportSize({ width: 1600, height: 1050 });
  let state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.health.configure', { version: state.room.version, create: true });
  state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: { fieldId: 'magic', name: '法伤', type: 'number', defaultValue: 10 },
  });
  const item = await op(t.gmContext, t.room.id, 'item.create', {
    name: '往返戒指',
    kind: '饰品',
    compatibleSlots: ['饰品1'],
    data: { customFields: [{ name: '法伤', value: 5 }] },
  });
  const entry = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: t.ca.id,
    itemId: item.id,
    quantity: 1,
  });
  await op(t.gmContext, t.room.id, 'inventory.instance.update', {
    id: entry.id,
    version: 0,
    data: { description: '往返保留' },
  });
  await op(t.gmContext, t.room.id, 'equipment.set', { characterId: t.ca.id, slot: '饰品1', entryId: entry.id });
  const current = async (id = t.ca.id) =>
    (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === id);
  const hp = (await snapshot(t.gmContext, t.room.id)).room.sheetSchema.find(
    (f: any) => f.isResource && f.resourceKind !== 'shield' && f.maxFieldId,
  );
  let ca = await current();
  await op(t.gmContext, t.room.id, 'character.field.set', {
    characterId: ca.id,
    fieldId: hp.fieldId,
    version: ca.version,
    value: 0,
  });
  await openCharacter(t.b, '角色甲');
  await t.b.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true }).click();
  await closeWindow(t.b, '关闭人物卡');
  await openCharacter(t.b, '角色乙');
  await t.b.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true }).click();
  await closeWindow(t.b, '关闭人物卡');
  const dead = t.b
      .locator('.inventory-panel')
      .filter({ has: t.b.getByRole('heading', { name: '角色甲 的背包', exact: true }) }),
    own = t.b
      .locator('.inventory-panel')
      .filter({ has: t.b.getByRole('heading', { name: '角色乙 的背包', exact: true }) });
  await placeWindow(t.b, dead, 130, 75);
  await placeWindow(t.b, own, 820, 75);
  await expect(dead.locator('.inventory-slot.filled')).toHaveCount(0);
  await dead.getByRole('button', { name: '查看装备', exact: true }).click();
  const initialGear = t.b.locator('.equipment-panel');
  await placeWindow(t.b, initialGear, 130, 75);
  await initialGear
    .getByLabel('装备物品 饰品1：往返戒指', { exact: true })
    .dragTo(own.getByRole('button', { name: '背包格 2：空', exact: true }));
  await closeWindow(t.b, '关闭装备');
  await expect(own.getByRole('button', { name: '背包格 2：往返戒指', exact: true })).toBeVisible();
  expect((await current()).equipment).toHaveLength(0);
  expect((await current()).derived.values.magic).toBe(10);
  await own
    .getByRole('button', { name: '背包格 2：往返戒指', exact: true })
    .dragTo(dead.getByRole('button', { name: '背包格 3：空', exact: true }));
  await expect(dead.getByRole('button', { name: '背包格 3：往返戒指', exact: true })).toBeVisible();
  await dead
    .getByRole('button', { name: '背包格 3：往返戒指', exact: true })
    .dragTo(dead.getByRole('button', { name: '背包格 5：空', exact: true }));
  await expect(dead.getByRole('button', { name: '背包格 5：往返戒指', exact: true })).toBeVisible();
  await dead.getByRole('button', { name: '背包格 5：往返戒指', exact: true }).click();
  await dead.getByRole('button', { name: '转移物品', exact: true }).click();
  await expect.poll(async () => (await current(t.cb.id)).inventory.length).toBe(1);
  await own.getByRole('button', { name: '背包格 1：往返戒指', exact: true }).click();
  await own.getByLabel('转移目标角色', { exact: true }).selectOption(t.ca.id);
  await own.getByLabel('转移目标位置', { exact: true }).selectOption('饰品1');
  await own.getByRole('button', { name: '转移物品', exact: true }).click();
  await expect.poll(async () => (await current()).derived.values.magic).toBe(15);
  ca = await current();
  expect(ca.inventory[0].data.description).toBe('往返保留');
  expect(ca.equipment[0].entryId).toBe(ca.inventory[0].id);
  await denied(t.aContext, t.room.id, 'inventory.transfer', {
    id: ca.inventory[0].id,
    version: ca.inventory[0].version,
    targetCharacterId: t.cb.id,
    quantity: 1,
  });
  // The owner remains blocked; the other player can use a slot dropdown to remove gear.
  await dead.getByRole('button', { name: '查看装备', exact: true }).click();
  const gear = t.b.locator('.equipment-panel');
  await placeWindow(t.b, gear, 130, 75);
  await gear.getByLabel('饰品1装备', { exact: true }).selectOption('');
  await expect.poll(async () => (await current()).equipment.length).toBe(0);
  await gear.getByLabel('饰品1装备', { exact: true }).selectOption((await current()).inventory[0].id);
  await expect.poll(async () => (await current()).derived.values.magic).toBe(15);
  await gear
    .getByLabel('装备物品 饰品1：往返戒指', { exact: true })
    .dragTo(own.getByRole('button', { name: '背包格 4：空', exact: true }));
  await expect(own.getByRole('button', { name: '背包格 4：往返戒指', exact: true })).toBeVisible();
  await own
    .getByRole('button', { name: '背包格 4：往返戒指', exact: true })
    .dragTo(gear.getByLabel('装备部位 饰品1', { exact: true }));
  await expect.poll(async () => (await current()).equipment.length).toBe(1);
  await expect(gear.getByLabel('装备物品 饰品1：往返戒指', { exact: true })).toBeVisible();
  await gear.getByLabel('装备物品 饰品1：往返戒指', { exact: true }).scrollIntoViewIfNeeded();
  await t.b.screenshot({ path: '.launcher/ui-player-exchange.png', animations: 'disabled' });
  await t.b.reload();
  await openCharacter(t.b, '角色甲');
  await t.b.locator('.sheet-actions').getByRole('button', { name: '装备', exact: true }).click();
  await expect(t.b.getByLabel('装备物品 饰品1：往返戒指', { exact: true })).toBeVisible();
  ca = await current();
  await op(t.gmContext, t.room.id, 'character.field.set', {
    characterId: ca.id,
    fieldId: hp.fieldId,
    version: ca.version,
    value: 1,
  });
  await expect(t.b.locator('.equip-grid')).toHaveCount(0);
});

test('GM 可跨任意角色拖动背包及装备，指定目标格与穿戴部位且旧装备保留', async ({ table: t }) => {
  test.setTimeout(120_000);
  await t.gm.setViewportSize({ width: 1600, height: 1050 });
  const item = await op(t.gmContext, t.room.id, 'item.create', { name: 'GM 转移戒指', kind: '饰品' }),
    old = await op(t.gmContext, t.room.id, 'item.create', { name: '原有戒指', kind: '饰品' });
  const entry = await op(t.gmContext, t.room.id, 'inventory.add', {
      characterId: t.ca.id,
      itemId: item.id,
      quantity: 2,
    }),
    existing = await op(t.gmContext, t.room.id, 'inventory.add', { characterId: t.cb.id, itemId: old.id, quantity: 1 });
  await op(t.gmContext, t.room.id, 'equipment.set', { characterId: t.ca.id, slot: '饰品1', entryId: entry.id });
  await op(t.gmContext, t.room.id, 'equipment.set', { characterId: t.cb.id, slot: '饰品1', entryId: existing.id });
  const current = async (id = t.ca.id) =>
    (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === id);
  await openCharacter(t.gm, '角色甲');
  await t.gm.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true }).click();
  await closeWindow(t.gm, '关闭人物卡');
  await openCharacter(t.gm, '角色乙');
  await t.gm.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true }).click();
  await closeWindow(t.gm, '关闭人物卡');
  const a = t.gm
      .locator('.inventory-panel')
      .filter({ has: t.gm.getByRole('heading', { name: '角色甲 的背包', exact: true }) }),
    b = t.gm
      .locator('.inventory-panel')
      .filter({ has: t.gm.getByRole('heading', { name: '角色乙 的背包', exact: true }) });
  await placeWindow(t.gm, a, 130, 75);
  await placeWindow(t.gm, b, 820, 75);
  await a
    .getByRole('button', { name: '背包格 1：GM 转移戒指', exact: true })
    .dragTo(b.getByRole('button', { name: '背包格 3：空', exact: true }));
  await expect(b.getByRole('button', { name: '背包格 3：GM 转移戒指', exact: true })).toBeVisible();
  expect((await current()).equipment).toHaveLength(1);
  await a.getByRole('button', { name: '查看装备', exact: true }).click();
  const gear = t.gm.locator('.equipment-panel');
  await placeWindow(t.gm, gear, 130, 75);
  await gear
    .getByLabel('装备物品 饰品1：GM 转移戒指', { exact: true })
    .dragTo(b.getByRole('button', { name: '背包格 4：空', exact: true }));
  await expect(b.getByRole('button', { name: '背包格 4：GM 转移戒指', exact: true })).toBeVisible();
  expect((await current()).inventory).toHaveLength(0);
  await b
    .getByRole('button', { name: '背包格 3：GM 转移戒指', exact: true })
    .dragTo(gear.getByLabel('装备部位 饰品1', { exact: true }));
  await expect.poll(async () => (await current()).equipment.length).toBe(1);
  await gear.getByLabel('转移目标角色', { exact: true }).selectOption(t.cb.id);
  await gear.getByLabel('转移目标位置', { exact: true }).selectOption('饰品1');
  await gear.getByRole('button', { name: '转移物品', exact: true }).click();
  await expect.poll(async () => (await current()).equipment.length).toBe(0);
  const target = await current(t.cb.id);
  expect(target.equipment[0].entryId).not.toBe(existing.id);
  expect(target.inventory.some((e: any) => e.id === existing.id)).toBe(true);
  expect(target.inventory.reduce((sum: number, e: any) => sum + (e.itemId === item.id ? e.quantity : 0), 0)).toBe(2);
});

test('双向转移拒绝存活他人、NPC、归零本人、满格及不兼容装备，失败保持原数据', async ({ table: t }) => {
  await t.db.room.update({ where: { id: t.room.id }, data: { sheetMode: false } });
  await t.db.character.updateMany({ where: { id: { in: [t.ca.id, t.cb.id] } }, data: { currentHp: 10 } });
  const item = await op(t.gmContext, t.room.id, 'item.create', {
      name: '胸部装备',
      kind: '装备',
      compatibleSlots: ['胸部'],
    }),
    entry = await op(t.gmContext, t.room.id, 'inventory.add', { characterId: t.cb.id, itemId: item.id, quantity: 1 });
  const payload = { id: entry.id, version: 0, targetCharacterId: t.ca.id, quantity: 1 };
  await denied(t.bContext, t.room.id, 'inventory.transfer', payload);
  await t.db.character.update({ where: { id: t.ca.id }, data: { currentHp: 0, inventorySlots: 1 } });
  const invalid = await t.bContext.request.post(`${api}/rooms/${t.room.id}/operations`, {
    data: { id: randomUUID(), type: 'inventory.transfer', payload: { ...payload, targetSlot: '头部' } },
  });
  expect(invalid.status()).toBe(400);
  const filled = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: t.ca.id,
    itemId: item.id,
    quantity: 1,
  });
  const full = await t.bContext.request.post(`${api}/rooms/${t.room.id}/operations`, {
    data: { id: randomUUID(), type: 'inventory.transfer', payload },
  });
  expect(full.status()).toBe(409);
  expect((await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.cb.id).inventory[0].id).toBe(
    entry.id,
  );
  await op(t.gmContext, t.room.id, 'inventory.update', { id: filled.id, version: 0, quantity: 0 });
  await t.db.character.update({ where: { id: t.cb.id }, data: { currentHp: 0 } });
  await denied(t.bContext, t.room.id, 'inventory.transfer', payload);
  await t.db.character.update({ where: { id: t.cb.id }, data: { currentHp: 10 } });
  const npc = await op(t.gmContext, t.room.id, 'character.create', { name: '不能放回的 NPC', isNpc: true });
  await t.db.character.update({ where: { id: npc.id }, data: { currentHp: 0 } });
  await denied(t.bContext, t.room.id, 'inventory.transfer', { ...payload, targetCharacterId: npc.id });
  const request = {
    id: randomUUID(),
    type: 'inventory.transfer',
    payload: { ...payload, targetSlot: '胸部', targetEquipmentId: null },
  };
  const first = await post(t.bContext, `/rooms/${t.room.id}/operations`, request),
    again = await post(t.bContext, `/rooms/${t.room.id}/operations`, request);
  expect(again).toEqual(first);
  const state = await snapshot(t.gmContext, t.room.id),
    ca = state.characters.find((c: any) => c.id === t.ca.id);
  expect(ca.inventory).toHaveLength(1);
  expect(ca.equipment[0].entryId).toBe(first.id);
});

test('生命区块优先且属性来源悬停按基础、加成、减少着色', async ({ table: t }) => {
  for (const page of [t.gm, t.a]) await page.setViewportSize({ width: 1600, height: 1050 });
  let state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: { fieldId: 'magic', name: '法伤', type: 'number', defaultValue: 23, group: '基础信息' },
  });
  state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.health.configure', { version: state.room.version, create: true });
  for (const [name, value, slot] of [
    ['魔力戒指', 5, '饰品1'],
    ['诅咒戒指', -2, '饰品2'],
  ] as const) {
    const item = await op(t.gmContext, t.room.id, 'item.create', {
      name,
      kind: '饰品',
      data: { customFields: [{ name: '法伤', value }] },
    });
    const entry = await op(t.gmContext, t.room.id, 'inventory.add', {
      characterId: t.ca.id,
      itemId: item.id,
      quantity: 1,
    });
    await op(t.gmContext, t.room.id, 'equipment.set', { characterId: t.ca.id, slot, entryId: entry.id });
  }
  await openCharacter(t.a, '角色甲');
  const sheet = t.a.locator('.character-sheet');
  expect(await sheet.locator('.sheet-section-heading h3').allTextContents()).toEqual([
    '生命',
    '基础信息',
    '故事与特殊机制',
    '技能·标签·特性',
  ]);
  const field = sheet.locator('.grid-card').filter({ has: t.a.getByText('法伤', { exact: true }) });
  await expect(field.locator('strong.text-amber-300')).toHaveText('26');
  await field.getByRole('button', { name: '法伤数值来源' }).hover();
  const tooltip = field.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip.locator('.text-white')).toHaveText('基础数值：23');
  await expect(tooltip.locator('.text-emerald-300')).toHaveText('魔力戒指：+5');
  await expect(tooltip.locator('.text-red-300')).toHaveText('诅咒戒指：-2');
  await t.a.screenshot({ path: '.launcher/ui-value-source.png', animations: 'disabled' });
  await t.a.mouse.move(0, 0);
  await expect(tooltip).toBeHidden();
  await field.getByRole('button', { name: '法伤数值来源' }).focus();
  await expect(tooltip).toBeVisible();
});

test('玩家归零禁用本人背包装备，其他玩家拾取并卸装，恢复生命立即撤回', async ({ table: t }) => {
  test.setTimeout(120_000);
  for (const page of [t.gm, t.a, t.b]) await page.setViewportSize({ width: 1600, height: 1050 });
  let state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.health.configure', { version: state.room.version, create: true });
  state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: { fieldId: 'magic', name: '法伤', type: 'number', defaultValue: 10, group: '基础信息' },
  });
  const item = await op(t.gmContext, t.room.id, 'item.create', {
    name: '倒地角色戒指',
    kind: '饰品',
    data: { customFields: [{ name: '法伤', value: 5 }] },
  });
  const entry = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: t.ca.id,
    itemId: item.id,
    quantity: 2,
  });
  await op(t.gmContext, t.room.id, 'inventory.instance.update', {
    id: entry.id,
    version: 0,
    data: { name: '古老戒指', description: '需要保留的备注' },
  });
  await op(t.gmContext, t.room.id, 'equipment.set', { characterId: t.ca.id, slot: '饰品1', entryId: entry.id });
  for (const user of t.users.slice(1))
    await post(t.gmContext, `/rooms/${t.room.id}/members/${user.id}/permissions`, {
      inventoryAdd: true,
      editAllCharacters: true,
      trade: true,
    });
  const current = async (id = t.ca.id, context = t.gmContext) =>
    (await snapshot(context, t.room.id)).characters.find((c: any) => c.id === id);
  const hp = (await snapshot(t.gmContext, t.room.id)).room.sheetSchema.find(
    (f: any) => f.isResource && f.resourceKind !== 'shield' && f.maxFieldId,
  );
  async function health(value: number, id = t.ca.id) {
    const c = await current(id);
    await op(t.gmContext, t.room.id, 'character.field.set', {
      characterId: id,
      fieldId: hp.fieldId,
      version: c.version,
      value,
    });
  }
  await openCharacter(t.a, '角色甲');
  await openCharacter(t.b, '角色甲');
  await t.a.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true }).click();
  await expect(t.a.locator('.inventory-grid')).toBeVisible();
  await health(0);
  await expect(t.a.locator('.inventory-grid')).toHaveCount(0);
  await expect(t.a.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true })).toHaveCount(0);
  expect((await current(t.ca.id, t.aContext)).inventoryVisible).toBe(false);
  expect((await current(t.ca.id, t.bContext)).inventoryLootable).toBe(true);
  for (const [type, payload] of [
    ['inventory.add', { characterId: t.ca.id, itemId: item.id, quantity: 1 }],
    ['inventory.update', { id: entry.id, version: 1, quantity: 1 }],
    ['inventory.move', { id: entry.id, version: 1, position: 2 }],
    ['inventory.instance.update', { id: entry.id, version: 1, data: { description: '越权' } }],
    ['inventory.transfer', { id: entry.id, targetCharacterId: t.cb.id, quantity: 1 }],
    ['equipment.set', { characterId: t.ca.id, slot: '饰品1', entryId: null }],
    ['trade.offer', { entryId: entry.id, targetCharacterId: t.cb.id, quantity: 1 }],
    ['inventory.loot', { id: entry.id, version: 1, targetCharacterId: t.cb.id, quantity: 1 }],
  ] as const)
    await denied(t.aContext, t.room.id, type, payload);
  await denied(t.bContext, t.room.id, 'inventory.update', { id: entry.id, version: 1, quantity: 5 });
  await t.b.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true }).click();
  await t.b.getByRole('button', { name: '背包格 1：古老戒指', exact: true }).click();
  await expect(t.b.getByText('编辑这一件物品', { exact: true })).toHaveCount(0);
  await t.b.getByRole('button', { name: '转移物品', exact: true }).click();
  await expect.poll(async () => (await current(t.cb.id)).inventory.length).toBe(1);
  let source = await current();
  expect(source.inventory[0].quantity).toBe(1);
  expect(source.equipment).toHaveLength(1);
  expect(source.derived.values.magic).toBe(15);
  expect((await current(t.cb.id)).inventory[0].data).toMatchObject({ name: '古老戒指', description: '需要保留的备注' });
  const stale = await t.bContext.request.post(`${api}/rooms/${t.room.id}/operations`, {
    data: {
      id: randomUUID(),
      type: 'inventory.loot',
      payload: { id: entry.id, version: 1, targetCharacterId: t.cb.id, quantity: 1 },
    },
  });
  expect(stale.status()).toBe(409);
  await closeWindow(t.b, '关闭背包');
  await t.b.locator('.sheet-actions').getByRole('button', { name: '装备', exact: true }).click();
  await t.b.getByRole('button', { name: '转移物品', exact: true }).scrollIntoViewIfNeeded();
  await t.b.screenshot({ path: '.launcher/ui-fallen-equipment.png', animations: 'disabled' });
  await t.b.getByRole('button', { name: '转移物品', exact: true }).click();
  await expect.poll(async () => (await current(t.cb.id)).inventory.length).toBe(2);
  source = await current();
  expect(source.inventory).toHaveLength(0);
  expect(source.equipment).toHaveLength(0);
  expect(source.derived.values.magic).toBe(10);
  await health(1);
  await expect(t.b.locator('.equip-grid')).toHaveCount(0);
  await expect(t.a.locator('.inventory-grid')).toBeVisible();
  expect((await current(t.ca.id, t.bContext)).inventoryLootable).toBe(false);
  await t.b.reload();
  await openCharacter(t.b, '角色乙');
  await t.b.locator('.sheet-actions').getByRole('button', { name: '背包', exact: true }).click();
  await expect(t.b.locator('.inventory-grid')).toContainText('古老戒指');
  expect((await current(t.cb.id)).inventory.reduce((sum: number, e: any) => sum + e.quantity, 0)).toBe(2);
});

test('拾取满格、归零接收、复活、并发与重试均不复制或丢失物品', async ({ table: t }) => {
  await t.db.room.update({ where: { id: t.room.id }, data: { sheetMode: false } });
  const item = await op(t.gmContext, t.room.id, 'item.create', { name: '唯一剧情物品', kind: '杂物' });
  const entry = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: t.ca.id,
    itemId: item.id,
    quantity: 1,
  });
  const current = async (id = t.ca.id) =>
    (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === id);
  async function patch(id: string, patch: Record<string, unknown>) {
    const c = await current(id);
    await op(t.gmContext, t.room.id, 'character.update', { id, version: c.version, patch });
  }
  const request = async (context: BrowserContext, payload: Record<string, unknown>, id = randomUUID()) =>
    context.request.post(`${api}/rooms/${t.room.id}/operations`, { data: { id, type: 'inventory.loot', payload } });
  const payload = { id: entry.id, version: 0, targetCharacterId: t.cb.id, quantity: 1 };
  await denied(t.bContext, t.room.id, 'inventory.loot', payload);
  await patch(t.ca.id, { currentHp: 0 });
  await patch(t.cb.id, { currentHp: 0 });
  await denied(t.bContext, t.room.id, 'inventory.loot', payload);
  await patch(t.cb.id, { currentHp: 10, inventorySlots: 1 });
  const occupied = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: t.cb.id,
    itemId: item.id,
    quantity: 1,
  });
  const full = await request(t.bContext, payload);
  expect(full.status()).toBe(409);
  expect((await current()).inventory[0].quantity).toBe(1);
  await op(t.gmContext, t.room.id, 'inventory.update', { id: occupied.id, version: 0, quantity: 0 });
  const invalid = await request(t.bContext, { ...payload, quantity: 1.5 });
  expect(invalid.status()).toBe(400);
  await patch(t.ca.id, { currentHp: 1 });
  await denied(t.bContext, t.room.id, 'inventory.loot', payload);
  await patch(t.ca.id, { currentHp: 0 });
  const gmCharacter = await op(t.gmContext, t.room.id, 'character.create', {
    name: 'GM 测试角色',
    ownerId: t.users[0].id,
  });
  const ids = [randomUUID(), randomUUID()],
    contexts = [t.bContext, t.gmContext],
    payloads = [payload, { ...payload, targetCharacterId: gmCharacter.id }];
  const results = await Promise.all(contexts.map((context, index) => request(context, payloads[index], ids[index])));
  expect(results.filter((response) => response.ok())).toHaveLength(1);
  expect([404, 409]).toContain(results.find((response) => !response.ok())!.status());
  const winner = results.findIndex((response) => response.ok()),
    data = await results[winner].json();
  const repeated = await request(contexts[winner], payloads[winner], ids[winner]);
  expect(repeated.ok()).toBe(true);
  expect(await repeated.json()).toEqual(data);
  const chars = (await snapshot(t.gmContext, t.room.id)).characters;
  expect(
    chars
      .flatMap((c: any) => c.inventory)
      .filter((e: any) => e.itemId === item.id)
      .reduce((sum: number, e: any) => sum + e.quantity, 0),
  ).toBe(1);
  expect((await current()).inventory).toHaveLength(0);
});

test('交易不能绕过归零角色限制，GM 仍可管理背包和装备', async ({ table: t }) => {
  await t.db.room.update({ where: { id: t.room.id }, data: { sheetMode: false } });
  await t.db.character.updateMany({ where: { id: { in: [t.ca.id, t.cb.id] } }, data: { currentHp: 10 } });
  const item = await op(t.gmContext, t.room.id, 'item.create', { name: '待交易物品' });
  const aEntry = await op(t.gmContext, t.room.id, 'inventory.add', {
      characterId: t.ca.id,
      itemId: item.id,
      quantity: 1,
    }),
    bEntry = await op(t.gmContext, t.room.id, 'inventory.add', { characterId: t.cb.id, itemId: item.id, quantity: 1 });
  const outgoing = await op(t.gmContext, t.room.id, 'trade.offer', {
    entryId: aEntry.id,
    targetCharacterId: t.cb.id,
    quantity: 1,
  });
  const incoming = await op(t.gmContext, t.room.id, 'trade.offer', {
    entryId: bEntry.id,
    targetCharacterId: t.ca.id,
    quantity: 1,
  });
  const c = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
  await op(t.gmContext, t.room.id, 'character.update', { id: c.id, version: c.version, patch: { currentHp: 0 } });
  await denied(t.aContext, t.room.id, 'trade.accept', { id: incoming.id });
  const blocked = await t.bContext.request.post(`${api}/rooms/${t.room.id}/operations`, {
    data: { id: randomUUID(), type: 'trade.accept', payload: { id: outgoing.id } },
  });
  expect(blocked.status()).toBe(409);
  await op(t.gmContext, t.room.id, 'inventory.instance.update', {
    id: aEntry.id,
    version: 0,
    data: { description: 'GM 仍可管理' },
  });
  expect(
    (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id).inventory[0].data
      .description,
  ).toBe('GM 仍可管理');
});

test('NPC 搜索按血条与 GM 许可实时开放、撤回，仅查看并在刷新后保留', async ({ table: t }) => {
  test.setTimeout(120_000);
  for (const page of [t.gm, t.a]) await page.setViewportSize({ width: 1600, height: 1050 });
  await t.db.room.update({ where: { id: t.room.id }, data: { sheetMode: false } });
  const npc = await op(t.gmContext, t.room.id, 'character.create', { name: '守门人', isNpc: true });
  const item = await op(t.gmContext, t.room.id, 'item.create', { name: '守门人的钥匙', kind: '饰品' });
  const entry = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: npc.id,
    itemId: item.id,
    quantity: 1,
  });
  await op(t.gmContext, t.room.id, 'equipment.set', { characterId: npc.id, slot: '饰品1', entryId: entry.id });
  const npcState = async (context = t.gmContext) =>
    (await snapshot(context, t.room.id)).characters.find((c: any) => c.id === npc.id);
  const patch = async (value: Record<string, unknown>) => {
    const c = await npcState();
    await op(t.gmContext, t.room.id, 'character.update', { id: c.id, version: c.version, patch: value });
  };
  expect((await npcState(t.aContext)).inventory).toEqual([]);
  await openCharacter(t.gm, '守门人', true);
  await openCharacter(t.a, '守门人', true);
  const gmSheet = t.gm.locator('.character-sheet'),
    playerSheet = t.a.locator('.character-sheet');
  await gmSheet.getByRole('button', { name: 'NPC 搜索说明', exact: true }).hover();
  await expect(gmSheet.getByRole('tooltip')).toContainText('生命归零');
  await t.gm.screenshot({ path: '.launcher/ui-npc-search-help.png', animations: 'disabled' });
  await gmSheet.getByRole('button', { name: '允许搜索', exact: true }).hover();
  await expect(playerSheet.getByRole('button', { name: '背包', exact: true })).toHaveCount(0);
  await patch({ currentHp: 0 });
  await expect(playerSheet.getByRole('button', { name: '背包', exact: true })).toBeVisible();
  expect((await npcState(t.bContext)).equipment).toHaveLength(1);
  await playerSheet.getByRole('button', { name: '背包', exact: true }).click();
  await expect(t.a.locator('.inventory-grid')).toBeVisible();
  await expect(t.a.locator('.inventory-slot.filled')).toHaveCount(0);
  await expect(t.a.locator('.inventory-grid [draggable=true]')).toHaveCount(0);
  await t.a.locator('.inventory-panel').getByRole('button', { name: '查看装备', exact: true }).click();
  await expect(t.a.getByLabel('装备物品 饰品1：守门人的钥匙', { exact: true })).toBeVisible();
  await expect(t.a.getByLabel('装备物品 饰品1：守门人的钥匙', { exact: true })).toHaveAttribute('draggable', 'false');
  await expect(t.a.getByLabel('饰品1装备', { exact: true })).toHaveCount(0);
  await closeWindow(t.a, '关闭装备');
  await denied(t.aContext, t.room.id, 'inventory.update', { id: entry.id, quantity: 5 });
  await denied(t.aContext, t.room.id, 'equipment.set', { characterId: npc.id, slot: '饰品1', entryId: null });
  await denied(t.aContext, t.room.id, 'character.update', { id: npc.id, patch: { allowSearch: false } });
  await gmSheet.getByRole('button', { name: '允许搜索', exact: true }).click();
  await expect(gmSheet.getByRole('button', { name: '允许搜索', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(
    t.a.getByText('NPC 生命归零且 GM 允许搜索后，才能查看背包和装备。', { exact: true }).last(),
  ).toBeVisible();
  expect((await npcState(t.aContext)).inventory).toEqual([]);
  await t.gm.reload();
  await openCharacter(t.gm, '守门人', true);
  await expect(gmSheet.getByRole('button', { name: '允许搜索', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await gmSheet.getByRole('button', { name: '允许搜索', exact: true }).click();
  await expect(t.a.locator('.inventory-grid')).toBeVisible();
  await patch({ currentHp: 1 });
  await expect(t.a.locator('.inventory-grid')).toHaveCount(0);
  // Switching to a custom sheet must ignore the unused legacy currentHp=0.
  await patch({ currentHp: 0 });
  await t.db.room.update({ where: { id: t.room.id }, data: { sheetMode: true } });
  let state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: { fieldId: 'magic', name: '法伤', type: 'number', defaultValue: 23 },
  });
  expect((await npcState(t.aContext)).inventoryVisible).toBe(false);
  state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.health.configure', { version: state.room.version, create: true });
  state = await snapshot(t.gmContext, t.room.id);
  const hp = state.room.sheetSchema.find((f: any) => f.isResource && f.resourceKind !== 'shield' && f.maxFieldId);
  expect((await npcState(t.aContext)).inventoryVisible).toBe(false);
  const c = await npcState();
  await op(t.gmContext, t.room.id, 'character.field.set', {
    characterId: npc.id,
    fieldId: hp.fieldId,
    version: c.version,
    value: 0,
  });
  await expect(t.a.locator('.inventory-grid')).toBeVisible();
  await t.a.reload();
  await openCharacter(t.a, '守门人', true);
  await expect(playerSheet.getByRole('button', { name: '装备', exact: true })).toBeVisible();
  await patch({ visibility: 'GM' });
  expect((await snapshot(t.aContext, t.room.id)).characters.some((c: any) => c.id === npc.id)).toBe(false);
});

test('主副手装备位在头部之前，旧布局增量升级保留装备，穿脱与多人刷新同步', async ({ table: t }) => {
  for (const page of [t.gm, t.a]) await page.setViewportSize({ width: 1600, height: 1050 });
  let state = await snapshot(t.gmContext, t.room.id);
  const defaultSlots = [
    '主手',
    '副手',
    '头部',
    '胸部',
    '手臂',
    '手部',
    '腿部',
    '鞋',
    '饰品1',
    '饰品2',
    '饰品3',
    '饰品4',
  ];
  expect(state.room.equipmentSlots).toEqual(defaultSlots);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: { fieldId: 'magic', name: '法伤', type: 'number', defaultValue: 23 },
  });
  const entries: Record<string, any> = {};
  for (const [slot, name, bonus] of [
    ['头部', '旧头盔', 1],
    ['主手', '法术长剑', 5],
    ['副手', '魔法盾牌', 2],
  ] as const) {
    const item = await op(t.gmContext, t.room.id, 'item.create', {
      name,
      kind: '装备',
      compatibleSlots: [slot],
      data: { customFields: [{ name: '法伤', type: 'number', value: bonus }] },
    });
    entries[slot] = await op(t.gmContext, t.room.id, 'inventory.add', {
      characterId: t.ca.id,
      itemId: item.id,
      quantity: 1,
    });
  }
  await op(t.gmContext, t.room.id, 'equipment.set', {
    characterId: t.ca.id,
    slot: '头部',
    entryId: entries['头部'].id,
  });
  await t.db.room.update({ where: { id: t.room.id }, data: { equipmentSlots: defaultSlots.slice(2) } });
  const sql = await readFile('apps/api/prisma/migrations/202610130002_equipment_hands/migration.sql', 'utf8');
  // Scope the real migration update to this disposable room; never alter other rooms in a test.
  const update = sql
    .slice(sql.indexOf('UPDATE "Room"'))
    .replace('WHERE "equipmentSlots"', `WHERE "id" = '${t.room.id}' AND "equipmentSlots"`);
  await t.db.$executeRawUnsafe(update);
  state = await snapshot(t.gmContext, t.room.id);
  expect(state.room.equipmentSlots).toEqual(defaultSlots);
  expect(state.characters.find((c: any) => c.id === t.ca.id).equipment).toEqual([
    expect.objectContaining({ slot: '头部', entryId: entries['头部'].id }),
  ]);
  await t.db.$executeRawUnsafe(update);
  expect((await snapshot(t.gmContext, t.room.id)).room.version).toBe(state.room.version);
  await t.gm.reload();
  await openCharacter(t.gm, '角色甲');
  await t.gm.locator('.sheet-actions').getByRole('button', { name: '装备', exact: true }).click();
  const equipment = t.gm.locator('.equipment-panel');
  await expect(equipment.locator('.equip-slot > .eyebrow')).toHaveText(defaultSlots);
  expect(
    await equipment
      .locator('.equip-slot > .eyebrow')
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize),
  ).toBe('15px');
  expect(await equipment.getByLabel('主手装备', { exact: true }).evaluate((el) => getComputedStyle(el).fontSize)).toBe(
    '14px',
  );
  await equipment.getByLabel('主手装备', { exact: true }).selectOption(entries['主手'].id);
  await equipment.getByLabel('副手装备', { exact: true }).selectOption(entries['副手'].id);
  await openCharacter(t.a, '角色甲');
  await expect(
    t.a
      .locator('.character-sheet .grid-card')
      .filter({ has: t.a.getByText('法伤', { exact: true }) })
      .locator('strong.text-amber-300'),
  ).toHaveText('31');
  await t.a.locator('.sheet-actions').getByRole('button', { name: '装备', exact: true }).click();
  await expect(t.a.getByLabel('装备物品 主手：法术长剑', { exact: true })).toBeVisible();
  await expect(t.a.getByLabel('装备物品 副手：魔法盾牌', { exact: true })).toBeVisible();
  const forbidden = await t.gmContext.request.post(`${api}/rooms/${t.room.id}/operations`, {
    data: {
      id: randomUUID(),
      type: 'equipment.set',
      payload: { characterId: t.ca.id, slot: '副手', entryId: entries['主手'].id },
    },
  });
  expect(forbidden.status()).toBe(400);
  await equipment.getByLabel('主手装备', { exact: true }).selectOption('');
  await expect(t.a.getByLabel('装备物品 主手：法术长剑', { exact: true })).toHaveCount(0);
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await expect(
    t.a
      .locator('.character-sheet .grid-card')
      .filter({ has: t.a.getByText('法伤', { exact: true }) })
      .locator('strong.text-amber-300'),
  ).toHaveText('26');
  await t.a.locator('.sheet-actions').getByRole('button', { name: '装备', exact: true }).click();
  await expect(t.a.getByLabel('装备物品 副手：魔法盾牌', { exact: true })).toBeVisible();
  state = await snapshot(t.gmContext, t.room.id);
  const hero = state.characters.find((c: any) => c.id === t.ca.id);
  expect(hero.inventory).toHaveLength(3);
  expect(hero.inventory.find((entry: any) => entry.id === entries['主手'].id).position).toBeGreaterThanOrEqual(0);
  await t.db.room.update({ where: { id: t.room.id }, data: { equipmentSlots: ['头部', '副手', '自定义法器'] } });
  await t.db.$executeRawUnsafe(update);
  expect((await snapshot(t.gmContext, t.room.id)).room.equipmentSlots).toEqual(['头部', '副手', '自定义法器']);
});

test('饰品数值按同名属性加成，穿脱、改名、种类修改与多玩家持久同步', async ({ table: t }) => {
  test.setTimeout(120_000);
  for (const page of [t.gm, t.a]) await page.setViewportSize({ width: 1600, height: 1050 });
  let state = await snapshot(t.gmContext, t.room.id);
  expect(state.room.equipmentSlots).toEqual([
    '主手',
    '副手',
    '头部',
    '胸部',
    '手臂',
    '手部',
    '腿部',
    '鞋',
    '饰品1',
    '饰品2',
    '饰品3',
    '饰品4',
  ]);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: { fieldId: 'magic', name: '法伤', type: 'number', defaultValue: 23 },
  });
  const item = await op(t.gmContext, t.room.id, 'item.create', { name: '法师戒指', kind: '饰品' });
  await t.gm.locator('.game-rail').getByRole('button', { name: '物品', exact: true }).click();
  await t.gm.getByRole('button', { name: '法师戒指', exact: true }).click();
  await closeWindow(t.gm, '关闭物品库');
  const editor = t.gm.locator('.item-editor');
  await editor.getByRole('button', { name: '添加项目', exact: true }).click();
  await editor.getByLabel('项目名称 1', { exact: true }).fill('法伤');
  await editor.getByLabel('项目类型 1', { exact: true }).selectOption('number');
  await editor.getByLabel('项目内容 1', { exact: true }).fill('5');
  await editor.getByRole('button', { name: '保存物品卡', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(t.gmContext, t.room.id)).items.find((i: any) => i.id === item.id).data.customFields[0]?.value,
    )
    .toBe(5);
  await closeWindow(t.gm, '关闭物品卡');
  const entry = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: t.ca.id,
    itemId: item.id,
    quantity: 2,
  });
  await openCharacter(t.gm, '角色甲');
  await openCharacter(t.a, '角色甲');
  const playerValue = t.a
    .locator('.character-sheet .grid-card')
    .filter({ has: t.a.getByText('法伤', { exact: true }) })
    .locator('strong.text-amber-300');
  await expect(playerValue).toHaveText('23');
  await t.gm.locator('.sheet-actions').getByRole('button', { name: '装备', exact: true }).click();
  const equip = t.gm.locator('.equip-grid');
  await expect(equip.locator('.equip-slot')).toHaveCount(12);
  await equip.getByLabel('饰品1装备', { exact: true }).selectOption(entry.id);
  await expect(playerValue).toHaveText('28');
  await equip.getByLabel('饰品2装备', { exact: true }).selectOption(entry.id);
  await expect(playerValue).toHaveText('33');
  let saved = (await snapshot(t.gmContext, t.room.id)).items.find((i: any) => i.id === item.id);
  await op(t.gmContext, t.room.id, 'item.update', {
    id: item.id,
    version: saved.version,
    patch: { data: { customFields: [{ name: '法伤', value: 6 }] } },
  });
  await expect(playerValue).toHaveText('35');
  await equip.getByLabel('饰品2装备', { exact: true }).selectOption('');
  await expect(playerValue).toHaveText('29');
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await expect(playerValue).toHaveText('29');
  const hero = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
  expect(hero.fieldValues.magic ?? 23).toBe(23);
  saved = (await snapshot(t.gmContext, t.room.id)).items.find((i: any) => i.id === item.id);
  await op(t.gmContext, t.room.id, 'item.update', { id: item.id, version: saved.version, patch: { kind: '杂物' } });
  await expect(playerValue).toHaveText('23');
  saved = (await snapshot(t.gmContext, t.room.id)).items.find((i: any) => i.id === item.id);
  await op(t.gmContext, t.room.id, 'item.update', { id: item.id, version: saved.version, patch: { kind: '饰品' } });
  await expect(playerValue).toHaveText('29');
  state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: { ...state.room.sheetSchema.find((f: any) => f.fieldId === 'magic'), name: '魔法伤害' },
  });
  await expect(
    t.a
      .locator('.character-sheet .grid-card')
      .filter({ has: t.a.getByText('魔法伤害', { exact: true }) })
      .locator('strong.text-amber-300'),
  ).toHaveText('23');
  await t.gm.screenshot({ path: '.launcher/ui-equipment-ten-slots.png', animations: 'disabled' });
});

test('旧默认装备布局迁移保留背包与旧物品兼容，自定义布局保持原样', async ({ table: t }) => {
  const old = [
    '头部',
    '脖颈',
    '胸部',
    '手臂',
    '手',
    '腿部',
    '脚踝',
    '脚',
    ...Array.from({ length: 10 }, (_, i) => `手指${i + 1}`),
  ];
  await t.db.room.update({ where: { id: t.room.id }, data: { equipmentSlots: old } });
  for (const slot of ['头部', '手', '脚', '脚踝', '脖颈', '手指1', '手指2', '手指3', '手指4', '手指5']) {
    const item = await op(t.gmContext, t.room.id, 'item.create', {
      name: slot + '旧装备',
      kind: '装备',
      compatibleSlots: [slot],
    });
    const entry = await op(t.gmContext, t.room.id, 'inventory.add', {
      characterId: t.ca.id,
      itemId: item.id,
      quantity: 1,
    });
    await op(t.gmContext, t.room.id, 'equipment.set', { characterId: t.ca.id, slot, entryId: entry.id });
  }
  const sql = await readFile('apps/api/prisma/migrations/202610110003_npc_search_equipment/migration.sql', 'utf8');
  // Exercise the migration's actual DO block, scoped to this disposable test room.
  const block = sql
    .slice(sql.indexOf('DO $$'))
    .replace(
      'WHERE "equipmentSlots" = old_slots',
      'WHERE "equipmentSlots" = old_slots AND "id" = \'' + t.room.id + "'",
    );
  await t.db.$executeRawUnsafe(block);
  let state = await snapshot(t.gmContext, t.room.id),
    hero = state.characters.find((c: any) => c.id === t.ca.id);
  expect(hero.inventory).toHaveLength(10);
  expect(hero.equipment).toHaveLength(7);
  expect(new Set(hero.equipment.map((e: any) => e.slot))).toEqual(
    new Set(['头部', '手部', '鞋', '饰品1', '饰品2', '饰品3', '饰品4']),
  );
  const oldHand = hero.inventory.find((e: any) => e.item.name === '手旧装备');
  await op(t.gmContext, t.room.id, 'equipment.set', { characterId: t.ca.id, slot: '手部', entryId: oldHand.id });
  await t.db.$executeRawUnsafe(block);
  expect((await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id).inventory).toHaveLength(
    10,
  );
  await t.db.equippedItem.deleteMany({ where: { characterId: t.ca.id } });
  await t.db.room.update({
    where: { id: t.room.id },
    data: { equipmentSlots: ['主手', '副手', '护甲', '饰品 1', '饰品 2'] },
  });
  for (const slot of ['主手', '副手', '护甲', '饰品 1', '饰品 2']) {
    const item = await op(t.gmContext, t.room.id, 'item.create', {
      name: slot + '五格旧装备',
      kind: '装备',
      compatibleSlots: [slot],
    });
    const entry = await op(t.gmContext, t.room.id, 'inventory.add', {
      characterId: t.ca.id,
      itemId: item.id,
      quantity: 1,
    });
    await op(t.gmContext, t.room.id, 'equipment.set', { characterId: t.ca.id, slot, entryId: entry.id });
  }
  const secondSql = await readFile(
    'apps/api/prisma/migrations/202610110004_equipment_room_defaults/migration.sql',
    'utf8',
  );
  const secondBlock = secondSql
    .slice(secondSql.indexOf('DO $$'))
    .replace("'::jsonb LOOP", '\'::jsonb AND "id" = \'' + t.room.id + "' LOOP");
  await t.db.$executeRawUnsafe(secondBlock);
  state = await snapshot(t.gmContext, t.room.id);
  hero = state.characters.find((c: any) => c.id === t.ca.id);
  expect(hero.inventory).toHaveLength(15);
  expect(new Set(hero.equipment.map((e: any) => e.slot))).toEqual(new Set(['手部', '胸部', '饰品1', '饰品2']));
  const oldArmor = hero.inventory.find((e: any) => e.item.name === '护甲五格旧装备');
  await op(t.gmContext, t.room.id, 'equipment.set', { characterId: t.ca.id, slot: '胸部', entryId: oldArmor.id });
  await t.db.room.update({ where: { id: t.room.id }, data: { equipmentSlots: ['主手', '副手'] } });
  await t.db.$executeRawUnsafe(block);
  await t.db.$executeRawUnsafe(secondBlock);
  state = await snapshot(t.gmContext, t.room.id);
  expect(state.room.equipmentSlots).toEqual(['主手', '副手']);
});

test('GM 可编辑入口名称，失败保留输入、改名不覆盖移动且玩家实时同步', async ({ table: t }) => {
  test.setTimeout(120_000);
  await t.gm.setViewportSize({ width: 1600, height: 1050 });
  await t.a.setViewportSize({ width: 1600, height: 1050 });
  const source = await op(t.gmContext, t.room.id, 'map.create', { name: '入口起点', width: 1200, height: 800 }),
    target = await op(t.gmContext, t.room.id, 'map.create', { name: '入口终点', parentId: source.id });
  await op(t.gmContext, t.room.id, 'map.activate', { id: source.id });
  const portal = await op(t.gmContext, t.room.id, 'portal.create', {
    sourceMapId: source.id,
    targetMapId: target.id,
    label: '旧入口名称',
    x: 250,
    y: 260,
  });
  for (const page of [t.gm, t.a]) {
    await page.locator('.game-rail').getByRole('button', { name: '地图', exact: true }).click();
    await page
      .getByRole('region', { name: '地图入口列表' })
      .getByRole('button', { name: '入口详情', exact: true })
      .click();
    await closeWindow(page, '关闭地图管理');
  }
  await expect(t.a.locator('.map-portal').getByRole('button', { name: '编辑入口名称', exact: true })).toHaveCount(0);
  await denied(t.aContext, t.room.id, 'portal.update', { id: portal.id, label: '玩家改名' });
  await t.gm.locator('.map-portal').getByRole('button', { name: '编辑入口名称', exact: true }).click();
  const form = t.gm.locator('.portal-name-editor');
  await form.getByLabel('入口名称', { exact: true }).fill('通往地下城');
  let fail = true;
  await t.gm.route('**/api/rooms/*/operations', async (route) => {
    if (fail && route.request().postDataJSON().type === 'portal.update') {
      fail = false;
      await route.fulfill({ status: 503, json: { error: '测试：入口名称暂时未保存' } });
    } else await route.continue();
  });
  await form.getByRole('button', { name: '保存入口名称', exact: true }).click();
  await expect(t.gm.locator('.map-portal [role=alert]')).toHaveText('测试：入口名称暂时未保存');
  await expect(form.getByLabel('入口名称', { exact: true })).toHaveValue('通往地下城');
  await op(t.gmContext, t.room.id, 'portal.update', { id: portal.id, x: 600, y: 450 });
  await form.getByRole('button', { name: '保存入口名称', exact: true }).click();
  await t.gm.unroute('**/api/rooms/*/operations');
  await expect(form).toHaveCount(0);
  await expect(t.a.locator('.map-portal h3')).toHaveText('通往地下城');
  await expect
    .poll(() =>
      t.a.evaluate(
        (id) =>
          (window as any).Konva?.stages[0]
            ?.findOne('#' + id)
            ?.find('Text')
            .map((node: any) => node.text()) || [],
        portal.id,
      ),
    )
    .toContain('通往地下城');
  const saved = (await snapshot(t.gmContext, t.room.id)).portals.find((item: any) => item.id === portal.id);
  expect(saved).toMatchObject({ label: '通往地下城', x: 600, y: 450, sourceMapId: source.id, targetMapId: target.id });
  const invalid = await t.gmContext.request.post(`${api}/rooms/${t.room.id}/operations`, {
    data: { id: randomUUID(), type: 'portal.update', payload: { id: portal.id, label: '  ' } },
  });
  expect(invalid.status()).toBe(400);
  await t.gm.reload();
  await t.gm.locator('.game-rail').getByRole('button', { name: '地图', exact: true }).click();
  const entranceList = t.gm.getByRole('region', { name: '地图入口列表' });
  await expect(entranceList).toContainText('通往地下城');
  await entranceList.getByRole('button', { name: '入口详情', exact: true }).click();
  await expect(t.gm.locator('.map-portal h3')).toHaveText('通往地下城');
});

test('地图工具标题可拖动并记住个人位置，折叠、控制操作和屏幕边界正常', async ({ table: t }) => {
  for (const page of [t.gm, t.a]) await page.setViewportSize({ width: 1600, height: 1050 });
  const map = await op(t.gmContext, t.room.id, 'map.create', { name: '工具拖动测试', width: 1400, height: 900 });
  await op(t.gmContext, t.room.id, 'map.activate', { id: map.id });
  await expect(t.gm.locator('.board-tools').getByRole('button', { name: '量尺', exact: true })).toBeEnabled();
  const tools = t.gm.locator('.board-tools'),
    other = t.a.locator('.board-tools');
  const playerStart = (await other.boundingBox())!;
  const stagePosition = () =>
    t.gm.evaluate(() => {
      const stage = (window as any).Konva.stages.find((stage: any) => stage.container().isConnected);
      return { x: stage.x(), y: stage.y(), scale: stage.scaleX() };
    });
  const stageStart = await stagePosition();
  async function dragTitle(page: Page, dx: number, dy: number) {
    const heading = page.locator('.board-tools-heading'),
      box = (await heading.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 40 + dx, box.y + box.height / 2 + dy, { steps: 12 });
    await page.mouse.up();
  }
  const start = (await tools.boundingBox())!;
  await dragTitle(t.gm, 420, -300);
  let moved = (await tools.boundingBox())!;
  expect(moved.x).toBeCloseTo(start.x + 420, 0);
  expect(moved.y).toBeCloseTo(start.y - 300, 0);
  await expect(tools.getByRole('button', { name: '折叠地图工具', exact: true })).toBeVisible();
  expect(await stagePosition()).toEqual(stageStart);
  expect(await other.boundingBox()).toEqual(playerStart);
  await tools.getByRole('button', { name: '量尺', exact: true }).click();
  await tools.getByLabel('量尺形状').selectOption('CIRCLE');
  await tools.getByLabel('量尺距离').fill('12');
  await expect(tools.getByLabel('量尺距离')).toHaveValue('12');
  expect((await tools.boundingBox())!.x).toBeCloseTo(moved.x, 0);
  expect((await tools.boundingBox())!.y).toBeCloseTo(moved.y, 0);
  await tools.getByRole('button', { name: '折叠地图工具', exact: true }).click();
  await expect(tools).toHaveClass(/collapsed/);
  await dragTitle(t.gm, -100, -100);
  await expect(tools).toHaveClass(/collapsed/);
  moved = (await tools.boundingBox())!;
  await tools.getByRole('button', { name: '展开地图工具', exact: true }).focus();
  await t.gm.keyboard.press('Enter');
  await expect(tools).not.toHaveClass(/collapsed/);
  expect((await tools.boundingBox())!.x).toBeCloseTo(moved.x, 0);
  expect((await tools.boundingBox())!.y).toBeCloseTo(moved.y, 0);
  await t.gm.reload();
  await expect(tools.getByRole('button', { name: '折叠地图工具', exact: true })).toBeVisible();
  await expect
    .poll(async () => ({ x: (await tools.boundingBox())!.x, y: (await tools.boundingBox())!.y }))
    .toEqual({ x: moved.x, y: moved.y });
  await dragTitle(t.a, 150, -180);
  const playerMoved = (await other.boundingBox())!;
  expect(playerMoved.x).toBeCloseTo(playerStart.x + 150, 0);
  expect(playerMoved.y).toBeCloseTo(playerStart.y - 180, 0);
  await t.a.reload();
  await expect.poll(async () => (await other.boundingBox())!.x).toBeCloseTo(playerMoved.x, 0);
  expect((await tools.boundingBox())!.x).toBeCloseTo(moved.x, 0);
  await dragTitle(t.gm, 1400, 900);
  await t.gm.setViewportSize({ width: 850, height: 620 });
  await expect
    .poll(async () => {
      const panel = (await tools.boundingBox())!,
        parent = (await t.gm.locator('.board-surface').boundingBox())!;
      return (
        panel.x >= parent.x + 8 &&
        panel.y >= parent.y + 8 &&
        panel.x + panel.width <= parent.x + parent.width - 8 &&
        panel.y + panel.height <= parent.y + parent.height - 8
      );
    })
    .toBe(true);
  await dragTitle(t.gm, -1400, -900);
  const edge = (await tools.boundingBox())!,
    parent = (await t.gm.locator('.board-surface').boundingBox())!;
  expect(edge.x).toBeCloseTo(parent.x + 8, 0);
  expect(edge.y).toBeCloseTo(parent.y + 8, 0);
  await tools.getByRole('button', { name: '平移', exact: true }).click();
  await expect(tools.getByRole('button', { name: '平移', exact: true })).toHaveClass(/btn-primary/);
});

test('地图工具加大且可独立折叠恢复，最近骰子位于 GM 同行者和玩家摘要下方', async ({ table: t }) => {
  test.setTimeout(120_000);
  for (const page of [t.gm, t.a, t.b]) await page.setViewportSize({ width: 1600, height: 1050 });
  await op(t.gmContext, t.room.id, 'character.create', { name: 'GM 自己的角色', ownerId: t.users[0].id });
  const map = await op(t.gmContext, t.room.id, 'map.create', { name: '工具测试地图', width: 1200, height: 800 });
  await op(t.gmContext, t.room.id, 'map.activate', { id: map.id });
  const tools = t.a.locator('.board-tools');
  await expect(tools.getByRole('button', { name: '平移', exact: true })).toBeVisible();
  expect((await tools.boundingBox())!.width).toBeGreaterThanOrEqual(290);
  await tools.getByRole('button', { name: '折叠地图工具', exact: true }).click();
  await expect(tools.getByRole('button', { name: '展开地图工具', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(tools.getByRole('button', { name: '平移', exact: true })).toHaveCount(0);
  await expect(t.gm.locator('.board-tools').getByRole('button', { name: '平移', exact: true })).toBeVisible();
  await t.a.reload();
  await expect(tools.getByRole('button', { name: '展开地图工具', exact: true })).toBeVisible();
  await tools.getByRole('button', { name: '展开地图工具', exact: true }).click();
  await tools.getByRole('button', { name: '量尺', exact: true }).click();
  await tools.getByLabel('量尺距离').fill('7');
  await tools.getByRole('button', { name: '折叠地图工具', exact: true }).click();
  await expect(tools).toContainText('量尺');
  await t.a.locator('.board-surface').click({ position: { x: 650, y: 500 } });
  await expect
    .poll(
      async () =>
        (await snapshot(t.gmContext, t.room.id)).drawings.filter((drawing: any) => drawing.kind === 'RULER').length,
    )
    .toBe(1);
  await expect(tools).toContainText('平移');
  await tools.getByRole('button', { name: '展开地图工具', exact: true }).click();
  const roll = await op(t.aContext, t.room.id, 'dice.roll', {
    expression: '1d6',
    reason: '大家的公开检定',
    visibility: 'PUBLIC',
  });
  for (const page of [t.gm, t.a, t.b]) {
    await expect(page.locator('.party-stack .last-roll')).toContainText('大家的公开检定');
    await expect(page.locator('.last-roll-player-name')).toHaveText(t.users[1].username);
    await expect(page.locator('.last-roll-player-name')).toHaveAttribute('title', t.users[1].username);
    await expect(page.locator('.last-roll')).toHaveCount(1);
    await expect(page.locator('.last-roll strong')).toHaveText(String(roll.total));
  }
  const gmParty = (await t.gm.locator('.party-panel').boundingBox())!,
    gmRoll = (await t.gm.locator('.last-roll').boundingBox())!,
    gmHero = (await t.gm.locator('.hero-tray').boundingBox())!;
  expect(gmRoll.y).toBeGreaterThanOrEqual(gmParty.y + gmParty.height);
  expect(gmRoll.y + gmRoll.height).toBeLessThanOrEqual(gmHero.y);
  expect(gmRoll.x).toBe(gmParty.x);
  const playerHero = (await t.a.locator('.hero-tray').boundingBox())!,
    playerRoll = (await t.a.locator('.last-roll').boundingBox())!;
  expect(playerRoll.y).toBeGreaterThanOrEqual(playerHero.y + playerHero.height);
  expect(playerRoll.x).toBe(playerHero.x);
  expect(playerRoll.x).toBeGreaterThan(1200);
  await t.gm.screenshot({ path: '.launcher/ui-gm-roll-top-right.png' });
  await t.a.screenshot({ path: '.launcher/ui-player-roll-top-right.png' });
  await t.a.locator('.last-roll').click();
  await expect(t.a.locator('.dice-tray')).toBeVisible();
  await closeWindow(t.a, '关闭骰子');
  await op(t.aContext, t.room.id, 'dice.roll', { expression: '1d20', reason: '甲的私密检定', visibility: 'PRIVATE' });
  await expect(t.gm.locator('.last-roll')).toContainText('甲的私密检定');
  await expect(t.a.locator('.last-roll')).toContainText('甲的私密检定');
  await expect(t.b.locator('.last-roll')).toContainText('大家的公开检定');
  await t.a.setViewportSize({ width: 1000, height: 900 });
  await expect(t.a.locator('.party-stack .last-roll')).toBeVisible();
  await t.a.reload();
  await expect(t.a.locator('.last-roll')).toContainText('甲的私密检定');
  await expect(tools.getByRole('button', { name: '折叠地图工具', exact: true })).toBeVisible();
});

test('GM 编辑地图重命名尺寸及比例尺可同步持久化，失败保留草稿且不改变关联', async ({ table: t }) => {
  test.setTimeout(120_000);
  await t.gm.setViewportSize({ width: 1600, height: 1050 });
  const map = await op(t.gmContext, t.room.id, 'map.create', {
      name: '旧古堡',
      imageUrl: '/maps/frontier-watchtower.png',
      width: 1400,
      height: 900,
    }),
    child = await op(t.gmContext, t.room.id, 'map.create', { name: '地下室', parentId: map.id });
  await op(t.gmContext, t.room.id, 'map.activate', { id: map.id });
  const portal = await op(t.gmContext, t.room.id, 'portal.create', {
      sourceMapId: map.id,
      targetMapId: child.id,
      label: '楼梯',
      x: 500,
      y: 400,
    }),
    token = await op(t.gmContext, t.room.id, 'token.create', { mapId: map.id, characterId: t.ca.id, x: 250, y: 260 });
  await t.gm.locator('.game-rail').getByRole('button', { name: '地图', exact: true }).click();
  const library = t.gm.locator('.map-library');
  await library
    .locator('article')
    .filter({ hasText: '旧古堡' })
    .getByRole('button', { name: '编辑地图', exact: true })
    .click();
  const editor = t.gm.locator('.map-editor');
  const editorBox = (await editor.boundingBox())!,
    windowBox = (await t.gm.locator('.window').filter({ has: editor }).boundingBox())!;
  expect(editorBox.y).toBeLessThan(windowBox.y + 220);
  await editor.getByLabel('地图名称', { exact: true }).fill('古堡外庭');
  await editor.getByLabel('宽度（像素）', { exact: true }).fill('1200');
  await editor.getByLabel('高度（像素）', { exact: true }).fill('800');
  await editor.getByLabel('比例尺像素', { exact: true }).fill('50');
  await editor.getByLabel('对应距离（尺）', { exact: true }).fill('10');
  let fail = true;
  await t.gm.route('**/api/rooms/*/operations', async (route) => {
    if (fail && route.request().postDataJSON().type === 'map.update') {
      fail = false;
      await route.fulfill({ status: 503, json: { error: '测试：地图暂时无法保存' } });
    } else await route.continue();
  });
  await editor.getByRole('button', { name: '保存地图', exact: true }).click();
  await expect(editor.locator('[role=alert]')).toHaveText('测试：地图暂时无法保存');
  await expect(editor.getByLabel('地图名称', { exact: true })).toHaveValue('古堡外庭');
  await editor.getByRole('button', { name: '保存地图', exact: true }).click();
  await t.gm.unroute('**/api/rooms/*/operations');
  await expect(editor).toHaveCount(0);
  await expect(t.a.locator('.room-heading')).toContainText('古堡外庭');
  let state = await snapshot(t.gmContext, t.room.id),
    saved = state.maps.find((m: any) => m.id === map.id);
  expect(saved).toMatchObject({
    name: '古堡外庭',
    width: 1200,
    height: 800,
    scalePixels: 50,
    scaleUnits: 10,
    imageUrl: map.imageUrl,
  });
  expect(state.maps.find((m: any) => m.id === child.id).parentId).toBe(map.id);
  expect(state.portals[0]).toEqual(portal);
  expect(state.tokens[0]).toEqual(token);
  await library.locator('.map-detail').getByRole('button', { name: '编辑地图', exact: true }).click();
  await editor.getByLabel('地图名称', { exact: true }).fill('本地未保存名字');
  await op(t.gmContext, t.room.id, 'map.update', {
    id: map.id,
    version: saved.version,
    patch: { name: '另一处已更新地图' },
  });
  await expect(t.gm.locator('.room-heading')).toContainText('另一处已更新地图');
  await editor.getByRole('button', { name: '保存地图', exact: true }).click();
  await expect(editor.locator('[role=alert]')).toContainText('数据已被其他人修改');
  await expect(editor.getByLabel('地图名称', { exact: true })).toHaveValue('本地未保存名字');
  await editor.getByRole('button', { name: '重新载入（清空本次修改）', exact: true }).click();
  await expect(editor.getByLabel('地图名称', { exact: true })).toHaveValue('另一处已更新地图');
  await editor.getByLabel('地图名称', { exact: true }).fill('最终古堡');
  await editor.getByRole('button', { name: '保存地图', exact: true }).click();
  await t.gm.reload();
  await t.gm.locator('.game-rail').getByRole('button', { name: '地图', exact: true }).click();
  await library.getByLabel('地图册选择地图').selectOption(map.id);
  await library.locator('.map-detail').getByRole('button', { name: '编辑地图', exact: true }).click();
  await expect(editor.getByLabel('地图名称', { exact: true })).toHaveValue('最终古堡');
  await expect(editor.getByLabel('比例尺像素', { exact: true })).toHaveValue('50');
  await denied(t.aContext, t.room.id, 'map.update', { id: map.id, patch: { name: '玩家修改' } });
  await t.a.locator('.game-rail').getByRole('button', { name: '地图', exact: true }).click();
  await expect(t.a.locator('.map-library').getByRole('button', { name: '编辑地图', exact: true })).toHaveCount(0);
  state = await snapshot(t.gmContext, t.room.id);
  saved = state.maps.find((m: any) => m.id === map.id);
  for (const patch of [{ name: '' }, { width: -1 }, { height: 1.5 }, { scalePixels: 0 }, { scaleUnits: 0 }]) {
    const response = await t.gmContext.request.post(`${api}/rooms/${t.room.id}/operations`, {
      data: { id: randomUUID(), type: 'map.update', payload: { id: map.id, version: saved.version, patch } },
    });
    expect(response.status()).toBe(400);
  }
  await t.gm.screenshot({ path: '.launcher/ui-map-editor.png' });
});

test('GM 能力模板库与玩家能力标题区分，按分类新建，共享副本说明及安装一致', async ({ table: t }) => {
  test.setTimeout(120_000);
  await t.gm.setViewportSize({ width: 1600, height: 1050 });
  await openCharacter(t.gm, '角色甲');
  await t.gm.locator('.character-sheet').getByRole('button', { name: '技能', exact: true }).click();
  await closeWindow(t.gm, '关闭人物卡');
  const library = t.gm.locator('.template-library'),
    editor = t.gm.locator('.template-editor');
  await expect(library.getByRole('heading', { name: '能力模板库', exact: true })).toBeVisible();
  await expect(t.gm.locator('.window-title')).toContainText('能力模板库');
  await expect(t.gm.getByRole('button', { name: '关闭能力模板库', exact: true })).toBeVisible();
  for (const [kind, label] of [
    ['TRAIT', '特性'],
    ['SKILL', '技能'],
    ['SPECIAL', '特殊机制'],
  ]) {
    await library.getByRole('button', { name: label, exact: true }).click();
    await library.getByRole('button', { name: '新建', exact: true }).click();
    await expect(editor.getByLabel('类型', { exact: true })).toHaveValue(kind);
    await expect(editor.getByLabel('类型', { exact: true })).toBeDisabled();
    await expect(editor.getByLabel('类型', { exact: true }).locator('option')).toHaveCount(1);
    await editor.getByLabel('名称', { exact: true }).fill(`${label}实例`);
    await editor.getByLabel('说明与使用建议', { exact: true }).fill(`${label} 的原说明`);
    await editor.getByRole('button', { name: '保存模板', exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(library.locator('.ability-list-card')).toHaveCount(1);
    expect(
      (await snapshot(t.gmContext, t.room.id)).templates.find((item: any) => item.name === `${label}实例`).kind,
    ).toBe(kind);
  }
  for (const [page, name] of [
    [t.a, '角色甲'],
    [t.b, '角色乙'],
  ] as const) {
    await openCharacter(page, name);
    await page.locator('.sheet-actions').getByRole('button', { name: '技能', exact: true }).click();
    const abilities = page.locator('.template-library'),
      window = page.locator('.window').filter({ has: abilities });
    await expect(abilities.getByRole('heading', { name: '能力', exact: true })).toBeVisible();
    await expect(window.locator('.window-title')).toContainText('能力');
    await expect(window.locator('.window-title')).not.toContainText('能力模板库');
    await expect(abilities.getByRole('button', { name: '技能', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(abilities).toContainText('技能实例');
    for (const action of ['新建', '编辑', '删除', '共享', '副本'])
      await expect(abilities.getByRole('button', { name: action, exact: true })).toHaveCount(0);
    await window.getByRole('button', { name: '最小化能力', exact: true }).click();
    await expect(page.getByRole('button', { name: '能力', exact: true })).toHaveCount(0);
    await page.locator('.sheet-actions').getByRole('button', { name: '技能', exact: true }).click();
    await expect(window).toBeVisible();
    await closeWindow(page, '关闭能力');
    await expect(abilities).toHaveCount(0);
    await closeWindow(page, '关闭人物卡');
  }
  await library.getByRole('button', { name: '全部', exact: true }).click();
  await library.getByRole('button', { name: '新建', exact: true }).click();
  await expect(editor.getByLabel('类型', { exact: true })).toBeEnabled();
  await expect(editor.getByLabel('类型', { exact: true }).locator('option')).toHaveCount(3);
  await editor.getByLabel('类型', { exact: true }).selectOption('SKILL');
  await editor.getByLabel('名称', { exact: true }).fill('全部分类新技能');
  await editor.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await library.getByRole('button', { name: '技能', exact: true }).click();
  const card = library.locator('.ability-list-card').filter({ hasText: '技能实例' });
  await card.getByRole('button', { name: '共享说明', exact: true }).hover();
  await expect(card.getByRole('tooltip')).toContainText('同步更新');
  await card.getByRole('button', { name: '副本说明', exact: true }).hover();
  await expect(card.getByRole('tooltip')).toContainText('不会改变角色上的这份能力');
  await t.gm.screenshot({ path: '.launcher/ui-template-help.png', animations: 'disabled' });
  await library.getByRole('heading', { name: '能力模板库', exact: true }).hover();
  await expect(card.getByRole('tooltip')).toHaveCount(0);
  await card.getByRole('button', { name: '共享', exact: true }).click();
  let state = await snapshot(t.gmContext, t.room.id);
  const template = state.templates.find((item: any) => item.name === '技能实例');
  await expect
    .poll(
      async () =>
        (await snapshot(t.gmContext, t.room.id)).characters
          .find((c: any) => c.id === t.ca.id)
          .skills.find((entry: any) => entry.templateId === template.id)?.shared,
    )
    .toBe(true);
  await op(t.gmContext, t.room.id, 'template.apply', { characterId: t.cb.id, templateId: template.id, shared: false });
  await card.getByRole('button', { name: '编辑', exact: true }).click();
  await editor.getByLabel('说明与使用建议', { exact: true }).fill('修订后的技能说明');
  await editor.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(editor).toHaveCount(0);
  state = await snapshot(t.gmContext, t.room.id);
  expect(
    state.characters.find((c: any) => c.id === t.ca.id).skills.find((entry: any) => entry.templateId === template.id)
      .description,
  ).toBe('修订后的技能说明');
  expect(
    state.characters.find((c: any) => c.id === t.cb.id).skills.find((entry: any) => entry.templateId === template.id),
  ).toMatchObject({ shared: false, description: '技能 的原说明' });
  await t.gm.reload();
  await openCharacter(t.gm, '角色甲');
  await t.gm.locator('.character-sheet').getByRole('button', { name: '技能', exact: true }).click();
  await expect(t.gm.locator('.template-library')).toContainText('修订后的技能说明');
});

test('右上同行者下方展示角色血量，中文日志可折叠，窗口四边和四角可缩放', async ({ table: t }) => {
  await t.a.setViewportSize({ width: 1600, height: 1050 });
  let state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.health.configure', { version: state.room.version, create: true });
  const party = await t.a.locator('.party-panel').boundingBox();
  await expect(t.a.locator('.party-stack .hero-chip')).toContainText('20 / 20');
  const hero = await t.a.locator('.hero-tray').boundingBox();
  expect(hero!.y).toBeGreaterThanOrEqual(party!.y + party!.height);
  expect(hero!.x).toBe(party!.x);
  expect(hero!.x).toBeGreaterThan(1200);
  await t.a.locator('.hero-chip').hover();
  await expect(t.a.locator('.hero-hover-card')).toContainText('角色甲');
  await t.a.screenshot({ path: '.launcher/ui-party-top-right.png' });
  await t.a.mouse.move(600, 800);
  await t.a.locator('.game-rail').getByRole('button', { name: '日志', exact: true }).click();
  const log = t.a
    .locator('.activity-event')
    .filter({ has: t.a.locator('summary').filter({ hasText: '设置生命与生命上限' }) });
  await expect(log).toHaveCount(1);
  await expect(log.locator('.activity-detail')).toBeHidden();
  await log.locator('summary').click();
  await expect(log.locator('.activity-detail')).toContainText(t.users[0].username);
  await expect(log.locator('.activity-detail')).not.toContainText('sheet.health.configure');
  await log.locator('summary').click();
  await expect(log.locator('.activity-detail')).toBeHidden();
  const panel = t.a.locator('.window').filter({ has: t.a.locator('.activity-logs') });
  await panel.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {})));
  });
  for (const [edge, dx, dy] of [
    ['e', 35, 0],
    ['w', -35, 0],
    ['n', 0, -25],
    ['s', 0, 25],
    ['ne', 20, -20],
    ['nw', -20, -20],
    ['se', 20, 20],
    ['sw', -20, 20],
  ] as [string, number, number][]) {
    const before = (await panel.boundingBox())!,
      handle = panel.locator('.resize-' + edge),
      point = (await handle.boundingBox())!;
    await handle.hover();
    expect(await handle.evaluate((element) => getComputedStyle(element).cursor)).toContain('resize');
    await t.a.mouse.move(point.x + point.width / 2, point.y + point.height / 2);
    await t.a.mouse.down();
    await t.a.mouse.move(point.x + point.width / 2 + dx, point.y + point.height / 2 + dy, { steps: 6 });
    await t.a.mouse.up();
    const after = (await panel.boundingBox())!;
    if (dx) expect(after.width).toBeGreaterThan(before.width + 10);
    if (dy) expect(after.height).toBeGreaterThan(before.height + 10);
    if (edge.includes('w')) expect(after.x + after.width).toBeCloseTo(before.x + before.width, 0);
    if (edge.includes('n')) expect(after.y + after.height).toBeCloseTo(before.y + before.height, 0);
  }
  await panel.getByRole('button', { name: '最小化活动日志', exact: true }).click();
  await expect(t.a.getByRole('button', { name: '活动日志', exact: true })).toHaveCount(0);
  await t.a.locator('.game-rail').getByRole('button', { name: '日志', exact: true }).click();
  await expect(panel).toBeVisible();
  state = await snapshot(t.gmContext, t.room.id);
  expect(state.characters).toHaveLength(2);
});

test('地图册可选择子地图，入口创建可重试、点击跳转、同步移动并删除入口保留地图', async ({ table: t }) => {
  test.setTimeout(120_000);
  await t.gm.setViewportSize({ width: 1600, height: 1050 });
  await t.a.setViewportSize({ width: 1600, height: 1050 });
  const source = await op(t.gmContext, t.room.id, 'map.create', { name: '起点地图', width: 1200, height: 800 });
  await op(t.gmContext, t.room.id, 'map.activate', { id: source.id });
  await t.gm.locator('.game-rail').getByRole('button', { name: '地图', exact: true }).click();
  const library = t.gm.locator('.map-library');
  await library.getByLabel('新地图名称', { exact: true }).fill('洞穴区域');
  await library.getByRole('button', { name: '新建', exact: true }).click();
  await expect(library.locator('.map-detail')).toContainText('洞穴区域');
  await library.getByLabel('新地图名称', { exact: true }).fill('洞穴深处');
  await library.getByRole('button', { name: '新建', exact: true }).click();
  await expect(library.locator('.map-detail')).toContainText('洞穴深处');
  let state = await snapshot(t.gmContext, t.room.id);
  const parent = state.maps.find((map: any) => map.name === '洞穴区域'),
    child = state.maps.find((map: any) => map.name === '洞穴深处');
  expect(child.parentId).toBe(parent.id);
  await library.getByLabel('地图册选择地图').selectOption('');
  await library.getByLabel('地图册选择地图').selectOption(child.id);
  await expect(library.locator('.map-detail')).toContainText('洞穴深处');
  await library.locator('.map-detail').getByRole('button', { name: '创建入口', exact: true }).click();
  await expect(library.getByLabel('入口目标地图')).toHaveValue(child.id);
  await library.getByLabel('入口名称', { exact: true }).fill('通往深处');
  let fail = true;
  await t.gm.route('**/api/rooms/*/operations', async (route) => {
    if (fail && route.request().postDataJSON().type === 'portal.create') {
      fail = false;
      await route.fulfill({ status: 503, json: { error: '测试：入口暂时未保存' } });
    } else await route.continue();
  });
  await library.getByRole('button', { name: '放置入口', exact: true }).click();
  await expect(library.locator('[role=alert]')).toHaveText('测试：入口暂时未保存');
  expect((await snapshot(t.gmContext, t.room.id)).portals).toHaveLength(0);
  await library.getByRole('button', { name: '放置入口', exact: true }).click();
  await t.gm.unroute('**/api/rooms/*/operations');
  await expect(t.gm.locator('.map-portal')).toContainText('起点地图 → 洞穴深处');
  state = await snapshot(t.gmContext, t.room.id);
  const portal = state.portals[0];
  expect(state.maps).toHaveLength(3);
  expect(portal.targetMapId).toBe(child.id);
  await t.gm.screenshot({ path: '.launcher/ui-map-portal.png' });
  await closeWindow(t.gm, '关闭地图入口');
  await closeWindow(t.gm, '关闭地图管理');
  async function portalPoint(page: Page) {
    await expect
      .poll(() => page.evaluate((id) => Boolean((window as any).Konva?.stages[0]?.findOne('#' + id)), portal.id))
      .toBe(true);
    return page.evaluate((id) => {
      const stage = (window as any).Konva.stages[0],
        point = stage.findOne('#' + id).getAbsolutePosition(),
        box = stage.container().getBoundingClientRect();
      return { x: point.x + box.left, y: point.y + box.top };
    }, portal.id);
  }
  let point = await portalPoint(t.gm);
  await t.gm.mouse.move(point.x, point.y);
  await t.gm.mouse.down();
  await t.gm.mouse.move(point.x + 70, point.y + 40, { steps: 8 });
  await t.gm.mouse.up();
  await expect.poll(async () => (await snapshot(t.aContext, t.room.id)).portals[0].x).not.toBe(portal.x);
  point = await portalPoint(t.a);
  await t.a.mouse.click(point.x, point.y);
  await expect(t.a.locator('.map-portal')).toContainText('请 GM');
  await expect(t.a.locator('.map-portal').getByRole('button', { name: '删除入口', exact: true })).toHaveCount(0);
  await denied(t.aContext, t.room.id, 'portal.delete', { id: portal.id });
  await denied(t.aContext, t.room.id, 'portal.update', { id: portal.id, x: 1, y: 1 });
  await denied(t.aContext, t.room.id, 'map.activate', { id: child.id });
  point = await portalPoint(t.gm);
  await t.gm.mouse.click(point.x, point.y);
  await t.gm.locator('.map-portal').getByRole('button', { name: '跳转到该地图', exact: true }).click();
  await expect(t.a.locator('.room-heading')).toContainText('洞穴深处');
  await expect(t.gm.locator('.room-heading')).toContainText('洞穴深处');
  await t.gm.reload();
  expect((await snapshot(t.gmContext, t.room.id)).portals[0].targetMapId).toBe(child.id);
  await op(t.gmContext, t.room.id, 'map.activate', { id: source.id });
  point = await portalPoint(t.gm);
  await t.gm.mouse.click(point.x, point.y);
  t.gm.once('dialog', (dialog) => dialog.accept());
  await t.gm.locator('.map-portal').getByRole('button', { name: '删除入口', exact: true }).click();
  await expect(t.a.locator('.map-portal')).toContainText('此入口已删除');
  state = await snapshot(t.gmContext, t.room.id);
  expect(state.portals).toHaveLength(0);
  expect(state.maps.some((map: any) => map.id === child.id)).toBe(true);
  await closeWindow(t.gm, '关闭地图入口');
  await t.gm.locator('.game-rail').getByRole('button', { name: '地图', exact: true }).click();
  await library.getByLabel('地图册选择地图').selectOption(parent.id);
  t.gm.once('dialog', (dialog) => dialog.accept());
  await library.locator('.map-detail').getByRole('button', { name: '删除地图', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(t.gmContext, t.room.id)).maps.find((map: any) => map.id === child.id).parentId)
    .toBe(null);
  await library.getByLabel('地图册选择地图').selectOption(child.id);
  await expect(library.locator('.map-detail')).toContainText('洞穴深处');
});

test('字段管理简化表单，强制 GM 编辑并保护历史 OWNER 字段', async ({ table: t }) => {
  await t.gm.locator('.game-rail').getByRole('button', { name: '字段', exact: true }).click();
  for (const text of ['最小值（可选）', '最大值（可选）', '谁能编辑'])
    await expect(t.gm.getByText(text, { exact: true })).toHaveCount(0);
  await t.gm.getByLabel('字段标识', { exact: true }).fill('gm_value');
  await t.gm.getByLabel('显示名称', { exact: true }).fill('GM 裁定值');
  await t.gm.getByLabel('默认值', { exact: true }).fill('23');
  await t.gm.getByRole('button', { name: '保存字段', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(t.gmContext, t.room.id)).room.sheetSchema.find((f: any) => f.fieldId === 'gm_value')
          ?.editableBy,
    )
    .toBe('GM');
  let state = await snapshot(t.gmContext, t.room.id);
  const forged = await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: {
      fieldId: 'old_value',
      name: '历史数值',
      type: 'number',
      defaultValue: 10,
      min: 0,
      max: 50,
      editableBy: 'OWNER',
    },
  });
  expect(forged.field.editableBy).toBe('GM');
  // Simulate a pre-upgrade room without rewriting or resetting its existing character values.
  state = await snapshot(t.gmContext, t.room.id);
  await t.db.room.update({
    where: { id: t.room.id },
    data: {
      sheetSchema: state.room.sheetSchema.map((f: any) =>
        f.fieldId === 'old_value' ? { ...f, editableBy: 'OWNER' } : f,
      ),
    },
  });
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[1].id}/permissions`, {
    characterBasics: true,
    characterValues: true,
    editAllCharacters: true,
  });
  for (const fieldId of ['gm_value', 'old_value']) {
    for (const type of ['character.field.set', 'character.field.adjust']) {
      const c = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
      await denied(t.aContext, t.room.id, type, {
        characterId: c.id,
        fieldId,
        version: c.version,
        value: 30,
        delta: 2,
      });
      await op(t.gmContext, t.room.id, type, { characterId: c.id, fieldId, version: c.version, value: 30, delta: 2 });
    }
  }
  await openCharacter(t.a, '角色甲');
  await expect(t.a.getByLabel('历史数值原始值')).toHaveCount(0);
  await expect(t.a.getByLabel('GM 裁定值原始值')).toHaveCount(0);
  await expect(t.a.locator('[data-field-id="old_value"] strong.text-amber-300')).toHaveText('32');
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await expect(t.a.locator('[data-field-id="old_value"] strong.text-amber-300')).toHaveText('32');
  await expect(t.a.getByLabel('历史数值原始值')).toHaveCount(0);
  state = await snapshot(t.gmContext, t.room.id);
  expect(state.room.sheetSchema.find((f: any) => f.fieldId === 'old_value')).toMatchObject({
    min: 0,
    max: 50,
    editableBy: 'OWNER',
  });
});

test('人物字段仅 GM 修改，基础信息授权独立，生命和故事始终受控', async ({ table: t }) => {
  test.setTimeout(120_000);
  await t.gm.setViewportSize({ width: 1600, height: 1050 });
  let state = await snapshot(t.gmContext, t.room.id);
  for (const field of [
    { fieldId: 'agility', name: '敏捷点', type: 'number', defaultValue: 5, group: '数值' },
    { fieldId: 'job', name: '职业', type: 'text', defaultValue: '游侠', group: '基础信息' },
  ]) {
    await op(t.gmContext, t.room.id, 'sheet.field.upsert', { version: state.room.version, field });
    state = await snapshot(t.gmContext, t.room.id);
  }
  await op(t.gmContext, t.room.id, 'sheet.health.configure', { version: state.room.version, create: true });
  state = await snapshot(t.gmContext, t.room.id);
  const hp = state.room.sheetSchema.find((field: any) => field.isResource && field.resourceKind !== 'shield'),
    maximum = state.room.sheetSchema.find((field: any) => field.fieldId === hp.maxFieldId);
  // Old OWNER definitions must remain protected without deleting them.
  for (const field of [hp, maximum]) {
    await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
      version: state.room.version,
      field: { ...field, editableBy: 'OWNER' },
    });
    state = await snapshot(t.gmContext, t.room.id);
  }
  const getHero = async () => (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
  await denied(t.aContext, t.room.id, 'character.update', { id: t.ca.id, patch: { name: '未授权名字' } });
  await denied(t.aContext, t.room.id, 'character.field.set', {
    characterId: t.ca.id,
    fieldId: 'agility',
    version: (await getHero()).version,
    value: 7,
  });
  const avatar = await t.aContext.request.post(`${api}/rooms/${t.room.id}/characters/${t.ca.id}/avatar`, {
    multipart: {
      version: String((await getHero()).version),
      file: { name: 'avatar.png', mimeType: 'image/png', buffer: await picture },
    },
  });
  expect(avatar.status()).toBe(403);
  await openCharacter(t.a, '角色甲');
  await expect(t.a.getByLabel('角色名称')).toBeDisabled();
  await expect(t.a.getByLabel('角色描述')).toBeDisabled();
  await expect(t.a.getByLabel('敏捷点原始值')).toHaveCount(0);
  await expect(t.a.getByLabel('当前生命原始值')).toHaveCount(0);
  await expect(t.a.getByLabel('上传角色头像')).toHaveCount(0);
  await t.gm.locator('.game-rail').getByRole('button', { name: '设置', exact: true }).click();
  for (const label of ['编辑人物卡基础信息', '编辑普通人物数值'])
    await t.gm.getByLabel(`${t.users[1].username} · ${label}`, { exact: true }).selectOption('allow');
  await expect(t.a.getByLabel('角色名称')).toBeEnabled();
  await expect(t.a.getByLabel('敏捷点原始值')).toHaveCount(0);
  await denied(t.aContext, t.room.id, 'character.field.set', {
    characterId: t.ca.id,
    fieldId: 'agility',
    version: (await getHero()).version,
    value: 9,
  });
  await op(t.gmContext, t.room.id, 'character.field.set', {
    characterId: t.ca.id,
    fieldId: 'agility',
    version: (await getHero()).version,
    value: 9,
  });
  await expect.poll(async () => (await getHero()).derived.values.agility).toBe(9);
  await denied(t.aContext, t.room.id, 'character.field.set', {
    characterId: t.ca.id,
    fieldId: 'job',
    version: (await getHero()).version,
    value: '铁匠',
  });
  await op(t.aContext, t.room.id, 'character.update', {
    id: t.ca.id,
    version: (await getHero()).version,
    patch: { name: '角色甲' },
  });
  for (const fieldId of [hp.fieldId, hp.maxFieldId])
    for (const type of ['character.field.set', 'character.field.adjust'])
      await denied(t.aContext, t.room.id, type, {
        characterId: t.ca.id,
        fieldId,
        version: (await getHero()).version,
        value: 99,
        delta: 2,
      });
  for (const patch of [
    { description: '玩家编写的故事' },
    { currentHp: 99 },
    { fields: { 特殊机制: '越权' } },
    { formulas: [] },
    { skills: [] },
  ])
    await denied(t.aContext, t.room.id, 'character.update', { id: t.ca.id, version: (await getHero()).version, patch });
  await expect(t.a.getByLabel('角色描述')).toBeDisabled();
  await expect(t.a.getByLabel('当前生命原始值')).toHaveCount(0);
  const special = await op(t.gmContext, t.room.id, 'template.create', {
    name: 'GM 裁决机制',
    kind: 'SPECIAL',
    description: '由 GM 控制',
  });
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[1].id}/permissions`, {
    characterBasics: true,
    characterValues: true,
    templateInstall: true,
  });
  await denied(t.aContext, t.room.id, 'template.apply', { characterId: t.ca.id, templateId: special.id });
  const installed = await op(t.gmContext, t.room.id, 'template.apply', {
    characterId: t.ca.id,
    templateId: special.id,
  });
  await denied(t.aContext, t.room.id, 'template.remove', {
    characterId: t.ca.id,
    field: 'skills',
    instanceId: installed.skills[0].id,
  });
  await op(t.gmContext, t.room.id, 'character.field.set', {
    characterId: t.ca.id,
    fieldId: hp.fieldId,
    version: (await getHero()).version,
    value: 13,
  });
  await expect(t.a.locator('.grid-card').filter({ hasText: '当前生命' })).toContainText('13');
  await expect(t.a.locator('.grid-card').filter({ hasText: '当前生命' })).not.toContainText('/ 20');
  await t.gm.getByLabel(`${t.users[1].username} · 编辑普通人物数值`, { exact: true }).selectOption('deny');
  await expect(t.a.getByLabel('敏捷点原始值')).toHaveCount(0);
  await denied(t.aContext, t.room.id, 'character.field.set', {
    characterId: t.ca.id,
    fieldId: 'agility',
    version: (await getHero()).version,
    value: 10,
  });
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await expect(t.a.getByLabel('敏捷点原始值')).toHaveCount(0);
  await expect(t.a.getByLabel('角色描述')).toBeDisabled();
  expect((await getHero()).derived.values.agility).toBe(9);
  await t.gm.getByRole('checkbox', { name: '编辑普通人物数值', exact: true }).check();
  await t.gm.getByRole('button', { name: '保存权限模式', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(t.gmContext, t.room.id)).room.permissionSettings.characterValues)
    .toBe(true);
  state = await snapshot(t.bContext, t.room.id);
  const other = state.characters.find((c: any) => c.id === t.cb.id);
  await denied(t.bContext, t.room.id, 'character.field.set', {
    characterId: t.cb.id,
    fieldId: 'agility',
    version: other.version,
    value: 11,
  });
  await denied(t.aContext, t.room.id, 'character.field.set', {
    characterId: t.ca.id,
    fieldId: 'agility',
    version: (await getHero()).version,
    value: 10,
  });
  await t.db.room.update({ where: { id: t.room.id }, data: { sheetMode: false } });
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await expect(t.a.getByLabel('调整血量点数')).toHaveCount(0);
  await expect(t.a.getByLabel('角色描述')).toBeDisabled();
});

test('玩家侧栏背包可移动和交换格子，物品库仅 GM 可见且整理失败可恢复', async ({ table: t }) => {
  test.setTimeout(120_000);
  await t.a.setViewportSize({ width: 1600, height: 1050 });
  const item = await op(t.gmContext, t.room.id, 'item.create', { name: '旅行护甲', kind: '装备' }),
    iron = await op(t.gmContext, t.room.id, 'item.create', { name: '铁锭', kind: '杂物' });
  const armorEntry = await op(t.gmContext, t.room.id, 'inventory.add', {
      characterId: t.ca.id,
      itemId: item.id,
      quantity: 2,
      position: 0,
    }),
    ironEntry = await op(t.gmContext, t.room.id, 'inventory.add', {
      characterId: t.ca.id,
      itemId: iron.id,
      position: 1,
    });
  await op(t.gmContext, t.room.id, 'inventory.instance.update', {
    id: armorEntry.id,
    version: armorEntry.version,
    data: { description: '旅行途中获得' },
  });
  const state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'equipment.set', {
    characterId: t.ca.id,
    slot: state.room.equipmentSlots[0],
    entryId: armorEntry.id,
  });
  const backpack = t.a.locator('.game-rail').getByRole('button', { name: '背包', exact: true });
  await backpack.click();
  const panel = t.a.locator('.inventory-panel');
  await expect(panel).toContainText('角色甲 的背包');
  await expect(panel.getByLabel('选择物品')).toHaveCount(0);
  await denied(t.aContext, t.room.id, 'inventory.add', { characterId: t.ca.id, itemId: iron.id });
  await denied(t.aContext, t.room.id, 'inventory.update', { id: armorEntry.id, quantity: 3 });
  const inventory = async () =>
    (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id).inventory;
  let failMove = true;
  await t.a.route('**/api/rooms/*/operations', async (route) => {
    if (failMove && route.request().postDataJSON().type === 'inventory.move') {
      failMove = false;
      await route.fulfill({ status: 503, json: { error: '测试：整理失败，请重试' } });
    } else await route.continue();
  });
  const source = panel.getByRole('button', { name: '背包格 1：旅行护甲', exact: true }),
    empty = panel.getByRole('button', { name: '背包格 24：空', exact: true });
  await source.dragTo(empty);
  await expect(panel.getByRole('alert')).toHaveText('测试：整理失败，请重试');
  expect((await inventory()).find((entry: any) => entry.id === armorEntry.id).position).toBe(0);
  await source.dragTo(empty);
  await t.a.unroute('**/api/rooms/*/operations');
  await expect(panel.getByRole('button', { name: '背包格 24：旅行护甲', exact: true })).toBeVisible();
  await panel
    .getByRole('button', { name: '背包格 24：旅行护甲', exact: true })
    .dragTo(panel.getByRole('button', { name: '背包格 2：铁锭', exact: true }));
  await expect(panel.getByRole('button', { name: '背包格 2：旅行护甲', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '背包格 24：铁锭', exact: true })).toBeVisible();
  const saved = await inventory(),
    armor = saved.find((entry: any) => entry.id === armorEntry.id);
  expect(armor.quantity).toBe(2);
  expect(armor.data.description).toBe('旅行途中获得');
  expect(armor.equipped).toHaveLength(1);
  await denied(t.bContext, t.room.id, 'inventory.move', {
    id: armor.id,
    version: armor.version,
    position: 3,
    targetEntryId: null,
  });
  const stale = await t.aContext.request.post(`${api}/rooms/${t.room.id}/operations`, {
    data: {
      id: randomUUID(),
      type: 'inventory.move',
      payload: { id: armor.id, version: armor.version - 1, position: 3, targetEntryId: null },
    },
  });
  expect(stale.status()).toBe(409);
  await t.a.reload();
  await backpack.click();
  await expect(panel.getByRole('button', { name: '背包格 2：旅行护甲', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: '背包格 24：铁锭', exact: true })).toBeVisible();
  await expect(t.a.locator('.game-rail').getByRole('button', { name: '物品', exact: true })).toHaveCount(0);
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[1].id}/permissions`, {
    inventoryAdd: true,
    publicItems: true,
  });
  await t.a.reload();
  await backpack.click();
  await expect(panel.getByLabel('选择物品')).toHaveCount(0);
  await expect(t.a.locator('.game-rail').getByRole('button', { name: '物品', exact: true })).toHaveCount(0);
  await backpack.click();
  await expect(panel).toHaveCount(0);
  await backpack.click();
  await expect(panel).toBeVisible();
  expect((await inventory()).find((entry: any) => entry.id === ironEntry.id).position).toBe(23);
});

test('地图头像血条和悬停概览显示玩家与 NPC，实时同步且隐藏资料不泄露', async ({ table: t }) => {
  test.setTimeout(120_000);
  await t.a.setViewportSize({ width: 1600, height: 1050 });
  let state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.health.configure', { version: state.room.version, create: true });
  state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: {
      fieldId: 'private_info',
      name: '秘密代号',
      type: 'text',
      group: '基础信息',
      visibility: 'GM',
      defaultValue: '绝密雪鸮',
    },
  });
  const npc = await op(t.gmContext, t.room.id, 'character.create', { name: '向导 NPC', isNpc: true }),
    hidden = await op(t.gmContext, t.room.id, 'character.create', { name: '隐藏敌人', isNpc: true, visibility: 'GM' });
  for (const kind of ['TRAIT', 'SKILL', 'STATUS', 'SPECIAL']) {
    const template = await op(t.gmContext, t.room.id, 'template.create', {
      name: { TRAIT: '夜视', SKILL: '追踪', STATUS: '鼓舞', SPECIAL: '守护契约' }[kind],
      kind,
      description: '可见能力说明',
    });
    for (const c of [t.ca, npc])
      await op(t.gmContext, t.room.id, 'template.apply', { characterId: c.id, templateId: template.id });
  }
  const map = await op(t.gmContext, t.room.id, 'map.create', { name: '悬停概览场景', width: 1400, height: 900 });
  await op(t.gmContext, t.room.id, 'map.activate', { id: map.id });
  const token = await op(t.gmContext, t.room.id, 'token.create', {
      mapId: map.id,
      characterId: t.ca.id,
      x: 500,
      y: 360,
    }),
    npcToken = await op(t.gmContext, t.room.id, 'token.create', { mapId: map.id, characterId: npc.id, x: 850, y: 520 });
  await op(t.gmContext, t.room.id, 'token.create', { mapId: map.id, characterId: hidden.id, x: 900, y: 300 });
  async function hover(id: string) {
    await expect
      .poll(() => t.a.evaluate((id) => Boolean((window as any).Konva?.stages[0]?.findOne('#' + id)), id))
      .toBe(true);
    const point = await t.a.evaluate((id) => {
      const stage = (window as any).Konva.stages[0],
        p = stage.findOne('#' + id).getAbsolutePosition(),
        box = stage.container().getBoundingClientRect();
      return { x: p.x + box.left, y: p.y + box.top };
    }, id);
    await t.a.mouse.move(point.x, point.y);
  }
  const tooltip = t.a.locator('.character-hover-card');
  await hover(token.id);
  await expect(tooltip).toContainText('角色甲');
  await expect(tooltip).toContainText('20 / 20');
  for (const name of ['夜视', '追踪', '鼓舞', '守护契约']) await expect(tooltip).toContainText(name);
  await expect(tooltip).not.toContainText('绝密雪鸮');
  const healthText = async () =>
    t.a.evaluate(
      (id) =>
        (window as any).Konva.stages[0]
          .findOne('#' + id)
          .findOne('.token-health')
          .findOne('Text')
          .text(),
      token.id,
    );
  expect(await healthText()).toBe('20/20');
  state = await snapshot(t.gmContext, t.room.id);
  const hp = state.room.sheetSchema.find((field: any) => field.isResource && field.resourceKind !== 'shield'),
    hero = state.characters.find((c: any) => c.id === t.ca.id);
  await op(t.gmContext, t.room.id, 'character.field.set', {
    characterId: hero.id,
    fieldId: hp.fieldId,
    version: hero.version,
    value: 7,
  });
  await expect(tooltip).toContainText('7 / 20');
  await expect.poll(healthText).toBe('7/20');
  await t.a.screenshot({ path: '.launcher/ui-character-hover.png' });
  await t.a.mouse.move(100, 900);
  await expect(tooltip).toHaveCount(0);
  await hover(npcToken.id);
  await expect(tooltip).toContainText('向导 NPC');
  await expect(tooltip).toContainText('NPC · GM 控制');
  await expect(tooltip).toContainText('守护契约');
  const playerState = await snapshot(t.aContext, t.room.id);
  expect(playerState.characters.some((c: any) => c.id === hidden.id)).toBe(false);
  expect(playerState.characters.find((c: any) => c.id === hero.id).derived.values.private_info).toBeUndefined();
  await t.a.reload();
  await hover(token.id);
  await expect(tooltip).toContainText('7 / 20');
  await t.a.mouse.wheel(0, -100);
  await t.a.mouse.move(100, 900);
  await hover(npcToken.id);
  await expect(tooltip).toContainText('向导 NPC');
});

test('物品自由项目和备注持久化，格子物品库可实际拖入背包并保留权限', async ({ table: t }) => {
  test.setTimeout(120_000);
  await t.gm.setViewportSize({ width: 1600, height: 1050 });
  await t.a.setViewportSize({ width: 1600, height: 1050 });
  await t.gm.locator('.game-rail').getByRole('button', { name: '物品', exact: true }).click();
  const library = t.gm.locator('.item-library');
  await library.getByLabel('物品名称', { exact: true }).fill('铁锭');
  await library.getByLabel('物品名称', { exact: true }).press('Enter');
  const editor = t.gm.locator('.item-editor');
  await expect(editor.getByText('防御值', { exact: true })).toHaveCount(0);
  await expect(editor.getByText(/JSON/)).toHaveCount(0);
  await expect(editor.getByText('装备后数值修正', { exact: true })).toHaveCount(0);
  await editor.getByLabel('描述', { exact: true }).fill('打造工具用的普通铁锭');
  await editor.getByRole('button', { name: '添加项目', exact: true }).click();
  await editor.getByLabel('项目名称 1', { exact: true }).fill('重量');
  await editor.getByLabel('项目类型 1', { exact: true }).selectOption('number');
  await editor.getByLabel('项目内容 1', { exact: true }).fill('2.5');
  await editor.getByRole('button', { name: '添加项目', exact: true }).click();
  await editor.getByLabel('项目名称 2', { exact: true }).fill('材质');
  await editor.getByLabel('项目内容 2', { exact: true }).fill('铁');
  await editor.getByLabel('备注', { exact: true }).fill('来自旧矿场，留给铁匠。');
  await editor.getByRole('button', { name: '保存物品卡', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(t.gmContext, t.room.id)).items[0].data.notes)
    .toBe('来自旧矿场，留给铁匠。');
  let item = (await snapshot(t.gmContext, t.room.id)).items[0];
  expect(item.data).toEqual({
    customFields: [
      { name: '重量', value: 2.5 },
      { name: '材质', value: '铁' },
    ],
    notes: '来自旧矿场，留给铁匠。',
  });
  await closeWindow(t.gm, '关闭物品卡');
  await expect(library.getByRole('button', { name: '铁锭', exact: true })).toHaveAttribute('draggable', 'true');
  await op(t.gmContext, t.room.id, 'item.create', { name: '铜锭', kind: '杂物' });
  await expect(library.locator('.item-library-slot')).toHaveCount(2);
  const boxes = await library
    .locator('.item-library-slot')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({ x: node.getBoundingClientRect().x, y: node.getBoundingClientRect().y })),
    );
  expect(boxes[0].y).toBe(boxes[1].y);
  expect(boxes[0].x).not.toBe(boxes[1].x);
  await openCharacter(t.gm, '角色甲');
  await t.gm.getByRole('button', { name: '背包', exact: true }).click();
  await closeWindow(t.gm, '关闭人物卡');
  async function place(page: Page, selector: string, left: number, top: number) {
    const title = page
      .locator('.window')
      .filter({ has: page.locator(selector) })
      .locator('.window-title');
    await title.evaluate(async (element) => {
      await Promise.all(
        element
          .closest('.window')!
          .getAnimations()
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    const box = (await title.boundingBox())!;
    await title.click({ position: { x: box.width - 10, y: 20 } });
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(left + 20, top + 20, { steps: 8 });
    await page.mouse.up();
  }
  await place(t.gm, '.inventory-panel', 850, 100);
  await place(t.gm, '.item-library', 110, 80);
  const iron = library.getByRole('button', { name: '铁锭', exact: true }),
    slot = t.gm.getByRole('button', { name: '背包格 3：空', exact: true });
  await iron.dragTo(slot);
  await expect(t.gm.getByRole('button', { name: '背包格 3：铁锭', exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await snapshot(t.aContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id).inventory.length,
    )
    .toBe(1);
  await t.gm.getByRole('button', { name: '背包格 3：铁锭', exact: true }).click();
  await expect(t.gm.locator('.item-detail-fields')).toContainText('重量2.5');
  await expect(t.gm.locator('.inventory-detail')).toContainText('来自旧矿场');
  await t.gm.screenshot({ path: '.launcher/ui-items-backpack.png' });
  const forbidden = await t.bContext.request.post(`${api}/rooms/${t.room.id}/operations`, {
    data: { id: randomUUID(), type: 'inventory.add', payload: { characterId: t.ca.id, itemId: item.id } },
  });
  expect(forbidden.status()).toBe(403);
  let failDrop = true;
  await t.gm.route('**/api/rooms/*/operations', async (route) => {
    if (failDrop && route.request().postDataJSON().type === 'inventory.add') {
      failDrop = false;
      await route.fulfill({ status: 503, json: { error: '测试：放入背包暂时失败' } });
    } else await route.continue();
  });
  const source = library.getByRole('button', { name: '铁锭', exact: true }),
    target = t.gm.getByRole('button', { name: '背包格 4：空', exact: true });
  await source.dragTo(target);
  await expect(t.gm.locator('.inventory-panel [role=alert]')).toHaveText('测试：放入背包暂时失败');
  await expect(t.gm.locator('.inventory-panel .inventory-slot.filled')).toHaveCount(1);
  await source.dragTo(target);
  await t.gm.unroute('**/api/rooms/*/operations');
  await expect(t.gm.getByRole('button', { name: '背包格 4：铁锭', exact: true })).toBeVisible();
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await t.a.locator('.character-sheet').getByRole('button', { name: '背包', exact: true }).click();
  await expect(t.a.locator('.inventory-slot.filled')).toHaveCount(2);
  await expect(t.a.locator('.game-rail').getByRole('button', { name: '物品', exact: true })).toHaveCount(0);
  // Saving ordinary details must retain an old item's structured data and numeric effects.
  item = (await snapshot(t.gmContext, t.room.id)).items.find((definition: any) => definition.id === item.id);
  await op(t.gmContext, t.room.id, 'item.update', {
    id: item.id,
    version: item.version,
    patch: { data: { ...item.data, 防御: 3, modifiers: { legacy: 2 }, 来源: { 矿场: '北方' } } },
  });
  await t.gm.reload();
  await t.gm.locator('.game-rail').getByRole('button', { name: '物品', exact: true }).click();
  await t.gm.locator('.item-library').getByRole('button', { name: '铁锭', exact: true }).click();
  await t.gm.locator('.item-editor').getByLabel('备注', { exact: true }).fill('旧资料仍保留');
  await t.gm.getByRole('button', { name: '保存物品卡', exact: true }).click();
  await expect
    .poll(async () => (await snapshot(t.gmContext, t.room.id)).items.find((i: any) => i.id === item.id).data.notes)
    .toBe('旧资料仍保留');
  const saved = (await snapshot(t.gmContext, t.room.id)).items.find((i: any) => i.id === item.id);
  expect(saved.data.防御).toBe(3);
  expect(saved.data.modifiers).toEqual({ legacy: 2 });
  expect(saved.data.来源).toEqual({ 矿场: '北方' });
});

test('人物卡操作顺序、血条、能力图标与标签新增保持清楚并同步', async ({ table: t }) => {
  test.setTimeout(120_000);
  await t.gm.setViewportSize({ width: 1600, height: 1100 });
  await openCharacter(t.gm, '角色甲');
  await expect(t.gm.locator('.sheet-actions button')).toHaveText(['技能', '管理标签', '编辑人物卡', '背包', '装备']);
  await t.gm.getByRole('button', { name: '编辑人物卡', exact: true }).click();
  await closeWindow(t.gm, '关闭人物卡');
  await expect(t.gm.getByText('派生公式', { exact: false })).toHaveCount(0);
  await t.gm.getByRole('button', { name: '设置血条', exact: true }).click();
  await t.gm.getByRole('button', { name: '一键添加生命血条（默认 20 / 20）', exact: true }).click();
  await expect(t.gm.locator('.health-bar-settings [role=status]')).toContainText('血条已设置');
  let state = await snapshot(t.gmContext, t.room.id);
  const hp = state.room.sheetSchema.find(
    (field: any) => field.isResource && field.resourceKind !== 'shield' && field.maxFieldId,
  );
  expect(hp).toBeDefined();
  await denied(t.aContext, t.room.id, 'sheet.health.configure', { version: state.room.version, create: true });
  await closeWindow(t.gm, '关闭字段管理');
  await openCharacter(t.a, '角色甲');
  const life = t.a.locator('.grid-card').filter({ hasText: '当前生命' });
  await expect(t.a.getByLabel('当前生命原始值')).toHaveCount(0);
  await expect(life.locator('strong.text-amber-300')).toHaveText('20');
  await expect(t.a.locator('.grid-card').filter({ has: t.a.getByText('生命上限', { exact: true }) })).toHaveCount(0);
  const hero = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
  await denied(t.aContext, t.room.id, 'character.field.set', {
    characterId: t.ca.id,
    fieldId: hp.fieldId,
    version: hero.version,
    value: 12,
  });
  await op(t.gmContext, t.room.id, 'character.field.set', {
    characterId: t.ca.id,
    fieldId: hp.fieldId,
    version: hero.version,
    value: 12,
  });
  await expect(life.locator('strong.text-amber-300')).toHaveText('12');
  await openCharacter(t.gm, '角色甲');
  await expect(t.gm.locator('.grid-card').filter({ has: t.gm.getByLabel('当前生命原始值') })).toContainText('12 / 20');
  await t.gm.getByRole('button', { name: '技能', exact: true }).click();
  await closeWindow(t.gm, '关闭人物卡');
  await t.gm.locator('.template-library').getByRole('button', { name: '新建', exact: true }).click();
  const editor = t.gm.locator('.template-editor');
  await expect(editor.getByText('被动数值修正', { exact: true })).toHaveCount(0);
  await editor.getByLabel('名称', { exact: true }).fill('鼓舞');
  await expect(editor.getByLabel('类型', { exact: true })).toHaveValue('SKILL');
  await editor.getByLabel('说明与使用建议', { exact: true }).fill('鼓舞同伴，由 GM 决定效果');
  await editor
    .getByLabel('上传能力图标')
    .setInputFiles({ name: 'skill.png', mimeType: 'image/png', buffer: await picture });
  await expect(editor.getByRole('img', { name: '能力图标预览' })).toBeVisible();
  await t.gm.screenshot({ path: '.launcher/ui-template-editor.png' });
  await editor.getByRole('button', { name: '保存模板', exact: true }).click();
  await expect(t.gm.locator('.ability-list-card')).toContainText('鼓舞');
  state = await snapshot(t.gmContext, t.room.id);
  expect(state.templates[0].iconUrl).toContain('/uploads/');
  expect(state.templates[0].data).toEqual({});
  await closeWindow(t.gm, '关闭能力模板库');
  await openCharacter(t.gm, '角色甲');
  await t.gm.getByRole('button', { name: '管理标签', exact: true }).click();
  await closeWindow(t.gm, '关闭人物卡');
  const manager = t.gm.locator('.tag-manager');
  for (const name of ['受伤', '被追踪']) {
    await manager.getByRole('button', { name: '添加标签', exact: true }).click();
    await expect(manager.getByRole('heading', { name: '新建标签定义', exact: true })).toBeVisible();
    await expect(manager.getByLabel('搜索标签库定义')).toHaveCount(0);
    if (name === '被追踪') await expect(manager.locator('.attached-tag-list')).toContainText('受伤');
    await manager.getByLabel('标签名称', { exact: true }).fill(name);
    await manager.getByRole('button', { name: '保存标签定义', exact: true }).click();
    await manager.getByRole('button', { name: '添加到此角色', exact: true }).click();
    await expect(manager.locator('.attached-tag-list')).toContainText(name);
  }
  await expect(manager.locator('.attached-tag-list article')).toHaveCount(2);
  await manager.getByRole('button', { name: '添加标签', exact: true }).click();
  await expect(manager.locator('.attached-tag-list article')).toHaveCount(2);
  await manager.getByRole('button', { name: '取消', exact: true }).click();
  await t.gm.reload();
  await openCharacter(t.gm, '角色甲');
  await t.gm.getByRole('button', { name: '管理标签', exact: true }).click();
  await expect(t.gm.locator('.attached-tag-list article')).toHaveCount(2);
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await expect(t.a.locator('.grid-card').filter({ hasText: '当前生命' }).locator('strong.text-amber-300')).toHaveText(
    '12',
  );
});

test('遭遇由 GM 手动指定行动顺序和轮次，时间线显示操作账号并保留私密记录', async ({ table: t }) => {
  test.setTimeout(120_000);
  const npc = await op(t.gmContext, t.room.id, 'character.create', { name: '守卫', isNpc: true });
  await op(t.gmContext, t.room.id, 'combat.start', { characterIds: [t.cb.id, npc.id, t.ca.id] });
  for (const page of [t.gm, t.a, t.b])
    await page.locator('.game-rail').getByRole('button', { name: '战斗', exact: true }).click();
  const panel = t.gm.locator('.combat-control');
  await expect(panel.getByText('先攻', { exact: true })).toHaveCount(0);
  await expect(panel.locator('.combat-participant strong')).toHaveText(['角色乙', '守卫', '角色甲']);
  await panel.getByRole('button', { name: '让角色甲行动', exact: true }).click();
  await expect(t.a.locator('.combat-control')).toContainText('当前行动：角色甲');
  let state = await snapshot(t.gmContext, t.room.id);
  const version = state.encounter.version;
  await denied(t.aContext, t.room.id, 'combat.focus', { characterId: t.ca.id, version });
  await denied(t.bContext, t.room.id, 'combat.order', { characterIds: [t.ca.id, npc.id, t.cb.id], version });
  await panel.getByRole('button', { name: '上移角色甲', exact: true }).click();
  await expect(panel.locator('.combat-participant strong')).toHaveText(['角色乙', '角色甲', '守卫']);
  await expect(panel).toContainText('当前行动：角色甲');
  const stale = await t.gmContext.request.post(`${api}/rooms/${t.room.id}/operations`, {
    data: { id: randomUUID(), type: 'combat.focus', payload: { characterId: t.cb.id, version } },
  });
  expect(stale.status()).toBe(409);
  await panel.getByLabel('轮次', { exact: true }).fill('5');
  await panel.getByRole('button', { name: '设置轮次', exact: true }).click();
  await expect(t.b.locator('.combat-control')).toContainText('第 5 轮');
  await t.a.getByLabel('行动或裁定内容').fill('举起盾牌保护同伴');
  await t.a.getByRole('button', { name: '保存记录', exact: true }).click();
  const event = t.gm.locator('.combat-event').filter({ hasText: '举起盾牌保护同伴' });
  await expect(event).toContainText(`记录者：${t.users[1].username}`);
  await expect(event).toContainText('行动角色：角色甲');
  state = await snapshot(t.gmContext, t.room.id);
  const record = state.combatEvents.find((e: any) => e.data.note === '举起盾牌保护同伴');
  expect(record.user).toEqual({ id: t.users[1].id, username: t.users[1].username });
  expect(state.characters.find((c: any) => c.id === t.ca.id).fieldValues).toEqual({});
  await op(t.gmContext, t.room.id, 'combat.record', { kind: 'NOTE', note: 'GM 私密判断', visibility: 'PRIVATE' });
  expect((await snapshot(t.aContext, t.room.id)).combatEvents.some((e: any) => e.data.note === 'GM 私密判断')).toBe(
    false,
  );
  await op(t.gmContext, t.room.id, 'combat.remove', { characterId: t.ca.id, version: state.encounter.version });
  await expect(panel).toContainText('当前行动：守卫');
  await panel.getByRole('button', { name: '下一位', exact: true }).click();
  await expect(panel).toContainText('第 6 轮');
  await t.gm.reload();
  await t.gm.locator('.game-rail').getByRole('button', { name: '战斗', exact: true }).click();
  await expect(t.gm.locator('.combat-control .combat-participant strong')).toHaveText(['角色乙', '守卫']);
  await expect(t.gm.locator('.combat-event').filter({ hasText: '举起盾牌保护同伴' })).toContainText(
    t.users[1].username,
  );
});

test('侧边栏功能可重复点击关闭，最小化恢复且草稿保护继续有效', async ({ table: t }) => {
  for (const page of [t.gm, t.a]) {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const buttons = page.locator('.game-rail .rail-action[aria-pressed]');
    for (let index = 0; index < (await buttons.count()); index++) {
      const button = buttons.nth(index);
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('.window:visible')).toHaveCount(1);
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'false');
      await expect(page.locator('.window')).toHaveCount(0);
    }
    const rail = page.locator('.game-rail'),
      dice = rail.getByRole('button', { name: '骰子', exact: true }),
      characters = rail.getByRole('button', { name: '角色', exact: true });
    await dice.click();
    await page.locator('.quick-bar').getByRole('button', { name: '掷骰', exact: true }).click();
    await expect(page.locator('.window:visible')).toHaveCount(1);
    await characters.click();
    await page.getByRole('button', { name: '角色甲', exact: true }).click();
    await characters.click();
    await expect(page.locator('.character-sheet')).toBeVisible();
    await expect(dice).toHaveAttribute('aria-pressed', 'true');
    await closeWindow(page, '关闭人物卡');
    await page.getByRole('button', { name: '最小化骰子', exact: true }).click();
    await expect(dice).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.window:visible')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '骰子', exact: true })).toHaveCount(1);
    await dice.click();
    await expect(dice).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.window:visible')).toHaveCount(1);
    await expect(page.locator('.window')).toHaveCount(1);
    await dice.click();
    await expect(page.locator('.window')).toHaveCount(0);
  }
  const tags = t.gm.locator('.game-rail').getByRole('button', { name: '标签', exact: true });
  await tags.click();
  await t.gm.getByRole('button', { name: '新建标签定义', exact: true }).click();
  await t.gm.getByLabel('标签名称', { exact: true }).fill('未保存的标签草稿');
  t.gm.once('dialog', (dialog) => dialog.dismiss());
  await tags.click();
  await expect(tags).toHaveAttribute('aria-pressed', 'true');
  await expect(t.gm.getByLabel('标签名称', { exact: true })).toHaveValue('未保存的标签草稿');
  t.gm.once('dialog', (dialog) => dialog.accept());
  await tags.click();
  await expect(tags).toHaveAttribute('aria-pressed', 'false');
  await expect(t.gm.locator('.window')).toHaveCount(0);
  await tags.click();
  await expect(t.gm.locator('.tag-library')).toBeVisible();
});

test('地图人物仅 GM 可复制与隐藏，副本独立且原人物保留', async ({ table: t }) => {
  const map = await op(t.gmContext, t.room.id, 'map.create', { name: '棋子权限场景', width: 1400, height: 900 });
  await op(t.gmContext, t.room.id, 'map.activate', { id: map.id });
  const token = await op(t.aContext, t.room.id, 'token.create', {
    mapId: map.id,
    characterId: t.ca.id,
    x: 650,
    y: 420,
  });
  async function center(page: Page, id: string) {
    await expect
      .poll(() => page.evaluate((id) => Boolean((window as any).Konva?.stages[0]?.findOne('#' + id)), id))
      .toBe(true);
    return page.evaluate((id) => {
      const stage = (window as any).Konva.stages[0],
        point = stage.findOne('#' + id).getAbsolutePosition(),
        rect = stage.container().getBoundingClientRect();
      return { x: point.x + rect.left, y: point.y + rect.top };
    }, id);
  }
  async function menu(page: Page, id = token.id) {
    const point = await center(page, id);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await expect(page.getByRole('group', { name: '棋子操作' })).toBeVisible();
  }
  for (const [context, page] of [
    [t.aContext, t.a],
    [t.bContext, t.b],
  ] as const) {
    await menu(page);
    await expect(page.getByRole('button', { name: '查看人物卡', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '查看角色标签', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '复制当前人物', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '不显示当前人物', exact: true })).toHaveCount(0);
    await denied(context, t.room.id, 'token.copy', { id: token.id });
    await denied(context, t.room.id, 'token.delete', { id: token.id });
  }
  await denied(t.aContext, t.room.id, 'token.create', { mapId: map.id, characterId: t.ca.id, x: 700, y: 460 });
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[2].id}/permissions`, { editAllCharacters: true });
  await menu(t.b);
  await expect(t.b.getByRole('button', { name: '复制当前人物', exact: true })).toHaveCount(0);
  await expect(t.b.getByRole('button', { name: '不显示当前人物', exact: true })).toHaveCount(0);
  await denied(t.bContext, t.room.id, 'token.copy', { id: token.id });
  await denied(t.bContext, t.room.id, 'token.delete', { id: token.id });
  await denied(t.bContext, t.room.id, 'token.create', { mapId: map.id, characterId: t.ca.id, x: 700, y: 460 });
  expect((await snapshot(t.gmContext, t.room.id)).tokens).toHaveLength(1);
  await t.a.mouse.click(200, 500);
  const start = await center(t.a, token.id);
  await t.a.mouse.move(start.x, start.y);
  await t.a.mouse.down();
  await t.a.mouse.move(start.x + 50, start.y + 20, { steps: 8 });
  await t.a.mouse.up();
  await expect
    .poll(
      async () => (await snapshot(t.aContext, t.room.id)).tokens.find((entry: any) => entry.id === token.id).version,
    )
    .toBe(1);
  const item = await op(t.gmContext, t.room.id, 'item.create', { name: '副本戒指', kind: '饰品' });
  const sourceEntry = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: t.ca.id,
    itemId: item.id,
    quantity: 2,
  });
  await op(t.gmContext, t.room.id, 'equipment.set', { characterId: t.ca.id, slot: '饰品1', entryId: sourceEntry.id });
  await menu(t.gm);
  await t.gm.getByRole('button', { name: '复制当前人物', exact: true }).click();
  await expect.poll(async () => (await snapshot(t.aContext, t.room.id)).tokens.length).toBe(2);
  const state = await snapshot(t.gmContext, t.room.id),
    original = state.tokens.find((entry: any) => entry.id === token.id),
    copy = state.tokens.find((entry: any) => entry.id !== token.id);
  expect(copy.characterId).not.toBe(original.characterId);
  expect(state.characters.find((c: any) => c.id === copy.characterId).name).toBe('角色甲 副本');
  expect(copy.x).toBe(original.x + 35);
  expect(copy.y).toBe(original.y + 35);
  const cloned = state.characters.find((c: any) => c.id === copy.characterId);
  expect(cloned.inventory).toHaveLength(1);
  expect(cloned.inventory[0].id).not.toBe(sourceEntry.id);
  expect(cloned.inventory[0].quantity).toBe(2);
  expect(cloned.equipment[0].entryId).toBe(cloned.inventory[0].id);
  await op(t.gmContext, t.room.id, 'inventory.instance.update', {
    id: cloned.inventory[0].id,
    version: cloned.inventory[0].version,
    data: { description: '副本的独立备注' },
  });
  expect(
    (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id).inventory[0].data
      .description,
  ).toBeUndefined();
  await menu(t.gm, copy.id);
  await t.gm.getByRole('button', { name: '不显示当前人物', exact: true }).click();
  await expect.poll(async () => (await snapshot(t.aContext, t.room.id)).tokens.length).toBe(1);
  expect((await snapshot(t.aContext, t.room.id)).characters.some((entry: any) => entry.id === t.ca.id)).toBe(true);
  const hidden = await op(t.gmContext, t.room.id, 'token.create', {
    mapId: map.id,
    characterId: t.ca.id,
    x: 300,
    y: 420,
    visibility: 'GM',
  });
  const hiddenCopy = await op(t.gmContext, t.room.id, 'token.copy', { id: hidden.id });
  expect(hiddenCopy.visibility).toBe('GM');
  expect((await snapshot(t.aContext, t.room.id)).tokens.map((entry: any) => entry.id)).toEqual([token.id]);
});

test('自定义与旧人物卡均可上传头像，玩家只能改有控制权的角色，复制头像独立持久化', async ({ table: t }) => {
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[1].id}/permissions`, { characterBasics: true });
  await openCharacter(t.a, '角色甲');
  const file = { name: 'avatar.png', mimeType: 'image/png', buffer: await picture };
  await t.a.getByLabel('上传角色头像').setInputFiles(file);
  await expect
    .poll(
      async () => (await snapshot(t.aContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id).avatarUrl || '',
    )
    .toContain('/characters/');
  const current = (await snapshot(t.aContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
  const url = current.avatarUrl;
  expect((await t.bContext.request.get(apiBase + url)).status()).toBe(200);
  expect((await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id).avatarUrl).toBe(url);
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await expect(t.a.getByRole('img', { name: '角色甲头像' })).toHaveAttribute('src', url);
  const forbidden = await t.bContext.request.post(`${api}/rooms/${t.room.id}/characters/${t.ca.id}/avatar`, {
    multipart: { version: String(current.version), file },
  });
  expect(forbidden.status()).toBe(403);
  const stale = await t.aContext.request.post(`${api}/rooms/${t.room.id}/characters/${t.ca.id}/avatar`, {
    multipart: { version: String(current.version - 1), file },
  });
  expect(stale.status()).toBe(409);
  await t.a.getByLabel('上传角色头像').setInputFiles({ ...file, buffer: Buffer.from('not an image') });
  await expect(t.a.locator('.character-portrait [role=alert]')).toBeVisible();
  expect((await snapshot(t.aContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id).avatarUrl).toBe(url);
  const copied = await op(t.gmContext, t.room.id, 'character.copy', { id: t.ca.id });
  expect(copied.avatarUrl).not.toBe(url);
  expect((await t.bContext.request.get(apiBase + copied.avatarUrl)).status()).toBe(200);
  await t.db.room.update({ where: { id: t.room.id }, data: { sheetMode: false } });
  await t.a.reload();
  await openCharacter(t.a, '角色甲');
  await t.a.getByLabel('上传角色头像').setInputFiles(file);
  await expect
    .poll(async () => (await snapshot(t.aContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id).avatarUrl)
    .not.toBe(url);
  expect((await t.bContext.request.get(apiBase + copied.avatarUrl)).status()).toBe(200);
});

test('NPC 始终由 GM 控制，授权其他人物卡与查看物品独立，授权撤回即时同步', async ({ table: t }) => {
  test.setTimeout(120_000);
  const item = await op(t.gmContext, t.room.id, 'item.create', { name: '角色甲的秘藏剑', kind: '装备' });
  const entry = await op(t.gmContext, t.room.id, 'inventory.add', {
    characterId: t.ca.id,
    itemId: item.id,
    quantity: 2,
  });
  await op(t.gmContext, t.room.id, 'inventory.add', { characterId: t.cb.id, itemId: item.id, quantity: 1 });
  let state = await snapshot(t.gmContext, t.room.id);
  await op(t.gmContext, t.room.id, 'equipment.set', {
    characterId: t.ca.id,
    slot: state.room.equipmentSlots[0],
    entryId: entry.id,
  });
  await op(t.gmContext, t.room.id, 'sheet.field.upsert', {
    version: state.room.version,
    field: {
      fieldId: 'owner_value',
      name: '自管数值',
      type: 'number',
      defaultValue: 10,
      visibility: 'OWNER',
      editableBy: 'OWNER',
    },
  });
  await denied(t.bContext, t.room.id, 'character.update', { id: t.ca.id, patch: { description: '越权修改' } });
  await openCharacter(t.b, '角色甲');
  await expect(t.b.getByRole('textbox', { name: '角色名称' })).toBeDisabled();
  await openCharacter(t.a, '角色甲');
  await expect(t.b.locator('.character-sheet').getByRole('button', { name: '背包', exact: true })).toHaveCount(0);
  state = await snapshot(t.bContext, t.room.id);
  const other = state.characters.find((c: any) => c.id === t.ca.id);
  expect(other.inventory).toEqual([]);
  expect(other.equipment).toEqual([]);
  expect(other.inventoryVisible).toBe(false);
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[2].id}/permissions`, {
    editAllCharacters: true,
    characterBasics: true,
    characterValues: true,
    viewOtherInventories: false,
  });
  await expect(t.b.getByRole('textbox', { name: '角色名称' })).toBeEnabled();
  await expect(t.b.getByLabel('自管数值原始值')).toHaveCount(0);
  await expect(t.b.getByRole('textbox', { name: '角色描述' })).toBeDisabled();
  await denied(t.bContext, t.room.id, 'character.update', { id: t.ca.id, patch: { description: '授权也不能改故事' } });
  const editableHero = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id);
  await denied(t.bContext, t.room.id, 'character.field.set', {
    characterId: t.ca.id,
    fieldId: 'owner_value',
    version: editableHero.version,
    value: 15,
  });
  await op(t.gmContext, t.room.id, 'character.field.set', {
    characterId: t.ca.id,
    fieldId: 'owner_value',
    version: editableHero.version,
    value: 15,
  });
  await expect
    .poll(
      async () =>
        (await snapshot(t.aContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id).derived.values
          .owner_value,
    )
    .toBe(15);
  await denied(t.bContext, t.room.id, 'inventory.update', { id: entry.id, version: entry.version, quantity: 3 });
  await t.gm.locator('.game-rail').getByRole('button', { name: '设置', exact: true }).click();
  await t.gm.getByRole('checkbox', { name: '查看其他角色的背包与装备', exact: true }).check();
  await t.gm.getByRole('button', { name: '保存权限模式', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await snapshot(t.aContext, t.room.id)).characters.find((c: any) => c.id === t.cb.id).inventory.length,
    )
    .toBe(1);
  expect((await snapshot(t.bContext, t.room.id)).characters.find((c: any) => c.id === t.ca.id).inventory).toEqual([]);
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[2].id}/permissions`, {
    editAllCharacters: true,
    characterBasics: true,
    characterValues: true,
    viewOtherInventories: true,
  });
  await expect(t.b.locator('.character-sheet').getByRole('button', { name: '背包', exact: true })).toBeVisible();
  await t.b.locator('.character-sheet').getByRole('button', { name: '背包', exact: true }).click();
  await expect(t.b.locator('.inventory-slot.filled')).toHaveCount(1);
  await closeWindow(t.gm, '关闭房间设置');
  await t.gm.locator('.game-rail').getByRole('button', { name: '角色', exact: true }).click();
  await t.gm.getByRole('tab', { name: /^NPC/ }).click();
  await t.gm.getByLabel('新 NPC 名称').fill('酒馆老板');
  await t.gm.getByRole('button', { name: '创建 NPC', exact: true }).click();
  await expect(t.gm.getByRole('button', { name: '酒馆老板', exact: true })).toBeVisible();
  const npc = (await snapshot(t.gmContext, t.room.id)).characters.find((c: any) => c.name === '酒馆老板');
  expect(npc.isNpc).toBe(true);
  expect(npc.ownerId).toBeNull();
  await denied(t.bContext, t.room.id, 'character.update', { id: npc.id, patch: { description: '控制 NPC' } });
  await denied(t.bContext, t.room.id, 'dice.roll', { characterId: npc.id, expression: '1d20' });
  await denied(t.bContext, t.room.id, 'inventory.add', { characterId: npc.id, itemId: item.id });
  await denied(t.bContext, t.room.id, 'character.create', { name: '玩家创建的 NPC', isNpc: true });
  const hidden = await op(t.gmContext, t.room.id, 'character.create', {
    name: '隐藏 NPC',
    isNpc: true,
    visibility: 'GM',
  });
  const upload = await t.gmContext.request.post(`${api}/rooms/${t.room.id}/characters/${hidden.id}/avatar`, {
    multipart: {
      version: String(hidden.version),
      file: { name: 'npc.png', mimeType: 'image/png', buffer: await picture },
    },
  });
  expect(upload.status()).toBe(200);
  const avatar = await upload.json();
  expect((await t.aContext.request.get(apiBase + avatar.avatarUrl)).status()).toBe(403);
  const changed = await op(t.gmContext, t.room.id, 'character.update', {
    id: hidden.id,
    version: avatar.version,
    patch: { visibility: 'PUBLIC' },
  });
  expect((await t.aContext.request.get(apiBase + avatar.avatarUrl)).status()).toBe(200);
  await op(t.gmContext, t.room.id, 'character.update', {
    id: hidden.id,
    version: changed.version,
    patch: { visibility: 'GM' },
  });
  expect((await t.aContext.request.get(apiBase + avatar.avatarUrl)).status()).toBe(403);
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[2].id}/permissions`, {
    editAllCharacters: false,
    viewOtherInventories: false,
  });
  await expect(t.b.getByRole('textbox', { name: '角色名称' })).toBeDisabled();
  await expect(t.b.getByText('GM 已隐藏该角色的背包和装备。', { exact: true })).toBeVisible();
});

test('物品创建支持键盘提交和失败重试，旧授权不再向玩家开放物品库', async ({ table: t }) => {
  await t.gm.locator('.game-rail').getByRole('button', { name: '物品', exact: true }).click();
  let failOnce = true;
  await t.gm.route(`**/api/rooms/${t.room.id}/operations`, async (route) => {
    if (failOnce && route.request().postDataJSON().type === 'item.create') {
      failOnce = false;
      await route.fulfill({ status: 503, json: { error: '测试：物品创建暂时失败' } });
    } else await route.continue();
  });
  await t.gm.getByLabel('物品名称', { exact: true }).fill('星辉长剑');
  await t.gm.getByLabel('物品名称', { exact: true }).press('Enter');
  await expect(t.gm.getByRole('alert')).toHaveText('测试：物品创建暂时失败');
  await expect(t.gm.getByLabel('物品名称', { exact: true })).toHaveValue('星辉长剑');
  expect((await snapshot(t.gmContext, t.room.id)).items).toHaveLength(0);
  await t.gm.getByRole('button', { name: '创建物品', exact: true }).click();
  const editor = t.gm.locator('.window').filter({ has: t.gm.getByRole('button', { name: '保存物品卡', exact: true }) });
  await expect(editor.getByLabel('名称', { exact: true })).toHaveValue('星辉长剑');
  await expect(t.a.locator('.game-rail').getByRole('button', { name: '物品', exact: true })).toHaveCount(0);
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[1].id}/permissions`, { publicItems: true });
  await t.a.reload();
  await expect(t.a.getByRole('button', { name: '创建物品', exact: true })).toHaveCount(0);
  expect((await snapshot(t.aContext, t.room.id)).items).toHaveLength(0);
  await denied(t.aContext, t.room.id, 'item.create', { name: '玩家的药水' });
  await expect.poll(async () => (await snapshot(t.gmContext, t.room.id)).items.length).toBe(1);
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[1].id}/permissions`, {
    publicItems: false,
    editItems: true,
  });
  await expect(t.a.getByRole('button', { name: '创建物品', exact: true })).toHaveCount(0);
  await denied(t.aContext, t.room.id, 'item.create', { name: '被禁止的物品' });
});

test('画笔撤销重做包含整笔擦除，按人按地图隔离并保留多人最新状态', async ({ table: t }) => {
  test.setTimeout(120000);
  await t.gm.setViewportSize({ width: 1600, height: 1050 });
  const map = await op(t.gmContext, t.room.id, 'map.create', { name: '画笔历史地图', width: 1600, height: 1000 });
  await op(t.gmContext, t.room.id, 'map.activate', { id: map.id });
  const tools = t.gm.locator('.board-tools');
  const undo = tools.getByRole('button', { name: '撤销', exact: true });
  const redo = tools.getByRole('button', { name: '重做', exact: true });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  const response = (type: string) =>
    t.gm.waitForResponse((r) => r.url().endsWith('/operations') && r.request().postDataJSON().type === type);
  async function accepted(pending: ReturnType<typeof response>) {
    const result = await pending;
    expect(result.ok(), await result.text()).toBe(true);
    return result.json();
  }
  async function click(direction: 'undo' | 'redo') {
    const saved = response(`drawing.history.${direction}`);
    await (direction === 'undo' ? undo : redo).click();
    return accepted(saved);
  }
  const saved = (id: string) => t.db.drawingOperation.findUniqueOrThrow({ where: { id } });
  const visible = (page: Page, id: string) =>
    page.evaluate(
      (id) =>
        (window as any).Konva?.stages
          .find((s: any) => s.container().isConnected)
          ?.findOne('#' + id)
          ?.visible() || false,
      id,
    );
  const stroke = (context: BrowserContext, mapId: string, y: number) =>
    op(context, t.room.id, 'drawing.add', {
      mapId,
      kind: 'STROKE',
      data: { points: [300, y, 500, y], color: '#f3c268', width: 4 },
    });
  await expect.poll(() => t.gm.evaluate(() => (window as any).Konva?.stages[0]?.find('Rect').length > 0)).toBe(true);
  await tools.getByRole('button', { name: '画笔', exact: true }).click();
  await closeWindow(t.gm, '关闭绘画与量尺');
  const firstResponse = response('drawing.add');
  const from = await t.gm.evaluate(() => {
    const stage = (window as any).Konva.stages.find((s: any) => s.container().isConnected);
    const p = stage.getAbsoluteTransform().point({ x: 350, y: 300 }),
      b = stage.container().getBoundingClientRect();
    return { x: p.x + b.left, y: p.y + b.top };
  });
  await t.gm.mouse.move(from.x, from.y);
  await t.gm.mouse.down();
  await t.gm.mouse.move(from.x + 200, from.y + 30, { steps: 8 });
  await t.gm.mouse.up();
  const first = await accepted(firstResponse);
  const second = await stroke(t.gmContext, map.id, 450);
  await expect(undo).toBeEnabled();
  expect((await click('undo')).changed).toBe(1);
  expect((await saved(second.id)).undone).toBe(true);
  expect((await saved(first.id)).undone).toBe(false);
  await click('undo');
  for (const page of [t.gm, t.a, t.b]) await expect.poll(() => visible(page, first.id)).toBe(false);
  await expect(undo).toBeDisabled();
  await click('redo');
  expect((await saved(first.id)).undone).toBe(false);
  expect((await saved(second.id)).undone).toBe(true);
  await click('redo');
  for (const page of [t.gm, t.a, t.b]) await expect.poll(() => visible(page, second.id)).toBe(true);
  expect((await saved(first.id)).data).toEqual(first.data);
  await expect(redo).toBeDisabled();
  await op(t.gmContext, t.room.id, 'drawing.erase', { mapId: map.id, ids: [first.id, second.id] });
  expect((await click('undo')).changed).toBe(2);
  for (const page of [t.gm, t.a, t.b]) await expect.poll(() => visible(page, first.id)).toBe(true);
  expect((await click('redo')).changed).toBe(2);
  await click('undo');
  const branch = await stroke(t.gmContext, map.id, 550);
  await expect(redo).toBeDisabled();
  expect((await op(t.gmContext, t.room.id, 'drawing.history.redo', { mapId: map.id })).changed).toBe(0);
  await denied(t.aContext, t.room.id, 'drawing.history.undo', { mapId: map.id });
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[1].id}/permissions`, { draw: true });
  const other = await stroke(t.aContext, map.id, 650);
  await click('undo');
  expect((await saved(branch.id)).undone).toBe(true);
  expect((await saved(other.id)).undone).toBe(false);
  await op(t.aContext, t.room.id, 'drawing.history.undo', { mapId: map.id });
  expect((await saved(other.id)).undone).toBe(true);
  await op(t.aContext, t.room.id, 'drawing.history.redo', { mapId: map.id });
  // Both UI locations use the same authoritative history; a failed request is retryable.
  await t.gm.locator('.game-rail').getByRole('button', { name: '画笔', exact: true }).click();
  const panel = t.gm
    .locator('.window')
    .filter({ has: t.gm.getByRole('button', { name: '关闭绘画与量尺', exact: true }) });
  await expect(panel.getByRole('button', { name: '重做', exact: true })).toBeEnabled();
  await closeWindow(t.gm, '关闭绘画与量尺');
  await t.gm.route('**/operations', async (route) => {
    if (route.request().postDataJSON().type === 'drawing.history.redo')
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: '重做失败测试' }),
      });
    else await route.continue();
  });
  await redo.click();
  await expect(t.gm.locator('.toast')).toContainText('重做失败测试');
  await expect(redo).toBeEnabled();
  expect((await saved(branch.id)).undone).toBe(true);
  await t.gm.unroute('**/operations');
  await click('redo');
  const map2 = await op(t.gmContext, t.room.id, 'map.create', { name: '另一张历史地图' });
  await op(t.gmContext, t.room.id, 'map.activate', { id: map2.id });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();
  const map2Stroke = await stroke(t.gmContext, map2.id, 300);
  await click('undo');
  expect((await saved(map2Stroke.id)).undone).toBe(true);
  expect((await saved(branch.id)).undone).toBe(false);
  await t.gm.reload();
  await expect(redo).toBeEnabled();
  await click('redo');
  expect((await saved(map2Stroke.id)).undone).toBe(false);
  await click('undo');
  await op(t.gmContext, t.room.id, 'map.activate', { id: map.id });
  await t.gm.reload();
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
  await expect.poll(() => visible(t.gm, branch.id)).toBe(true);
  const contested = await stroke(t.gmContext, map.id, 750);
  await op(t.aContext, t.room.id, 'drawing.erase', { mapId: map.id, ids: [contested.id] });
  const skipped = await click('undo');
  expect(skipped).toMatchObject({ changed: 0, skipped: 1 });
  expect((await saved(contested.id)).undone).toBe(true);
  await expect(tools.getByRole('status')).toContainText('已保留其最新状态');
  // Idempotent delivery cannot undo a second operation.
  const requestId = randomUUID();
  const payload = { id: requestId, type: 'drawing.history.undo', payload: { mapId: map.id } };
  const one = await post(t.gmContext, `/rooms/${t.room.id}/operations`, payload);
  const two = await post(t.gmContext, `/rooms/${t.room.id}/operations`, payload);
  expect(two).toEqual(one);
  expect((await saved(branch.id)).undone).toBe(true);
  expect((await saved(second.id)).undone).toBe(false);
  const privateMap = await op(t.gmContext, t.room.id, 'map.create', { name: '私密历史', visibility: 'GM' });
  await denied(t.aContext, t.room.id, 'drawing.history.undo', { mapId: privateMap.id });
  expect((await snapshot(t.aContext, t.room.id)).drawingHistory.some((h: any) => h.mapId === privateMap.id)).toBe(
    false,
  );
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[1].id}/permissions`, { draw: false });
  await denied(t.aContext, t.room.id, 'drawing.history.redo', { mapId: map.id });
});

test('旧画笔遮罩与量尺兼容，批量撤销重做不会覆盖其他玩家后续擦除', async ({ table: t }) => {
  const map = await op(t.gmContext, t.room.id, 'map.create', { name: '旧画笔与多人历史' });
  const data = { points: [20, 20, 100, 100], color: '#f3c268', width: 4 };
  const legacy = await t.db.drawingOperation.create({
    data: { roomId: t.room.id, mapId: map.id, authorId: t.users[0].id, kind: 'STROKE', data },
  });
  const mask = await t.db.drawingOperation.create({
    data: { roomId: t.room.id, mapId: map.id, authorId: t.users[0].id, kind: 'ERASER', data },
  });
  const ruler = await op(t.gmContext, t.room.id, 'drawing.add', {
    mapId: map.id,
    kind: 'RULER',
    data: { shape: 'LINE', distance: 5, x: 10, y: 10 },
  });
  const undo = () => op(t.gmContext, t.room.id, 'drawing.history.undo', { mapId: map.id });
  const redo = () => op(t.gmContext, t.room.id, 'drawing.history.redo', { mapId: map.id });
  const erased = async (id: string) => (await t.db.drawingOperation.findUniqueOrThrow({ where: { id } })).undone;
  await undo();
  expect(await erased(mask.id)).toBe(true);
  await undo();
  expect(await erased(legacy.id)).toBe(true);
  await redo();
  expect(await erased(legacy.id)).toBe(false);
  expect(await erased(mask.id)).toBe(true);
  await redo();
  expect(await erased(mask.id)).toBe(false);
  expect(await erased(ruler.id)).toBe(false);
  const second = await op(t.gmContext, t.room.id, 'drawing.add', { mapId: map.id, kind: 'STROKE', data });
  await op(t.gmContext, t.room.id, 'drawing.undo', { id: second.id });
  await undo();
  expect(await erased(second.id)).toBe(false);
  await op(t.gmContext, t.room.id, 'drawing.erase', { mapId: map.id, ids: [legacy.id, second.id] });
  await undo();
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[1].id}/permissions`, { draw: true });
  await op(t.aContext, t.room.id, 'drawing.erase', { mapId: map.id, ids: [legacy.id] });
  expect(await redo()).toMatchObject({ changed: 1, skipped: 1 });
  expect(await erased(legacy.id)).toBe(true);
  expect(await erased(second.id)).toBe(true);
  await undo();
  expect(await erased(legacy.id)).toBe(true);
  expect(await erased(second.id)).toBe(false);
  expect((await t.db.drawingOperation.findUniqueOrThrow({ where: { id: legacy.id } })).data).toEqual(data);
  // The same receipt submitted concurrently is still one history replay.
  const payload = { id: randomUUID(), type: 'drawing.history.redo', payload: { mapId: map.id } };
  const responses = await Promise.all([
    post(t.gmContext, `/rooms/${t.room.id}/operations`, payload),
    post(t.gmContext, `/rooms/${t.room.id}/operations`, payload),
  ]);
  expect(responses[0]).toEqual(responses[1]);
  expect(await erased(second.id)).toBe(true);
  expect(await erased(ruler.id)).toBe(false);
});

test('橡皮按完整笔画擦除，拖过多笔、缩放平移、失败取消和多人权限持久化正常', async ({ table: t }) => {
  test.setTimeout(120000);
  for (const page of [t.gm, t.a, t.b]) await page.setViewportSize({ width: 1600, height: 1050 });
  const map = await op(t.gmContext, t.room.id, 'map.create', { name: '整笔擦除地图', width: 1600, height: 1000 });
  await op(t.gmContext, t.room.id, 'map.activate', { id: map.id });
  const point = (page: Page, x: number, y: number) =>
    page.evaluate(
      ({ x, y }) => {
        const stage = (window as any).Konva.stages.find((stage: any) => stage.container().isConnected);
        const p = stage.getAbsoluteTransform().point({ x, y }),
          bounds = stage.container().getBoundingClientRect();
        return { x: p.x + bounds.left, y: p.y + bounds.top };
      },
      { x, y },
    );
  const visible = (page: Page, id: string) =>
    page.evaluate(
      (id) =>
        (window as any).Konva?.stages
          .find((s: any) => s.container().isConnected)
          ?.findOne('#' + id)
          ?.visible() || false,
      id,
    );
  const saved = (id: string) => t.db.drawingOperation.findUniqueOrThrow({ where: { id } });
  const operationResponse = (page: Page, type: string) =>
    page.waitForResponse(
      (response) => response.url().endsWith('/operations') && response.request().postDataJSON().type === type,
    );
  const accepted = async (response: Promise<import('@playwright/test').Response>) => {
    const result = await response;
    expect(result.ok(), await result.text()).toBe(true);
    return result.json();
  };
  await expect.poll(() => t.gm.evaluate(() => (window as any).Konva?.stages[0]?.find('Rect').length > 0)).toBe(true);
  // Real pen input: one mouse press/release creates one continuous stroke.
  await t.gm.locator('.board-tools').getByRole('button', { name: '画笔', exact: true }).click();
  await closeWindow(t.gm, '关闭绘画与量尺');
  const path = [
    [350, 300],
    [500, 250],
    [650, 300],
    [700, 400],
  ];
  let p = await point(t.gm, path[0][0], path[0][1]);
  await t.gm.mouse.move(p.x, p.y);
  await t.gm.mouse.down();
  for (const [x, y] of path.slice(1)) {
    p = await point(t.gm, x, y);
    await t.gm.mouse.move(p.x, p.y, { steps: 5 });
  }
  const drawingSaved = operationResponse(t.gm, 'drawing.add');
  await t.gm.mouse.up();
  const original = await accepted(drawingSaved);
  expect(await t.db.drawingOperation.count({ where: { roomId: t.room.id, kind: 'STROKE' } })).toBe(1);
  const stroke = (points: number[]) =>
    op(t.gmContext, t.room.id, 'drawing.add', {
      mapId: map.id,
      kind: 'STROKE',
      data: { points, color: '#f3c268', width: 4 },
    });
  const second = await stroke([900, 200, 900, 500]),
    third = await stroke([1100, 200, 1100, 500]),
    fourth = await stroke([350, 700, 650, 700]);
  const legacy = await op(t.gmContext, t.room.id, 'drawing.add', {
    mapId: map.id,
    kind: 'ERASER',
    data: { points: [1100, 900, 1200, 900], color: '#f3c268', width: 20 },
  });
  const ruler = await op(t.gmContext, t.room.id, 'drawing.add', {
    mapId: map.id,
    kind: 'RULER',
    data: { shape: 'LINE', distance: 5, x: 1200, y: 100 },
  });
  const token = await op(t.gmContext, t.room.id, 'token.create', {
    mapId: map.id,
    characterId: t.ca.id,
    x: 1300,
    y: 300,
  });
  await expect(t.a.locator('.board-tools').getByRole('button', { name: '擦除', exact: true })).toBeDisabled();
  await denied(t.aContext, t.room.id, 'drawing.erase', { mapId: map.id, ids: [original.id] });
  await t.gm.locator('.board-tools').getByRole('button', { name: '擦除', exact: true }).click();
  await expect(t.gm.locator('.board-tools [title="笔刷大小（0–100）"]')).toHaveCount(0);
  await expect.poll(() => visible(t.gm, original.id)).toBe(true);
  p = await point(t.gm, 700, 400);
  const firstErase = operationResponse(t.gm, 'drawing.erase');
  await t.gm.mouse.click(p.x, p.y);
  await accepted(firstErase);
  expect((await saved(original.id)).undone).toBe(true);
  expect((await saved(original.id)).data).toEqual(original.data);
  for (const page of [t.gm, t.a, t.b]) {
    await expect.poll(() => visible(page, original.id)).toBe(false);
    await expect.poll(() => visible(page, second.id)).toBe(true);
    await expect.poll(() => visible(page, fourth.id)).toBe(true);
  }
  await post(t.gmContext, `/rooms/${t.room.id}/members/${t.users[1].id}/permissions`, { draw: true });
  await expect(t.a.locator('.board-tools').getByRole('button', { name: '擦除', exact: true })).toBeEnabled();
  await t.a.locator('.board-tools').getByRole('button', { name: '擦除', exact: true }).click();
  p = await point(t.a, 800, 350);
  await t.a.mouse.move(p.x, p.y);
  await t.a.mouse.down();
  p = await point(t.a, 1200, 350);
  await t.a.mouse.move(p.x, p.y, { steps: 1 });
  const sweepErased = operationResponse(t.a, 'drawing.erase');
  await t.a.mouse.up();
  await accepted(sweepErased);
  for (const id of [second.id, third.id]) {
    await expect.poll(async () => (await saved(id)).undone).toBe(true);
    for (const page of [t.gm, t.a, t.b]) await expect.poll(() => visible(page, id)).toBe(false);
  }
  expect((await saved(fourth.id)).undone).toBe(false);
  expect(await t.db.drawingOperation.count({ where: { roomId: t.room.id, kind: 'ERASER' } })).toBe(1);
  expect((await saved(legacy.id)).undone).toBe(false);
  expect((await saved(ruler.id)).undone).toBe(false);
  // Zoom/pan, then refuse one erase to verify immediate preview rollback and a normal retry.
  await t.gm.locator('.board-tools').getByRole('button', { name: '平移', exact: true }).click();
  await t.gm.mouse.move(700, 600);
  await t.gm.mouse.wheel(0, -150);
  await t.gm.mouse.move(600, 800);
  await t.gm.mouse.down();
  await t.gm.mouse.move(630, 820, { steps: 4 });
  await t.gm.mouse.up();
  await t.gm.locator('.board-tools').getByRole('button', { name: '擦除', exact: true }).click();
  let refuse = true;
  await t.gm.route('**/operations', async (route) => {
    if (refuse && route.request().postDataJSON().type === 'drawing.erase') {
      refuse = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: '擦除失败测试' }),
      });
    } else await route.continue();
  });
  p = await point(t.gm, 500, 700);
  await t.gm.mouse.click(p.x, p.y);
  await expect(t.gm.locator('.toast')).toContainText('擦除失败测试');
  await expect.poll(() => visible(t.gm, fourth.id)).toBe(true);
  expect((await saved(fourth.id)).undone).toBe(false);
  const retried = operationResponse(t.gm, 'drawing.erase');
  await t.gm.mouse.click(p.x, p.y);
  await accepted(retried);
  expect((await saved(fourth.id)).undone).toBe(true);
  await t.gm.unroute('**/operations');
  const cancelStroke = await stroke([800, 650, 1100, 650]);
  await expect.poll(() => visible(t.gm, cancelStroke.id)).toBe(true);
  p = await point(t.gm, 900, 650);
  await t.gm.mouse.move(p.x, p.y);
  await t.gm.mouse.down();
  await expect.poll(() => visible(t.gm, cancelStroke.id)).toBe(false);
  await t.gm.keyboard.press('Escape');
  await t.gm.mouse.up();
  await expect.poll(() => visible(t.gm, cancelStroke.id)).toBe(true);
  expect((await saved(cancelStroke.id)).undone).toBe(false);
  // Rulers, legacy masks, other maps and mixed requests are not stroke eraser targets.
  const mixed = await t.gmContext.request.post(`${api}/rooms/${t.room.id}/operations`, {
    data: { id: randomUUID(), type: 'drawing.erase', payload: { mapId: map.id, ids: [cancelStroke.id, ruler.id] } },
  });
  expect(mixed.status()).toBe(400);
  expect((await saved(cancelStroke.id)).undone).toBe(false);
  const privateMap = await op(t.gmContext, t.room.id, 'map.create', { name: '私密擦除范围', visibility: 'GM' });
  const privateStroke = await op(t.gmContext, t.room.id, 'drawing.add', {
    mapId: privateMap.id,
    kind: 'STROKE',
    data: { points: [10, 10, 100, 100], color: '#f3c268', width: 4 },
  });
  await denied(t.aContext, t.room.id, 'drawing.erase', { mapId: privateMap.id, ids: [privateStroke.id] });
  const wrongMap = await t.gmContext.request.post(`${api}/rooms/${t.room.id}/operations`, {
    data: { id: randomUUID(), type: 'drawing.erase', payload: { mapId: map.id, ids: [privateStroke.id] } },
  });
  expect(wrongMap.status()).toBe(400);
  // Concurrent and repeated erases of the same stroke are harmless.
  await Promise.all([
    op(t.gmContext, t.room.id, 'drawing.erase', { mapId: map.id, ids: [cancelStroke.id] }),
    op(t.aContext, t.room.id, 'drawing.erase', { mapId: map.id, ids: [cancelStroke.id] }),
  ]);
  await op(t.aContext, t.room.id, 'drawing.erase', { mapId: map.id, ids: [cancelStroke.id] });
  expect((await saved(cancelStroke.id)).undone).toBe(true);
  expect(await t.db.mapToken.findUniqueOrThrow({ where: { id: token.id } })).toMatchObject({ x: 1300, y: 300 });
  expect((await saved(ruler.id)).undone).toBe(false);
  await t.b.reload();
  await expect(t.b.locator('.party-panel [title="已连接"]')).toBeVisible();
  await expect.poll(() => visible(t.b, original.id)).toBe(false);
  const after = await snapshot(t.bContext, t.room.id);
  expect(after.drawings.some((d: any) => d.kind === 'STROKE')).toBe(false);
  expect(after.drawings.find((d: any) => d.id === legacy.id)).toBeTruthy();
  expect(after.drawings.find((d: any) => d.id === ruler.id)).toBeTruthy();
});

test('量尺颜色与创建者、四种形状吸附置顶、双击删除及失败重试多人持久同步', async ({ table: t }) => {
  test.setTimeout(120_000);
  const pages = [t.gm, t.a, t.b];
  for (const page of pages) await page.setViewportSize({ width: 1600, height: 1050 });
  const map = await op(t.gmContext, t.room.id, 'map.create', { name: '量尺吸附删除测试', width: 1400, height: 900 });
  await op(t.gmContext, t.room.id, 'map.activate', { id: map.id });
  const token = await op(t.gmContext, t.room.id, 'token.create', {
    mapId: map.id,
    characterId: t.ca.id,
    x: 400,
    y: 400,
  });
  const target = await op(t.gmContext, t.room.id, 'token.create', {
    mapId: map.id,
    characterId: t.cb.id,
    x: 700,
    y: 400,
  });
  async function mapPoint(page: Page, x: number, y: number) {
    return page.evaluate(
      ({ x, y }) => {
        const stage = (window as any).Konva.stages[0],
          point = stage.getAbsoluteTransform().point({ x, y }),
          box = stage.container().getBoundingClientRect();
        return { x: point.x + box.left, y: point.y + box.top };
      },
      { x, y },
    );
  }
  async function nodePoint(page: Page, id: string, child?: string) {
    await expect
      .poll(() => page.evaluate((id) => Boolean((window as any).Konva?.stages[0]?.findOne('#' + id)), id))
      .toBe(true);
    return page.evaluate(
      ({ id, child }) => {
        const stage = (window as any).Konva.stages[0],
          group = stage.findOne('#' + id),
          node = child ? group.findOne(child) : group;
        const point = node.getAbsolutePosition(),
          box = stage.container().getBoundingClientRect();
        return { x: point.x + box.left, y: point.y + box.top };
      },
      { id, child },
    );
  }
  const controls = (page: Page, id: string) =>
    page.evaluate((id) => {
      const group = (window as any).Konva?.stages[0]?.findOne('#' + id);
      return {
        selection: group?.find('.ruler-selection-box').length || 0,
        remove: group?.find('.ruler-delete').length || 0,
      };
    }, id);
  const saved = (id: string) => t.db.drawingOperation.findUniqueOrThrow({ where: { id } });
  // Place a ruler by clicking near the actual avatar, rather than injecting its final coordinates.
  await expect
    .poll(() => t.a.evaluate((id) => Boolean((window as any).Konva?.stages[0]?.findOne('#' + id)), token.id))
    .toBe(true);
  await t.a.locator('.board-tools').getByRole('button', { name: '量尺', exact: true }).click();
  await t.a.getByLabel('量尺距离', { exact: true }).fill('10');
  const place = await mapPoint(t.a, 425, 400);
  await t.a.mouse.click(place.x, place.y);
  await expect.poll(async () => (await snapshot(t.gmContext, t.room.id)).drawings.length).toBe(1);
  const line = (await snapshot(t.gmContext, t.room.id)).drawings[0];
  expect(line.data.x).toBeCloseTo(428);
  expect(line.data.y).toBeCloseTo(400);
  expect(line.data.length).toBe(200);
  expect(line.data.authorName).toBe(t.users[1].username);
  const circle = await op(t.bContext, t.room.id, 'drawing.add', {
    mapId: map.id,
    kind: 'RULER',
    data: { shape: 'CIRCLE', distance: 5, x: 700, y: 550, color: line.data.color, authorName: '伪造姓名' },
  });
  expect(circle.data.color).not.toBe(line.data.color);
  expect(circle.data.authorName).toBe(t.users[2].username);
  const hover = await mapPoint(t.b, 475, 400);
  await t.b.mouse.move(hover.x, hover.y);
  await expect(t.b.getByRole('tooltip', { name: '量尺创建者', exact: true })).toContainText(t.users[1].username);
  await t.b.mouse.dblclick(hover.x, hover.y);
  expect(await controls(t.b, line.id)).toEqual({ selection: 0, remove: 0 });
  await denied(t.bContext, t.room.id, 'drawing.undo', { id: line.id });
  const square = await op(t.gmContext, t.room.id, 'drawing.add', {
    mapId: map.id,
    kind: 'RULER',
    data: { shape: 'SQUARE', distance: 5, x: 1000, y: 600 },
  });
  const cone = await op(t.gmContext, t.room.id, 'drawing.add', {
    mapId: map.id,
    kind: 'RULER',
    data: { shape: 'CONE', distance: 5, x: 1000, y: 300 },
  });
  expect(square.data.color).toBe(cone.data.color);
  expect(new Set([line.data.color, circle.data.color, square.data.color]).size).toBe(3);
  for (const drawing of [line, circle, square, cone]) {
    await t.gm.mouse.move(150, 200);
    await expect(t.gm.getByRole('tooltip', { name: '角色概览', exact: true })).toHaveCount(0);
    const start = await nodePoint(t.gm, drawing.id);
    const end = await mapPoint(t.gm, 734, 400);
    await t.gm.mouse.move(start.x, start.y);
    await t.gm.mouse.down();
    await t.gm.mouse.move(end.x, end.y, { steps: 8 });
    await t.gm.mouse.up();
    await expect.poll(async () => (await saved(drawing.id)).data).toMatchObject({ x: 728, y: 400 });
    expect((await saved(drawing.id)).data).toMatchObject({
      length: drawing.data.length,
      distance: drawing.data.distance,
      color: drawing.data.color,
      authorName: drawing.data.authorName,
    });
    for (const page of pages) {
      await expect
        .poll(() =>
          page.evaluate((id) => {
            const group = (window as any).Konva?.stages[0]?.findOne('#' + id);
            return group ? { x: group.x(), y: group.y() } : null;
          }, drawing.id),
        )
        .toEqual({ x: 728, y: 400 });
      const rendered = await page.evaluate(
        ({ id, targetId }) => {
          const stage = (window as any).Konva.stages[0],
            group = stage.findOne('#' + id);
          return {
            aboveToken:
              group.getLayer().zIndex() >
              stage
                .findOne('#' + targetId)
                .getLayer()
                .zIndex(),
            color: group
              .findOne('.ruler-shape')
              .findOne((node: any) => Boolean(node.stroke?.()))
              ?.stroke(),
            labelAngle: Math.abs(group.findOne('.ruler-label').getAbsoluteRotation()),
          };
        },
        { id: drawing.id, targetId: target.id },
      );
      expect(rendered).toEqual({ aboveToken: true, color: drawing.data.color, labelAngle: 0 });
    }
    // Filled area stays visible above the avatar, while its interior does not swallow avatar hover.
    if (drawing.id === circle.id) {
      const center = await nodePoint(t.gm, target.id);
      await t.gm.mouse.move(center.x, center.y);
      await expect(t.gm.getByRole('tooltip', { name: '角色概览', exact: true })).toContainText('角色乙');
    }
    const editor = drawing.id === circle.id ? t.b : t.gm;
    const select = await nodePoint(editor, drawing.id);
    await editor.mouse.dblclick(select.x, select.y);
    await expect.poll(() => controls(editor, drawing.id)).toEqual({ selection: 1, remove: 1 });
    const close = await nodePoint(editor, drawing.id, '.ruler-delete');
    if (drawing.id === line.id) {
      await editor.screenshot({ path: '.launcher/ruler-selected.png' });
      let fail = true;
      await editor.route(`**/api/rooms/${t.room.id}/operations`, async (route) => {
        if (fail && route.request().postDataJSON().type === 'drawing.undo') {
          fail = false;
          await route.fulfill({ status: 503, json: { error: '测试：删除暂时失败' } });
        } else await route.continue();
      });
      await editor.mouse.click(close.x, close.y);
      await expect(editor.locator('.toast')).toContainText('测试：删除暂时失败');
      expect((await saved(drawing.id)).undone).toBe(false);
      await expect.poll(() => controls(editor, drawing.id)).toEqual({ selection: 1, remove: 1 });
      await expect
        .poll(() =>
          editor.evaluate(
            (id) =>
              (window as any).Konva.stages[0]
                .findOne('#' + id)
                .findOne('.ruler-delete')
                .opacity(),
            drawing.id,
          ),
        )
        .toBe(1);
      await editor.mouse.click(close.x, close.y);
      await editor.unroute(`**/api/rooms/${t.room.id}/operations`);
    } else await editor.mouse.click(close.x, close.y);
    await expect.poll(async () => (await saved(drawing.id)).undone).toBe(true);
    for (const page of pages)
      await expect
        .poll(() => page.evaluate((id) => Boolean((window as any).Konva?.stages[0]?.findOne('#' + id)), drawing.id))
        .toBe(false);
  }
  await t.a.reload();
  await expect.poll(() => t.a.evaluate(() => (window as any).Konva?.stages[0]?.find('.ruler').length ?? -1)).toBe(0);
  expect(await t.db.mapToken.count({ where: { mapId: map.id } })).toBe(2);
});

test('双击量尺显示旋转端点，拖动以原点为轴并保持长度，同步与权限正常', async ({ table: t }, testInfo) => {
  const map = await op(t.gmContext, t.room.id, 'map.create', { name: '旋转端点场景', width: 1400, height: 900 });
  await op(t.gmContext, t.room.id, 'map.activate', { id: map.id });
  const ruler = await op(t.aContext, t.room.id, 'drawing.add', {
    mapId: map.id,
    kind: 'RULER',
    data: { shape: 'LINE', distance: 20, x: 650, y: 420, rotation: 12.5 },
  });
  async function handleCount(page: Page, id = ruler.id) {
    return page.evaluate(
      (id) => (window as any).Konva?.stages[0]?.findOne('#' + id)?.find('.ruler-rotation-handle').length || 0,
      id,
    );
  }
  async function select(page: Page, id = ruler.id, bodyPoint = 50) {
    await expect
      .poll(() => page.evaluate((id) => Boolean((window as any).Konva?.stages[0]?.findOne('#' + id)), id))
      .toBe(true);
    const point = await page.evaluate(
      ({ id, bodyPoint }) => {
        const stage = (window as any).Konva.stages[0],
          shape = stage.findOne('#' + id).findOne('.ruler-shape'),
          p = shape.getAbsoluteTransform().point({ x: bodyPoint, y: 0 }),
          rect = stage.container().getBoundingClientRect();
        return { x: p.x + rect.left, y: p.y + rect.top };
      },
      { id, bodyPoint },
    );
    await page.mouse.dblclick(point.x, point.y);
  }
  async function drag(page: Page, degrees: number, id = ruler.id, release = true) {
    await expect.poll(() => handleCount(page, id)).toBe(1);
    const points = await page.evaluate(
      ({ id, degrees }) => {
        const stage = (window as any).Konva.stages[0],
          group = stage.findOne('#' + id),
          handle = group.findOne('.ruler-rotation-handle'),
          start = handle.getAbsolutePosition(),
          radius = Math.hypot(handle.x(), handle.y()),
          end = group.getAbsoluteTransform().point({
            x: Math.cos((degrees * Math.PI) / 180) * radius * 0.7,
            y: Math.sin((degrees * Math.PI) / 180) * radius * 0.7,
          }),
          rect = stage.container().getBoundingClientRect();
        return {
          start: { x: start.x + rect.left, y: start.y + rect.top },
          end: { x: end.x + rect.left, y: end.y + rect.top },
        };
      },
      { id, degrees },
    );
    await page.mouse.move(points.start.x, points.start.y);
    await page.mouse.down();
    await page.mouse.move(points.end.x, points.end.y, { steps: 8 });
    const actual = await page.evaluate((id) => {
      const stage = (window as any).Konva.stages[0],
        group = stage.findOne('#' + id),
        point = group.getAbsoluteTransform().copy().invert().point(stage.getPointerPosition());
      return ((Math.atan2(point.y, point.x) * 180) / Math.PI + 360) % 360;
    }, id);
    if (release) await page.mouse.up();
    return actual;
  }
  const saved = async (id = ruler.id) =>
    (await snapshot(t.gmContext, t.room.id)).drawings.find((d: any) => d.id === id).data;
  const local = async (page: Page, id = ruler.id) =>
    page.evaluate((id) => {
      const stage = (window as any).Konva.stages[0],
        group = stage.findOne('#' + id),
        handle = group.findOne('.ruler-rotation-handle');
      return {
        rotation: group.findOne('.ruler-shape').rotation(),
        label: Math.abs(group.findOne('.ruler-label').getAbsoluteRotation()),
        x: group.x(),
        y: group.y(),
        scale: stage.scaleX(),
        radius: handle ? Math.hypot(handle.x(), handle.y()) : 0,
      };
    }, id);
  await select(t.b);
  expect(await handleCount(t.b)).toBe(0);
  await denied(t.bContext, t.room.id, 'drawing.update', { id: ruler.id, patch: { rotation: 90 } });
  await select(t.gm);
  await expect.poll(() => handleCount(t.gm)).toBe(1);
  expect(await handleCount(t.a)).toBe(0);
  await expect(t.gm.getByRole('dialog', { name: '精调量尺角度' })).toHaveCount(0);
  const before = await local(t.gm),
    original = await saved();
  const firstAngle = await drag(t.gm, 37.25, ruler.id, false);
  await expect.poll(async () => (await local(t.gm)).rotation).toBeCloseTo(firstAngle, 2);
  const preview = await local(t.gm);
  expect(preview.x).toBe(before.x);
  expect(preview.y).toBe(before.y);
  expect(preview.scale).toBe(before.scale);
  expect(preview.radius).toBeCloseTo(before.radius);
  expect(preview.label).toBe(0);
  expect((await saved()).rotation).toBe(12.5);
  await pageScreenshot();
  await t.gm.mouse.up();
  async function pageScreenshot() {
    await t.gm.screenshot({ path: testInfo.outputPath('ruler-rotation-handle.png') });
  }
  await expect.poll(async () => (await saved()).rotation).toBeCloseTo(firstAngle, 2);
  await expect.poll(async () => (await local(t.a)).rotation).toBeCloseTo(firstAngle, 2);
  const persisted = await saved();
  expect(persisted.x).toBe(original.x);
  expect(persisted.y).toBe(original.y);
  expect(persisted.length).toBe(original.length);
  expect(persisted.distance).toBe(original.distance);
  const point = await t.gm.evaluate((id) => {
    const stage = (window as any).Konva.stages[0],
      p = stage.findOne('#' + id).getAbsolutePosition(),
      rect = stage.container().getBoundingClientRect();
    return { x: p.x + rect.left, y: p.y + rect.top };
  }, ruler.id);
  await t.gm.mouse.move(point.x, point.y);
  await t.gm.mouse.wheel(0, 120);
  const wheelAngle = firstAngle + 5;
  await expect.poll(async () => (await saved()).rotation).toBeCloseTo(wheelAngle, 2);
  let failOnce = true;
  await t.gm.route(`**/rooms/${t.room.id}/operations`, async (route) => {
    if (failOnce && route.request().method() === 'POST' && route.request().postDataJSON()?.type === 'drawing.update') {
      failOnce = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: '角度同步暂时失败' }),
      });
    } else await route.continue();
  });
  await drag(t.gm, 315);
  await expect.poll(() => failOnce).toBe(false);
  await expect.poll(async () => (await local(t.gm)).rotation).toBeCloseTo(wheelAngle, 2);
  expect((await saved()).rotation).toBeCloseTo(wheelAngle, 2);
  const retriedAngle = await drag(t.gm, 315);
  await expect.poll(async () => (await saved()).rotation).toBeCloseTo(retriedAngle, 2);
  await t.gm.keyboard.press('Escape');
  await expect.poll(() => handleCount(t.gm)).toBe(0);
  await expect.poll(async () => (await local(t.a)).rotation).toBeCloseTo(retriedAngle, 2);
  await select(t.a);
  const ownerAngle = await drag(t.a, 60.5);
  await expect.poll(async () => (await saved()).rotation).toBeCloseTo(ownerAngle, 2);
  await t.a.mouse.click(200, 500);
  await expect.poll(() => handleCount(t.a)).toBe(0);
  await t.a.reload();
  await select(t.a);
  await expect.poll(async () => (await local(t.a)).rotation).toBeCloseTo(ownerAngle, 2);
  expect((await local(t.a)).label).toBe(0);
  await select(t.a);
  await expect.poll(() => handleCount(t.a)).toBe(0);
  for (const [index, shape] of ['CIRCLE', 'SQUARE', 'CONE'].entries()) {
    const other = await op(t.gmContext, t.room.id, 'drawing.add', {
      mapId: map.id,
      kind: 'RULER',
      data: { shape, distance: 5, x: 450 + index * 200, y: 430, rotation: 0 },
    });
    await select(t.gm, other.id, 0);
    const otherAngle = await drag(t.gm, 135, other.id);
    await expect.poll(async () => (await saved(other.id)).rotation).toBeCloseTo(otherAngle, 2);
    expect((await local(t.gm, other.id)).label).toBe(0);
  }
});

test('量尺旋转保留水平数字，连续滚轮同步；线索与剧情浮窗可独立缩放拖动', async ({ table: t }, testInfo) => {
  const map = await op(t.gmContext, t.room.id, 'map.create', { name: '量尺测试场景', width: 1400, height: 900 });
  await op(t.gmContext, t.room.id, 'map.activate', { id: map.id });
  const ruler = await op(t.gmContext, t.room.id, 'drawing.add', {
    mapId: map.id,
    kind: 'RULER',
    data: { shape: 'LINE', distance: 20, x: 500, y: 420, rotation: 0 },
  });
  await expect
    .poll(() =>
      t.gm.evaluate((id) => {
        const konva = (window as any).Konva;
        return Boolean(konva?.stages[0]?.findOne('#' + id));
      }, ruler.id),
    )
    .toBe(true);
  const before = await t.gm.evaluate((id) => {
    const stage = (window as any).Konva.stages[0],
      group = stage.findOne('#' + id),
      position = group.getAbsolutePosition(),
      rect = stage.container().getBoundingClientRect();
    return { x: position.x + rect.left + 2, y: position.y + rect.top + 2, scale: stage.scaleX() };
  }, ruler.id);
  await t.gm.mouse.move(before.x, before.y);
  for (let i = 0; i < 3; i++) await t.gm.mouse.wheel(0, 120);
  await expect
    .poll(
      async () => (await snapshot(t.gmContext, t.room.id)).drawings.find((d: any) => d.id === ruler.id).data.rotation,
    )
    .toBe(15);
  await expect
    .poll(
      async () => (await snapshot(t.aContext, t.room.id)).drawings.find((d: any) => d.id === ruler.id).data.rotation,
    )
    .toBe(15);
  const scene = await t.gm.evaluate((id) => {
    const stage = (window as any).Konva.stages[0],
      group = stage.findOne('#' + id);
    return {
      label: group.findOne('.ruler-label').getAbsoluteRotation(),
      shape: group.findOne('.ruler-shape').rotation(),
      scale: stage.scaleX(),
    };
  }, ruler.id);
  expect(scene.label).toBeCloseTo(0);
  expect(scene.shape).toBe(15);
  expect(scene.scale).toBe(before.scale);
  for (const shape of ['CIRCLE', 'SQUARE', 'CONE'])
    await op(t.gmContext, t.room.id, 'drawing.add', {
      mapId: map.id,
      kind: 'RULER',
      data: { shape, distance: 5, x: 800, y: 500, rotation: 135 },
    });
  await expect
    .poll(() =>
      t.gm.evaluate(() =>
        (window as any).Konva.stages[0].find('.ruler-label').map((label: any) => Math.abs(label.getAbsoluteRotation())),
      ),
    )
    .toEqual([0, 0, 0, 0]);
  await t.gm.screenshot({ path: testInfo.outputPath('ruler-horizontal-labels.png') });
  const upload = await t.gmContext.request.post(`${api}/rooms/${t.room.id}/presentation/assets`, {
    multipart: { file: { name: 'clue.png', mimeType: 'image/png', buffer: await picture }, title: '古老线索' },
  });
  expect(upload.status()).toBe(201);
  const asset = await upload.json();
  await post(t.gmContext, `/rooms/${t.room.id}/presentation/commands`, {
    id: randomUUID(),
    version: 0,
    type: 'play',
    assetId: asset.id,
    allowHistory: true,
    transition: 'none',
  });
  await expect(t.a.locator('.presentation-art')).toBeVisible();
  await t.a.locator('.presentation-canvas').hover();
  await t.a.mouse.wheel(0, -200);
  await expect(t.a.locator('.presentation-controls')).toContainText('149%');
  await expect(t.b.locator('.presentation-controls')).toContainText('100%');
  await t.a.getByRole('button', { name: '仅关闭我的窗口', exact: true }).click();
  await t.a.locator('.game-rail').getByRole('button', { name: '线索', exact: true }).click();
  await t.a.getByRole('button', { name: '古老线索', exact: true }).click();
  const viewport = t.a.getByLabel('线索图片查看器');
  await expect(viewport.locator('img')).toBeVisible();
  await viewport.hover();
  const scrollBefore = await t.a.locator('.window-body').evaluate((element) => element.scrollTop);
  await t.a.mouse.wheel(0, -200);
  await expect(t.a.getByLabel('线索图片缩放比例')).toHaveText('149%');
  expect(await t.a.locator('.window-body').evaluate((element) => element.scrollTop)).toBe(scrollBefore);
  const box = (await viewport.boundingBox())!,
    oldTransform = await viewport.locator('img').evaluate((element) => element.style.transform);
  await t.a.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await t.a.mouse.down();
  await t.a.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 + 30);
  await t.a.mouse.up();
  expect(await viewport.locator('img').evaluate((element) => element.style.transform)).not.toBe(oldTransform);
  await t.a.getByRole('button', { name: '适应窗口', exact: true }).click();
  await expect(t.a.getByLabel('线索图片缩放比例')).toHaveText('100%');
  await viewport.hover();
  await t.a.mouse.wheel(0, 200);
  await expect(t.a.getByLabel('线索图片缩放比例')).toHaveText('67%');
  await t.a.screenshot({ path: testInfo.outputPath('clue-wheel-zoom.png') });
});
