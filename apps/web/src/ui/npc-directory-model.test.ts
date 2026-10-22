import { describe, expect, it } from 'vitest';
import { folderChain, folderPath, folderDescendants } from './npc-directory-model';
const folders = [
  { id: 'a', parentId: null, name: '王都', position: 0 },
  { id: 'b', parentId: 'a', name: '卫队', position: 0 },
  { id: 'c', parentId: 'b', name: '精锐', position: 0 },
  { id: 'd', parentId: null, name: '荒野', position: 1 },
];
describe('NPC目录导航', () => {
  it('完整路径从根到叶，未分类独立', () => {
    expect(folderChain(folders, 'c').map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(folderPath(folders, 'c')).toBe('王都 / 卫队 / 精锐');
    expect(folderPath(folders, null)).toBe('未分类');
  });
  it('后代集合不包含其他分支', () => {
    expect([...folderDescendants(folders, 'a')]).toEqual(['a', 'b', 'c']);
    expect([...folderDescendants(folders, 'd')]).toEqual(['d']);
  });
  it('删除恢复和异常循环不会无限遍历', () => {
    expect(folderChain(folders, 'missing')).toEqual([]);
    const cycle = [{ ...folders[0], parentId: 'b' }, folders[1]];
    expect(folderChain(cycle, 'a')).toHaveLength(2);
    expect(folderDescendants(cycle, 'a').size).toBe(2);
  });
});
