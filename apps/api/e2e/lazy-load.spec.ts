import { api } from './server-address';
import { expect, test } from '@playwright/test';

test('地图模块加载失败时保留房间并提供重试入口', async ({ page, context }) => {
  const login = await context.request.post(api + '/auth/login', {
    data: { username: 'demo-gm', password: 'demo12345' },
  });
  expect(login.ok()).toBe(true);
  const rooms = await (await context.request.get(api + '/rooms')).json();
  expect(rooms.length).toBeGreaterThan(0);

  await page.route('**/src/ui/Board.tsx*', (route) => route.abort());
  await page.goto(`/rooms/${rooms[0].id}`);
  await expect(page.getByText('界面暂时无法加载')).toBeVisible();
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
  await expect(page.getByText(rooms[0].name)).toBeVisible();
});
