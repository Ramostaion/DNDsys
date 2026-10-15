import { api } from './server-address';
import { expect, test, type BrowserContext } from '@playwright/test';

async function openDice(context: BrowserContext) {
  const login = await context.request.post(api + '/auth/login', {
    data: { username: 'demo-gm', password: 'demo12345' },
  });
  expect(login.ok()).toBe(true);
  const rooms = await (await context.request.get(api + '/rooms')).json();
  expect(rooms.length).toBeGreaterThan(0);
  const page = await context.newPage();
  await page.goto(`/rooms/${rooms[0].id}`);
  await page.locator('.game-rail').getByRole('button', { name: '骰子' }).click();
  await expect(page.locator('.window')).toBeVisible();
  return page;
}

test('浮窗有入场动效，系统减少动效时关闭', async ({ browser }) => {
  const regular = await browser.newContext();
  const reduced = await browser.newContext({ reducedMotion: 'reduce' });
  try {
    const regularPage = await openDice(regular);
    expect(await regularPage.locator('.window').evaluate((element) => getComputedStyle(element).animationName)).toBe(
      'window-arrive',
    );

    const reducedPage = await openDice(reduced);
    expect(await reducedPage.locator('.window').evaluate((element) => getComputedStyle(element).animationName)).toBe(
      'none',
    );
  } finally {
    await Promise.all([regular.close(), reduced.close()]);
  }
});
