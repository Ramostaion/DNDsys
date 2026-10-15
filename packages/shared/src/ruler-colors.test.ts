import { describe, it, expect } from 'vitest';
import { rulerAuthorColors } from './ruler-colors';

describe('量尺创建者颜色', () => {
  const members = Array.from({ length: 9 }, (_, index) => ({
    userId: `user-${index}`,
    joinedAt: `2026-10-13T12:00:0${index}.000Z`,
  }));
  it('熟人局八玩家加 GM 颜色各不相同，各端乱序快照仍一致', () => {
    const colors = rulerAuthorColors(members, []);
    expect(new Set(colors.values()).size).toBe(9);
    expect(rulerAuthorColors([...members].reverse(), [])).toEqual(colors);
  });
  it('保存的颜色在成员离开或新增后保持，旧量尺与重复旧色仍可区分', () => {
    const drawings = [
      { authorId: 'user-0', kind: 'RULER', data: { color: '#FF8DA8' } },
      { authorId: 'left-user', kind: 'RULER', data: { color: '#70def4' } },
      { authorId: 'user-1', kind: 'RULER', data: { color: '#70def4' } },
      { authorId: 'legacy', kind: 'RULER', data: {} },
    ];
    const colors = rulerAuthorColors(members.slice(0, 2), drawings);
    expect(colors.get('user-0')).toBe('#ff8da8');
    expect(colors.get('left-user')).toBe('#70def4');
    expect(new Set(colors.values()).size).toBe(colors.size);
    expect(rulerAuthorColors(members.slice(1, 4), drawings).get('user-0')).toBe('#ff8da8');
  });
});
