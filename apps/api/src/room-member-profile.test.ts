import { expect, it } from 'vitest';
import { roomProfileInput } from './room-member-profile.js';

it('房间内名称裁剪空格，空值恢复账号名，允许中文、空格和 emoji', () => {
  expect(roomProfileInput.parse({ displayName: '  守秘人 · 阿林 🐉  ' })).toEqual({ displayName: '守秘人 · 阿林 🐉' });
  expect(roomProfileInput.parse({ displayName: '   ' })).toEqual({ displayName: '' });
});

it('拒绝超长、控制字符、无效类型及伪造其他成员或权限字段', () => {
  for (const value of [
    { displayName: 'a'.repeat(31) },
    { displayName: '甲\n乙' },
    { displayName: '甲\u0000乙' },
    { displayName: null },
    { displayName: '守秘人', userId: 'other' },
    { displayName: '守秘人', role: 'GM' },
  ])
    expect(roomProfileInput.safeParse(value).success).toBe(false);
});
