import { describe, it, expect } from 'vitest';
import { canViewCharacterTag, sortCharacterTags, safeTagLink } from './character-tags.js';
describe('角色标签', () => {
  it('私密与所属玩家可见范围按身份过滤', () => {
    for (const role of [false, true]) expect(canViewCharacterTag('GM_ONLY', false, role)).toBe(false);
    expect(canViewCharacterTag('GM_ONLY', true, false)).toBe(true);
    expect(canViewCharacterTag('OWNER', false, true)).toBe(true);
    expect(canViewCharacterTag('OWNER', false, false)).toBe(false);
    expect(canViewCharacterTag('PUBLIC', false, false)).toBe(true);
    expect(canViewCharacterTag('UNKNOWN', false, true)).toBe(false);
  });
  it('稳定排序不改变原数组', () => {
    const tags = [
      { id: 'b', priority: 1, sortOrder: 0 },
      { id: 'a', priority: 1, sortOrder: 0 },
      { id: 'c', priority: 2, sortOrder: 1 },
      { id: 'd', priority: 1, sortOrder: -1 },
    ];
    expect(sortCharacterTags(tags).map((t) => t.id)).toEqual(['c', 'd', 'a', 'b']);
    expect(tags[0].id).toBe('b');
  });
  it('备注链接不允许脚本或本地资源', () => {
    for (const href of ['javascript:alert(1)', 'data:text/html,test', 'file:///test', '/private'])
      expect(safeTagLink(href)).toBeUndefined();
    expect(safeTagLink('https://example.com/notes')).toBe('https://example.com/notes');
  });
});
