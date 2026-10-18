import { api } from './server-address';
import { test, expect, type BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';
import { unlink } from 'node:fs/promises';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config({ path: 'apps/api/.env' });

async function login(context: BrowserContext, username: string) {
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByRole('textbox', { name: '冒险者名称' }).fill(username);
  await page.getByRole('textbox', { name: '密码' }).fill('demo12345');
  await page.getByRole('button', { name: '进入冒险' }).click();
  await expect(page).toHaveURL(/\/rooms$/);
  return page;
}
async function post(context: BrowserContext, path: string, data: unknown) {
  const response = await context.request.post(api + path, { data });
  const body = await response.json();
  expect(response.ok(), `${path}: ${JSON.stringify(body)}`).toBe(true);
  return body;
}

test('GM 放映三张剧情图时，两名玩家同步且人物卡草稿保持焦点', async ({ browser }) => {
  test.setTimeout(120_000);
  const db = new PrismaClient(),
    contexts = [await browser.newContext(), await browser.newContext(), await browser.newContext()];
  let roomId: string | undefined;
  try {
    const [gm, p1, p2] = await Promise.all([
      login(contexts[0], 'demo-gm'),
      login(contexts[1], 'demo-player-1'),
      login(contexts[2], 'demo-player-2'),
    ]);
    const room = await post(contexts[0], '/rooms', { name: `E2E presentation ${randomUUID().slice(0, 8)}` });
    roomId = room.id;
    await post(contexts[1], '/rooms/join', { inviteCode: room.inviteCode });
    await post(contexts[2], '/rooms/join', { inviteCode: room.inviteCode });
    const owner = await (await contexts[1].request.get(api + '/auth/me')).json();
    await post(contexts[0], `/rooms/${room.id}/members/${owner.id}/permissions`, { characterBasics: true });
    const character = await post(contexts[0], `/rooms/${room.id}/operations`, {
      id: randomUUID(),
      type: 'character.create',
      payload: { name: '剧情角色', ownerId: owner.id },
    });
    await Promise.all([gm.goto(`/rooms/${room.id}`), p1.goto(`/rooms/${room.id}`), p2.goto(`/rooms/${room.id}`)]);
    console.log('presentation e2e: room open');
    await p1.locator('.hero-chip').filter({ hasText: '剧情角色' }).click();
    const draft = p1.locator('.sheet-name');
    await draft.fill('未保存的角色名草稿');
    await expect(draft).toBeFocused();
    await gm.locator('.game-rail').getByRole('button', { name: '导演台' }).click();
    await expect(gm.getByRole('combobox', { name: '建议观看方式' })).toHaveValue('cinematic');
    const png = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#864c27' } })
      .png()
      .toBuffer();
    for (const name of ['第一幕', '第二幕', '第三幕']) {
      await gm
        .locator('.presentation-director input[type=file]')
        .setInputFiles({ name: `${name}.png`, mimeType: 'image/png', buffer: png });
      await expect(gm.locator('.presentation-asset').filter({ hasText: name })).toBeVisible();
    }
    console.log('presentation e2e: three images uploaded');
    await gm.getByRole('textbox', { name: '新章节名称' }).fill('序章');
    await gm.getByRole('button', { name: '创建章节' }).click();
    await expect(gm.getByRole('combobox', { name: '章节筛选' })).toHaveValue(/.+/);
    await gm.getByRole('combobox', { name: '章节筛选' }).selectOption('');
    await gm.locator('.presentation-asset').filter({ hasText: '第一幕' }).click();
    await gm.getByRole('textbox', { name: '玩家可见说明' }).fill('第一幕的线索');
    await gm.getByRole('textbox', { name: 'GM 私人备注' }).fill('这里隐藏着陷阱');
    await gm.getByRole('button', { name: '保存素材信息' }).click();
    await gm.getByRole('button', { name: '加入条目' }).click();
    await expect(
      gm.locator('.grid-card').filter({ hasText: '演出条目' }).getByRole('button', { name: '放映' }),
    ).toBeVisible();
    await gm.getByRole('checkbox', { name: '放映后加入玩家线索图库' }).check();
    await gm.getByRole('button', { name: '向房间展示' }).click();
    await gm.getByRole('checkbox', { name: '放映后加入玩家线索图库' }).uncheck();
    console.log('presentation e2e: first play clicked');
    await expect(p1.locator('.presentation-viewer')).toBeVisible();
    await expect(p2.locator('.presentation-viewer')).toBeVisible();
    for (const page of [p1, p2]) {
      const viewer = page.locator('.presentation-viewer.cinematic');
      await expect(viewer).toBeVisible();
      await viewer.evaluate(async (element) => {
        await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {})));
      });
      const bounds = (await page.locator('.game-shell > section').boundingBox())!,
        imageWindow = (await viewer.boundingBox())!;
      expect(imageWindow.x).toBeCloseTo(bounds.x + 8, 0);
      expect(imageWindow.y).toBeCloseTo(bounds.y + 8, 0);
      expect(imageWindow.width).toBeCloseTo(bounds.width - 16, 0);
      expect(imageWindow.height).toBeCloseTo(bounds.height - 16, 0);
    }
    await expect(gm.locator('.presentation-viewer.cinematic')).toHaveCount(0);
    await expect(p1.locator('.presentation-titlebar')).toContainText('第一幕');
    await expect(draft).toHaveValue('未保存的角色名草稿');
    await expect(draft).toBeFocused();
    console.log('presentation e2e: player draft retained');
    await gm.locator('.presentation-asset').filter({ hasText: '第二幕' }).click();
    await gm.getByRole('button', { name: '向房间展示' }).click();
    await expect(p2.locator('.presentation-titlebar')).toContainText('第二幕');
    await expect(p2.locator('.presentation-titlebar').getByTitle('最小化', { exact: true })).toHaveCount(0);
    await p2.locator('.presentation-titlebar').getByRole('button', { name: '仅关闭我的窗口', exact: true }).click();
    await expect(p2.locator('.presentation-viewer')).toHaveCount(0);
    const tagDefinition = await post(contexts[0], `/rooms/${room.id}/operations`, {
      id: randomUUID(),
      type: 'tagDefinition.create',
      payload: { name: '剧情线索', icon: 'clue', color: '#c69452', defaultVisibility: 'PUBLIC' },
    });
    await post(contexts[0], `/rooms/${room.id}/operations`, {
      id: randomUUID(),
      type: 'characterTag.attach',
      payload: {
        characterId: character.id,
        tagDefinitionId: tagDefinition.id,
        definitionVersion: tagDefinition.version,
        detailsMarkdown: '放映时的独立线索',
      },
    });
    await expect(
      p1.locator('.character-sheet').getByRole('button', { name: '标签：剧情线索', exact: true }),
    ).toBeVisible();
    await expect(draft).toHaveValue('未保存的角色名草稿');
    await expect(draft).toBeFocused();
    await expect(p2.locator('.presentation-viewer')).toHaveCount(0);

    await gm.locator('.presentation-asset').filter({ hasText: '第三幕' }).click();
    await gm.getByRole('button', { name: '向房间展示' }).click();
    await expect(p1.locator('.presentation-titlebar')).toContainText('第三幕');
    await expect(p2.locator('.presentation-viewer')).toHaveCount(0);
    await p2.locator('.presentation-entry').click();
    await expect(p2.locator('.presentation-titlebar')).toContainText('第三幕');
    const stage = await contexts[0].newPage();
    await stage.goto(`/rooms/${room.id}/presentation`);
    await expect(stage.locator('.presentation-stage-caption')).toContainText('第三幕');
    await gm.getByRole('combobox', { name: '建议观看方式' }).selectOption('cinematic');
    await gm.getByRole('button', { name: '向房间展示' }).click();
    await expect(p2.locator('.presentation-viewer.cinematic')).toBeVisible();
    await p2.getByRole('button', { name: '返回浮窗' }).click();
    await expect(p2.locator('.presentation-viewer.cinematic')).toHaveCount(0);
    const floating = p2.locator('.presentation-viewer');
    await floating.evaluate(async (element) => {
      await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => {})));
    });
    const beforeResize = (await floating.boundingBox())!,
      handle = (await floating.locator('.resize-w').boundingBox())!;
    await p2.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await p2.mouse.down();
    await p2.mouse.move(handle.x + handle.width / 2 - 40, handle.y + handle.height / 2, { steps: 6 });
    await p2.mouse.up();
    const afterResize = (await floating.boundingBox())!;
    expect(afterResize.width).toBeGreaterThan(beforeResize.width + 30);
    expect(afterResize.x + afterResize.width).toBeCloseTo(beforeResize.x + beforeResize.width, 0);
    const savedView = await p2.evaluate(
      () => Object.entries(localStorage).find(([key]) => key.startsWith('dnd-presentation-view:'))?.[1],
    );
    expect(JSON.parse(savedView!).w).toBeCloseTo(afterResize.width, 0);
    await gm.getByRole('button', { name: '黑幕', exact: true }).click();
    await expect(stage.locator('.presentation-stage-center.blackout')).toBeVisible();
    await expect(p2.locator('.presentation-blackout')).toBeVisible();
    await gm.getByRole('button', { name: '解除黑幕' }).click();
    await expect(stage.locator('.presentation-stage-caption')).toContainText('第三幕');
    await expect(p2.locator('.presentation-viewer.cinematic')).toHaveCount(0);
    const assets = await (await contexts[0].request.get(api + `/rooms/${room.id}/presentation/assets`)).json();
    const play = async (version: number, assetId: string) =>
      post(contexts[0], `/rooms/${room.id}/presentation/commands`, {
        id: randomUUID(),
        version,
        type: 'play',
        assetId,
      });
    await play(6, assets[0].id);
    await expect(p1.locator('.presentation-titlebar')).toContainText('第一幕');
    await play(7, assets[1].id);
    await play(8, assets[2].id);
    await expect(p1.locator('.presentation-titlebar')).toContainText('第三幕');
    await expect(p2.locator('.presentation-titlebar')).toContainText('第三幕');
    await p2.reload();
    await expect(p2.locator('.presentation-titlebar')).toContainText('第三幕');
    const lateContext = await browser.newContext();
    contexts.push(lateContext);
    const late = await login(lateContext, 'demo-player-3');
    await post(lateContext, '/rooms/join', { inviteCode: room.inviteCode });
    await late.goto(`/rooms/${room.id}`);
    await expect(late.locator('.presentation-titlebar')).toContainText('第三幕');
    await gm.getByRole('button', { name: '结束', exact: true }).click();
    await expect(p1.locator('.presentation-viewer')).toHaveCount(0);
    await expect(p2.locator('.presentation-viewer')).toHaveCount(0);
    await expect(late.locator('.presentation-viewer')).toHaveCount(0);
    await expect(stage.locator('.presentation-stage-center')).toContainText('等待 GM 放映画面');
    await late.reload();
    await expect(late.locator('.presentation-viewer')).toHaveCount(0);
    await expect(draft).toHaveValue('未保存的角色名草稿');
    await p2.locator('.game-rail').getByRole('button', { name: '线索', exact: true }).click();
    await expect(p2.locator('.window-body').getByText('第一幕')).toBeVisible();
    await expect(p2.locator('.window-body').getByText('第二幕')).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    if (roomId) {
      const room = await db.room.findUnique({ where: { id: roomId }, select: { name: true } }).catch(() => null);
      if (room?.name.startsWith('E2E presentation ')) {
        const assets = await db.presentationAsset.findMany({
          where: { roomId },
          select: { storageName: true, screenName: true, thumbName: true },
        });
        await db.room.delete({ where: { id: roomId } });
        const root = resolve('apps/api', process.env.UPLOAD_DIR || 'uploads', roomId, 'presentation');
        for (const asset of assets)
          for (const name of [asset.storageName, asset.screenName, asset.thumbName])
            await unlink(join(root, name)).catch(() => {});
      }
    }
    await db.$disconnect();
  }
});
