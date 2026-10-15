import { describe, it, expect } from 'vitest';
import { readConfig } from './config.js';

describe('服务器配置', () => {
  const production = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) };
  it('内网 HTTP 与反向代理 HTTPS 使用各自可工作的登录 Cookie', () => {
    expect(readConfig({ ...production, WEB_ORIGIN: 'http://192.168.1.8:5173/' })).toMatchObject({
      origin: 'http://192.168.1.8:5173',
      secureCookie: false,
      host: '0.0.0.0',
    });
    expect(readConfig({ ...production, WEB_ORIGIN: 'https://table.example.com' }).secureCookie).toBe(true);
  });
  it('错误端口、访问路径及生产密钥在监听前给出配置错误', () => {
    for (const PORT of ['0', '65536', '3001.5', 'abc']) expect(() => readConfig({ PORT })).toThrow('PORT');
    expect(() => readConfig({ WEB_ORIGIN: 'https://example.com/room' })).toThrow('WEB_ORIGIN');
    expect(() => readConfig({ WEB_ORIGIN: 'file:///tmp/table' })).toThrow('WEB_ORIGIN');
    expect(() => readConfig({ NODE_ENV: 'production', JWT_SECRET: 'short' })).toThrow('JWT_SECRET');
  });
  it('5600G 图片处理使用受控的并行和缓存，正式网页位置可配置', () => {
    expect(readConfig()).toMatchObject({ imageThreads: 2, imageCacheMb: 128 });
    expect(
      readConfig({ WEB_STATIC_DIR: 'custom-web', DND_IMAGE_THREADS: '4', DND_IMAGE_CACHE_MB: '256' }),
    ).toMatchObject({ imageThreads: 4, imageCacheMb: 256 });
    expect(() => readConfig({ DND_IMAGE_THREADS: '0' })).toThrow('DND_IMAGE_THREADS');
    expect(() => readConfig({ DND_IMAGE_CACHE_MB: '-1' })).toThrow('DND_IMAGE_CACHE_MB');
  });
});
