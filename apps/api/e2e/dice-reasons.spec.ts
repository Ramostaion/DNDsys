import { api } from './server-address';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config({ path: 'apps/api/.env' });

test('掷骰原因分类互斥、清空恢复草稿，战斗/鉴定/自定义原因真实保存并同步', async ({ browser }) => {
  const db = new PrismaClient();
  const prefix = `e2e-reason-${randomUUID().slice(0, 8)}`;
  const users: any[] = [];
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  let roomId: string | undefined;
  async function post(context: BrowserContext, path: string, data: unknown) {
    const response = await context.request.post(api + path, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  }
  async function roll(page: Page) {
    const reply = page.waitForResponse(
      (response) => response.url().endsWith('/operations') && response.request().postDataJSON().type === 'dice.roll',
    );
    await page.getByRole('button', { name: '掷出骰子', exact: true }).click();
    const response = await reply;
    expect(response.ok()).toBe(true);
    return response.json();
  }
  try {
    for (const [index, context] of contexts.entries())
      users.push(await post(context, '/auth/register', { username: `${prefix}-${index}`, password: randomUUID() }));
    const room = await post(contexts[0], '/rooms', { name: prefix });
    roomId = room.id;
    await post(contexts[1], '/rooms/join', { inviteCode: room.inviteCode });
    const pages = await Promise.all(
      contexts.map(async (context) => {
        const page = await context.newPage();
        await page.goto(`/rooms/${room.id}`);
        await expect(page.locator('.party-panel [title="已连接"]')).toBeVisible();
        await page.locator('.game-rail').getByRole('button', { name: '骰子', exact: true }).click();
        return page;
      }),
    );
    const [gm, player] = pages;
    const combat = gm.getByLabel('战斗大类', { exact: true });
    const check = gm.getByLabel('鉴定大类', { exact: true });
    const custom = gm.getByLabel('掷骰原因', { exact: true });
    await expect(combat.locator('option')).toHaveText(['未选择', '命中', '闪避']);
    await expect(check.locator('option')).toHaveText([
      '未选择',
      '力量',
      '敏捷',
      '智力',
      '体质',
      '感知',
      '魅力',
      '特技',
      '驯兽',
      '奥秘',
      '运动',
      '欺瞒',
      '历史',
      '洞悉',
      '威吓',
      '调查',
      '医药',
      '自然',
      '察觉',
      '表演',
      '游说',
      '宗教',
      '巧手',
      '隐匿',
      '求生',
    ]);
    await custom.fill('保留的自定义原因');
    await combat.selectOption('命中');
    await expect(check).toBeDisabled();
    await expect(check).toHaveValue('');
    await expect(custom).toBeDisabled();
    await expect(custom).toHaveValue('保留的自定义原因');
    // Selecting another entry within the chosen list is allowed.
    await combat.selectOption('闪避');
    await combat.selectOption('命中');
    const battleRoll = await roll(gm);
    expect(battleRoll.reason).toBe('战斗 · 命中');
    await expect(player.locator('.dice-history').filter({ hasText: '战斗 · 命中' })).toBeVisible();
    await combat.selectOption('');
    await expect(check).toBeEnabled();
    await expect(custom).toBeEnabled();
    await expect(custom).toHaveValue('保留的自定义原因');
    await check.selectOption('调查');
    await expect(combat).toBeDisabled();
    await expect(combat).toHaveValue('');
    await expect(custom).toBeDisabled();
    await check.selectOption('奥秘');
    const checkRoll = await roll(gm);
    expect(checkRoll.reason).toBe('鉴定 · 奥秘');
    await expect(player.locator('.dice-history').filter({ hasText: '鉴定 · 奥秘' })).toBeVisible();
    await check.selectOption('');
    await expect(combat).toBeEnabled();
    await expect(custom).toBeEnabled();
    await expect(custom).toHaveValue('保留的自定义原因');
    // The same mutually exclusive controls are available to a normal player.
    const playerCombat = player.getByLabel('战斗大类', { exact: true });
    const playerCheck = player.getByLabel('鉴定大类', { exact: true });
    const playerCustom = player.getByLabel('掷骰原因', { exact: true });
    await playerCheck.selectOption('求生');
    await expect(playerCombat).toBeDisabled();
    await expect(playerCustom).toBeDisabled();
    await playerCheck.selectOption('');
    await playerCustom.fill('玩家自定义的检定');
    const customRoll = await roll(player);
    expect(customRoll.reason).toBe('玩家自定义的检定');
    await expect(gm.locator('.dice-history').filter({ hasText: '玩家自定义的检定' })).toBeVisible();
    const saved = await db.diceRoll.findMany({ where: { roomId }, orderBy: { createdAt: 'asc' } });
    expect(saved.map((record) => record.reason)).toEqual(['战斗 · 命中', '鉴定 · 奥秘', '玩家自定义的检定']);
    await gm.reload();
    await gm.locator('.game-rail').getByRole('button', { name: '骰子', exact: true }).click();
    for (const reason of saved.map((record) => record.reason))
      await expect(gm.locator('.dice-history').filter({ hasText: reason })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    if (roomId) await db.room.delete({ where: { id: roomId } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
