import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { api } from './server-address';

config({ path: 'apps/api/.env' });

test('GM和玩家各自修改房间内名称，实时同步、分房间隔离，身份和历史记录保持', async ({ browser }, info) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const db = new PrismaClient(),
    prefix = `name-${randomUUID().slice(0, 8)}`;
  const password = randomUUID();
  const users: { id: string; username: string }[] = [],
    rooms: { id: string; inviteCode: string }[] = [];
  const post = async (context: BrowserContext, path: string, data: unknown) => {
    const response = await context.request.post(api + path, { data });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const op = (context: BrowserContext, type: string, payload: Record<string, unknown>) =>
    post(context, `/rooms/${rooms[0].id}/operations`, { id: randomUUID(), type, payload });
  const snap = async (roomId = rooms[0].id) =>
    (await contexts[0].request.get(`${api}/rooms/${roomId}/snapshot`)).json();
  const profile = (context: BrowserContext, displayName: string, roomId = rooms[0].id) =>
    post(context, `/rooms/${roomId}/members/me/profile`, { displayName });
  const openRoom = async (context: BrowserContext, roomId: string) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1500, height: 1050 });
    await page.goto(`/rooms/${roomId}`);
    await expect(page.locator('.party-list')).toBeVisible();
    return page;
  };
  const settings = async (page: Page) => {
    await page.locator('.game-rail button[title="设置"]').click();
    await expect(page.getByRole('form', { name: '我的房间内名称' })).toBeVisible();
    return page.getByRole('form', { name: '我的房间内名称' });
  };
  try {
    for (const [index, context] of contexts.entries())
      users.push(await post(context, '/auth/register', { username: `${prefix}-${index}`, password }));
    rooms.push(await post(contexts[0], '/rooms', { name: `${prefix} 第一房间` }));
    rooms.push(await post(contexts[0], '/rooms', { name: `${prefix} 第二房间` }));
    for (const room of rooms) await post(contexts[1], '/rooms/join', { inviteCode: room.inviteCode });
    const oldRoll = await op(contexts[1], 'dice.roll', { expression: '1d20', visibility: 'PRIVATE' });
    expect(oldRoll.rollerName).toBe(users[1].username);
    const gm = await openRoom(contexts[0], rooms[0].id),
      player = await openRoom(contexts[1], rooms[0].id);
    const otherRoom = await openRoom(contexts[1], rooms[1].id);
    const gmForm = await settings(gm),
      playerForm = await settings(player);
    await gmForm.getByLabel('房间内名称', { exact: true }).fill('  守秘人 阿林  ');
    await gmForm.getByRole('button', { name: '保存房间内名称', exact: true }).click();
    await expect(gmForm.getByRole('status')).toHaveText('房间内名称已保存');
    await expect(player.locator('.party-list')).toContainText('守秘人 阿林');
    await expect(otherRoom.locator('.party-list')).not.toContainText('守秘人 阿林');
    // Snapshot refreshes must not overwrite an unfinished personal-name draft.
    await playerForm.getByLabel('房间内名称', { exact: true }).fill('巡林客 小雨');
    const map = await op(contexts[0], 'map.create', { name: '名称测试地图' });
    await expect.poll(async () => (await snap()).maps.length).toBe(1);
    await expect(playerForm.getByLabel('房间内名称', { exact: true })).toHaveValue('巡林客 小雨');
    let failOnce = true;
    await player.route('**/members/me/profile', async (route) => {
      if (failOnce) {
        failOnce = false;
        await route.fulfill({ status: 503, json: { error: '名称暂时未能保存' } });
      } else await route.continue();
    });
    await playerForm.getByRole('button', { name: '保存房间内名称', exact: true }).click();
    await expect(playerForm.getByRole('alert')).toHaveText('名称暂时未能保存');
    await expect(playerForm.getByLabel('房间内名称', { exact: true })).toHaveValue('巡林客 小雨');
    await playerForm.getByRole('button', { name: '保存房间内名称', exact: true }).click();
    await expect(gm.locator('.party-list')).toContainText('巡林客 小雨');
    await expect(playerForm.getByRole('status')).toHaveText('房间内名称已保存');
    await gmForm.screenshot({ path: info.outputPath('gm-room-name.png') });
    await playerForm.screenshot({ path: info.outputPath('player-room-name.png') });
    const changed = await snap();
    expect(changed.members.find((member: any) => member.userId === users[1].id)).toMatchObject({
      displayName: '巡林客 小雨',
      role: 'PLAYER',
      user: { username: users[1].username },
    });
    expect((await snap(rooms[1].id)).members.every((member: any) => member.displayName === null)).toBe(true);
    await profile(contexts[1], '另一桌的小雨', rooms[1].id);
    await expect(otherRoom.locator('.party-list')).toContainText('另一桌的小雨');
    await expect(player.locator('.party-list')).toContainText('巡林客 小雨');
    for (const body of [
      { displayName: 'a'.repeat(31) },
      { displayName: '甲\n乙' },
      { displayName: null },
      { displayName: '越权', userId: users[0].id },
      { displayName: '越权', role: 'GM' },
    ])
      expect(
        (await contexts[1].request.post(`${api}/rooms/${rooms[0].id}/members/me/profile`, { data: body })).status(),
      ).toBe(400);
    expect(
      (
        await contexts[2].request.post(`${api}/rooms/${rooms[0].id}/members/me/profile`, {
          data: { displayName: '外部用户' },
        })
      ).status(),
    ).toBe(403);
    expect((await snap()).members.find((member: any) => member.userId === users[0].id).displayName).toBe('守秘人 阿林');
    const newRoll = await op(contexts[1], 'dice.roll', { expression: '1d20', visibility: 'PUBLIC' });
    expect(newRoll.rollerName).toBe('巡林客 小雨');
    await expect(gm.locator('.public-dice-banner')).toContainText('巡林客 小雨');
    const ruler = await op(contexts[1], 'drawing.add', {
      mapId: map.id,
      kind: 'RULER',
      data: { shape: 'LINE', distance: 5, x: 100, y: 100 },
    });
    expect(ruler.data.authorName).toBe('巡林客 小雨');
    const clue = await post(contexts[0], `/rooms/${rooms[0].id}/private-clues/send`, {
      id: randomUUID(),
      title: '名称测试线索',
      bodyMarkdown: '独立投递内容',
      recipientUserIds: [users[1].id],
      allowForward: true,
    });
    const outbox = await contexts[0].request.get(`${api}/rooms/${rooms[0].id}/private-clues/sent/${clue.clueId}`);
    const sent = await outbox.json();
    expect(sent.senderName).toBe('守秘人 阿林');
    expect(sent.deliveries[0].recipientName).toBe('巡林客 小雨');
    // A second session for the same login can rename while this window reconnects.
    await player.evaluate(() => window.dispatchEvent(new Event('offline')));
    await profile(contexts[1], '重连后的小雨');
    await player.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(player.locator('.party-list')).toContainText('重连后的小雨');
    await expect(gm.locator('.party-list')).toContainText('重连后的小雨');
    await player.reload();
    await expect(player.locator('.party-list')).toContainText('重连后的小雨');
    const formAfterRefresh = await settings(player);
    await expect(formAfterRefresh.getByLabel('房间内名称', { exact: true })).toHaveValue('重连后的小雨');
    await formAfterRefresh.getByRole('button', { name: '使用账号名称', exact: true }).click();
    await expect(formAfterRefresh.getByRole('status')).toHaveText('已恢复使用账号名称');
    await expect(gm.locator('.party-list')).toContainText(users[1].username);
    const latest = await snap();
    expect(latest.rolls.find((roll: any) => roll.id === newRoll.id).rollerName).toBe('巡林客 小雨');
    expect((await db.diceRoll.findUniqueOrThrow({ where: { id: oldRoll.id } })).rollerName).toBe(users[1].username);
    expect(latest.drawings.find((drawing: any) => drawing.id === ruler.id).data.authorName).toBe('巡林客 小雨');
    expect(latest.members.find((member: any) => member.userId === users[1].id).displayName).toBeNull();
    expect((await snap(rooms[1].id)).members.find((member: any) => member.userId === users[1].id).displayName).toBe(
      '另一桌的小雨',
    );
    expect((await db.privateClue.findUniqueOrThrow({ where: { id: clue.clueId } })).senderName).toBe('守秘人 阿林');
    const relogin = await contexts[2].request.post(`${api}/auth/login`, {
      data: { username: users[1].username, password },
    });
    expect(relogin.ok()).toBe(true);
    expect((await relogin.json()).username).toBe(users[1].username);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    for (const room of rooms) await db.room.deleteMany({ where: { id: room.id, name: { startsWith: prefix } } });
    await db.user.deleteMany({ where: { id: { in: users.map((user) => user.id) }, username: { startsWith: prefix } } });
    await db.$disconnect();
  }
});
