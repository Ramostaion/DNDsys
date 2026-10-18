import { expect, it } from 'vitest';
import { roomMemberName } from './room-member-name';

it('房间内名称优先，未设置及旧成员数据回退到账号名称', () => {
  expect(roomMemberName({ displayName: '  守秘人  ', user: { username: 'GM21' } })).toBe('守秘人');
  expect(roomMemberName({ displayName: null, user: { username: 'player21' } })).toBe('player21');
  expect(roomMemberName({ displayName: ' ', user: { username: 'player21' } })).toBe('player21');
  expect(roomMemberName({ user: { username: 'player21' } })).toBe('player21');
  expect(roomMemberName(undefined, '历史名称')).toBe('历史名称');
});
