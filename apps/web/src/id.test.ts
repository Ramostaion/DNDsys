import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { createId } from './id';

afterEach(() => vi.unstubAllGlobals());
describe('HTTP/HTTPS 操作编号', () => {
  it('支持原生 UUID 时保留浏览器实现及其调用上下文', () => {
    const crypto = {
      randomUUID: vi.fn(function (this: unknown) {
        expect(this).toBe(crypto);
        return 'native-id';
      }),
      getRandomValues: vi.fn(),
    };
    vi.stubGlobal('crypto', crypto);
    expect(createId()).toBe('native-id');
    expect(crypto.getRandomValues).not.toHaveBeenCalled();
  });
  it('HTTP 缺少 randomUUID 时生成正确的 UUID v4 版本和变体', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(255) });
    expect(createId()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff');
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0) });
    expect(createId()).toBe('00000000-0000-4000-8000-000000000000');
  });
  it('实际随机字节路径产生格式一致的独立编号', () => {
    vi.stubGlobal('crypto', { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
    const ids = Array.from({ length: 256 }, createId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('浏览器连随机字节接口也没有时给出明确错误', () => {
    vi.stubGlobal('crypto', undefined);
    expect(createId).toThrow('浏览器不支持随机编号');
  });
});
