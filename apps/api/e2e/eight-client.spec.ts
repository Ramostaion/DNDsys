import { api } from './server-address';
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { resolve, join } from 'node:path';
import { unlink, stat } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';

config({ path: 'apps/api/.env' });

async function login(context: BrowserContext, username: string, password: string) {
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByRole('textbox', { name: '冒险者名称' }).fill(username);
  await page.getByRole('textbox', { name: '密码' }).fill(password);
  await page.getByRole('button', { name: '进入冒险' }).click();
  await expect(page).toHaveURL(/\/rooms$/);
  return page;
}
async function post(context: BrowserContext, path: string, data: unknown) {
  const response = await context.request.post(api + path, { data });
  const body = await response.json();
  expect(response.ok(), `${path}: ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}

test('八个独立账号同步手动数值与高清剧情图片，并记录耗时', async ({ browser }) => {
  test.setTimeout(120_000);
  const db = new PrismaClient(),
    contexts: BrowserContext[] = [],
    temporaryUserIds: string[] = [];
  let roomId: string | undefined;
  try {
    const password = `Temp-${randomUUID()}`;
    const passwordHash = await bcrypt.hash(password, 10);
    const suffix = randomUUID().slice(0, 8);
    for (let index = 0; index < 7; index++) {
      const user = await db.user.create({
        data: { username: `e2e${suffix}${index}`, passwordHash },
        select: { id: true, username: true },
      });
      temporaryUserIds.push(user.id);
    }
    const gmContext = await browser.newContext();
    contexts.push(gmContext);
    const gmPage = await login(gmContext, 'demo-gm', 'demo12345');
    const room = await post(gmContext, '/rooms', { name: `E2E eight ${suffix}` });
    roomId = room.id;
    const playerPages: Page[] = [];
    for (let index = 0; index < 7; index++) {
      const context = await browser.newContext();
      contexts.push(context);
      const page = await login(context, `e2e${suffix}${index}`, password);
      playerPages.push(page);
      await post(context, '/rooms/join', { inviteCode: room.inviteCode });
    }
    await post(gmContext, `/rooms/${room.id}/members/${temporaryUserIds[0]}/permissions`, { characterValues: true });
    const hero = await post(gmContext, `/rooms/${room.id}/operations`, {
      id: randomUUID(),
      type: 'character.create',
      payload: { name: '八人测试角色', ownerId: temporaryUserIds[0] },
    });
    const field = await post(gmContext, `/rooms/${room.id}/operations`, {
      id: randomUUID(),
      type: 'sheet.field.upsert',
      payload: {
        version: room.version,
        field: { fieldId: 'ap', name: '普通行动点', type: 'number', defaultValue: 2, isResource: true },
      },
    });
    expect(field.roomVersion).toBeGreaterThan(room.version);
    const pages = [gmPage, ...playerPages];
    await Promise.all(pages.map((page) => page.goto(`/rooms/${room.id}`)));
    await Promise.all(
      pages.map(async (page) => {
        await expect(page.getByText('同行者 8')).toBeVisible();
        await page.locator('.game-rail').getByRole('button', { name: '角色' }).click();
        await page.getByRole('button', { name: '八人测试角色', exact: true }).click();
        await expect(
          page.locator('.grid-card').filter({ hasText: '普通行动点' }).getByText('2', { exact: true }),
        ).toBeVisible();
      }),
    );
    const tagDefinition = await post(gmContext, `/rooms/${room.id}/operations`, {
      id: randomUUID(),
      type: 'tagDefinition.create',
      payload: { name: '八人共享线索', icon: 'clue', color: '#c69452', defaultVisibility: 'PUBLIC' },
    });
    await post(gmContext, `/rooms/${room.id}/operations`, {
      id: randomUUID(),
      type: 'characterTag.attach',
      payload: {
        characterId: hero.id,
        tagDefinitionId: tagDefinition.id,
        definitionVersion: 0,
        detailsMarkdown: '所有成员可见的独立角色线索',
      },
    });
    await Promise.all(
      pages.map((page) =>
        expect(
          page.locator('.character-sheet').getByRole('button', { name: '标签：八人共享线索', exact: true }),
        ).toBeVisible(),
      ),
    );
    const ownerDefinition = await post(gmContext, `/rooms/${room.id}/operations`, {
      id: randomUUID(),
      type: 'tagDefinition.create',
      payload: { name: '所属玩家秘密', icon: 'secret', color: '#b56ce2', defaultVisibility: 'OWNER' },
    });
    await post(gmContext, `/rooms/${room.id}/operations`, {
      id: randomUUID(),
      type: 'characterTag.attach',
      payload: {
        characterId: hero.id,
        tagDefinitionId: ownerDefinition.id,
        definitionVersion: 0,
        detailsMarkdown: '仅控制者和 GM 查看',
      },
    });
    for (const page of [gmPage, playerPages[0]])
      await expect(
        page.locator('.character-sheet').getByRole('button', { name: '标签：所属玩家秘密', exact: true }),
      ).toBeVisible();
    for (const page of playerPages.slice(1))
      await expect(
        page.locator('.character-sheet').getByRole('button', { name: '标签：所属玩家秘密', exact: true }),
      ).toHaveCount(0);
    const ownerPage = playerPages[0],
      resource = ownerPage.locator('.grid-card').filter({ hasText: '普通行动点' });
    await resource.getByRole('button', { name: '−' }).click();
    await Promise.all(
      pages.map((page) =>
        expect(
          page.locator('.grid-card').filter({ hasText: '普通行动点' }).getByText('1', { exact: true }),
        ).toBeVisible(),
      ),
    );
    const started = performance.now();
    const snapshots = await Promise.all(
      contexts.map((context) => context.request.get(api + `/rooms/${room.id}/snapshot`)),
    );
    const elapsed = Math.round(performance.now() - started);
    const sizes = await Promise.all(snapshots.map(async (response) => (await response.body()).byteLength));
    expect(snapshots.every((response) => response.ok())).toBe(true);
    console.log(`8-client snapshot: total ${elapsed} ms, bytes min ${Math.min(...sizes)}, max ${Math.max(...sizes)}`);
    const authoritative = await snapshots[0].json();
    expect(
      authoritative.characters.find((character: { id: string }) => character.id === hero.id).derived.values.ap,
    ).toBe(1);
    const imageBytes = await sharp(randomBytes(1920 * 1080 * 3), { raw: { width: 1920, height: 1080, channels: 3 } })
      .jpeg({ quality: 78 })
      .toBuffer();
    const uploaded = await gmContext.request.post(api + `/rooms/${room.id}/presentation/assets`, {
      multipart: { title: '高清测试场景', file: { name: 'scene.jpg', mimeType: 'image/jpeg', buffer: imageBytes } },
    });
    expect(uploaded.status()).toBe(201);
    const asset = await uploaded.json();
    const screen = await db.presentationAsset.findUniqueOrThrow({
      where: { id: asset.id },
      select: { screenName: true },
    });
    const fileBytes = (
      await stat(resolve('apps/api', process.env.UPLOAD_DIR || 'uploads', room.id, 'presentation', screen.screenName))
    ).size;
    const showStarted = performance.now();
    await post(gmContext, `/rooms/${room.id}/presentation/commands`, {
      id: randomUUID(),
      version: 0,
      type: 'play',
      assetId: asset.id,
    });
    await Promise.all(
      pages.map(async (page) => {
        await expect(page.locator('.presentation-titlebar')).toContainText('高清测试场景');
        await expect
          .poll(() =>
            page
              .locator('.presentation-image-layer img')
              .evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 1920),
          )
          .toBe(true);
      }),
    );
    console.log(
      `8-client 1920x1080 image: ${Math.round(performance.now() - showStarted)} ms to all loaded, screen file ${fileBytes} bytes`,
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    if (roomId) {
      const room = await db.room.findUnique({ where: { id: roomId }, select: { name: true } }).catch(() => null);
      if (room?.name.startsWith('E2E eight ')) {
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
    for (const id of temporaryUserIds) await db.user.delete({ where: { id } }).catch(() => {});
    await db.$disconnect();
  }
});
