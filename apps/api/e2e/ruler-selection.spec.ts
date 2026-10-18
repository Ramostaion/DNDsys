import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { api } from './server-address';

config({ path: 'apps/api/.env' });

test('锥形量尺双击选框贴合扇形，旋转缩放后保持，其他形状和删除正常', async ({ page, context }, testInfo) => {
  await page.setViewportSize({ width: 1600, height: 1050 });
  const db = new PrismaClient();
  const username = `ruler-bounds-${randomUUID().slice(0, 8)}`;
  let userId: string | undefined, roomId: string | undefined;
  const post = async (path: string, data: unknown) => {
    const response = await context.request.post(api + path, { data });
    expect(response.ok()).toBe(true);
    return response.json();
  };
  const op = (type: string, payload: Record<string, unknown>) =>
    post(`/rooms/${roomId}/operations`, { id: randomUUID(), type, payload });
  const snapshot = async () => (await context.request.get(`${api}/rooms/${roomId}/snapshot`)).json();
  const mapPoint = (x: number, y: number) =>
    page.evaluate(
      ({ x, y }) => {
        const stage = (window as any).Konva.stages[0];
        const point = stage.getAbsoluteTransform().point({ x, y });
        const box = stage.container().getBoundingClientRect();
        return { x: point.x + box.left, y: point.y + box.top };
      },
      { x, y },
    );
  async function select(id: string) {
    const point = await page.evaluate((id) => {
      const stage = (window as any).Konva.stages[0];
      const point = stage.findOne('#' + id).getAbsolutePosition();
      const box = stage.container().getBoundingClientRect();
      return { x: point.x + box.left, y: point.y + box.top };
    }, id);
    await page.mouse.dblclick(point.x, point.y);
    await expect
      .poll(() =>
        page.evaluate(
          (id) => Boolean((window as any).Konva.stages[0].findOne('#' + id)?.findOne('.ruler-selection-box')),
          id,
        ),
      )
      .toBe(true);
  }
  async function checkCone(id: string) {
    // Independently sample the visible arc, rather than using Konva's full-circle Wedge bounds.
    const result = await page.evaluate((id) => {
      const stage = (window as any).Konva.stages[0];
      const group = stage.findOne('#' + id);
      const shape = group.findOne('.ruler-shape');
      const wedge = shape.findOne('Wedge');
      const box = group.findOne('.ruler-selection-box');
      const rotation = shape.rotation(),
        angle = wedge.angle(),
        radius = wedge.radius();
      const xs = [0],
        ys = [0];
      for (let index = 0; index <= 1440; index++) {
        const radians = ((rotation - angle / 2 + (angle * index) / 1440) * Math.PI) / 180;
        xs.push(radius * Math.cos(radians));
        ys.push(radius * Math.sin(radians));
      }
      const padding = 1 + 8 / stage.scaleX();
      const expected = {
        x: Math.min(...xs) - padding,
        y: Math.min(...ys) - padding,
        width: Math.max(...xs) - Math.min(...xs) + padding * 2,
        height: Math.max(...ys) - Math.min(...ys) + padding * 2,
      };
      const actual = { x: box.x(), y: box.y(), width: box.width(), height: box.height() };
      const remove = group.findOne('.ruler-delete');
      return { expected, actual, remove: { x: remove.x(), y: remove.y() }, scale: stage.scaleX(), rotation };
    }, id);
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(result.actual[key] - result.expected[key]), `${key}: ${JSON.stringify(result)}`).toBeLessThan(
        0.1,
      );
    expect(result.remove.x).toBeCloseTo(result.actual.x + result.actual.width, 3);
    expect(result.remove.y).toBeCloseTo(result.actual.y - 20 / result.scale, 3);
    return result;
  }
  try {
    userId = (await post('/auth/register', { username, password: randomUUID() })).id;
    roomId = (await post('/rooms', { name: `量尺边界回归 ${username}` })).id;
    const map = await op('map.create', { name: '量尺边界地图', width: 1400, height: 900 });
    await op('map.activate', { id: map.id });
    await page.goto(`/rooms/${roomId}`);
    await expect(page.locator('.konvajs-content canvas').first()).toBeVisible();
    await page.locator('.board-tools').getByRole('button', { name: '量尺', exact: true }).click();
    await page.getByLabel('量尺形状', { exact: true }).selectOption('CONE');
    await page.getByLabel('量尺距离', { exact: true }).fill('10');
    const place = await mapPoint(500, 350);
    await page.mouse.click(place.x, place.y);
    await expect.poll(async () => (await snapshot()).drawings.length).toBe(1);
    const cone = (await snapshot()).drawings[0];
    await expect
      .poll(() => page.evaluate((id) => Boolean((window as any).Konva?.stages[0]?.findOne('#' + id)), cone.id))
      .toBe(true);
    await select(cone.id);
    await checkCone(cone.id);
    for (const rotation of [37, 90, 210]) {
      await op('drawing.update', { id: cone.id, patch: { rotation } });
      await expect
        .poll(() =>
          page.evaluate(
            (id) =>
              (window as any).Konva.stages[0]
                .findOne('#' + id)
                .findOne('.ruler-shape')
                .rotation(),
            cone.id,
          ),
        )
        .toBe(rotation);
      await checkCone(cone.id);
    }
    const empty = await mapPoint(1050, 620);
    await page.mouse.move(empty.x, empty.y);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => page.evaluate(() => (window as any).Konva.stages[0].scaleX())).toBeLessThan(1);
    await checkCone(cone.id);
    await page.screenshot({ path: testInfo.outputPath('cone-selection.png') });
    await page.reload();
    await expect
      .poll(() => page.evaluate((id) => Boolean((window as any).Konva?.stages[0]?.findOne('#' + id)), cone.id))
      .toBe(true);
    await select(cone.id);
    await checkCone(cone.id);
    for (const shape of ['LINE', 'CIRCLE', 'SQUARE']) {
      const drawing = await op('drawing.add', {
        mapId: map.id,
        kind: 'RULER',
        data: { shape, distance: 5, x: 950, y: 450 },
      });
      await expect
        .poll(() => page.evaluate((id) => Boolean((window as any).Konva?.stages[0]?.findOne('#' + id)), drawing.id))
        .toBe(true);
      await select(drawing.id);
      expect(
        await page.evaluate((id) => {
          const group = (window as any).Konva.stages[0].findOne('#' + id);
          const body = group.findOne('.ruler-shape').getClientRect({ relativeTo: group });
          const box = group.findOne('.ruler-selection-box');
          const scale = group.getStage().scaleX();
          return (
            Math.abs(box.width() - body.width - 16 / scale) < 0.1 &&
            Math.abs(box.height() - body.height - 16 / scale) < 0.1
          );
        }, drawing.id),
      ).toBe(true);
    }
    await select(cone.id);
    const remove = await page.evaluate((id) => {
      const stage = (window as any).Konva.stages[0];
      const point = stage
        .findOne('#' + id)
        .findOne('.ruler-delete')
        .getAbsolutePosition();
      const box = stage.container().getBoundingClientRect();
      return { x: point.x + box.left, y: point.y + box.top };
    }, cone.id);
    await page.mouse.click(remove.x, remove.y);
    await expect
      .poll(async () => (await snapshot()).drawings.some((drawing: any) => drawing.id === cone.id))
      .toBe(false);
  } finally {
    if (roomId) expect((await context.request.delete(`${api}/rooms/${roomId}`)).ok()).toBe(true);
    if (userId) await db.user.deleteMany({ where: { id: userId, username } });
    await db.$disconnect();
  }
});
