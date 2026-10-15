import { describe, it, expect } from 'vitest';
import { DEFAULT_EQUIPMENT_SLOTS, equipmentFitsSlot, isWearable } from './equipment.js';
describe('装备部位兼容', () => {
  it('默认主副手、六个衣甲部位与四个饰品栏，支持装备和饰品', () => {
    expect(DEFAULT_EQUIPMENT_SLOTS).toEqual([
      '主手',
      '副手',
      '头部',
      '胸部',
      '手臂',
      '手部',
      '腿部',
      '鞋',
      '饰品1',
      '饰品2',
      '饰品3',
      '饰品4',
    ]);
    expect(isWearable('饰品')).toBe(true);
    expect(isWearable('杂物')).toBe(false);
  });
  it('旧物品部位名称兼容新布局，明确限定的装备不能跨部位', () => {
    for (const [old, slot] of [
      ['手', '手部'],
      ['脚', '鞋'],
      ['脚踝', '鞋'],
      ['脖颈', '饰品1'],
      ['手指7', '饰品4'],
      ['饰品', '饰品2'],
    ])
      expect(equipmentFitsSlot([old], slot)).toBe(true);
    expect(equipmentFitsSlot(['头部'], '胸部')).toBe(false);
    expect(equipmentFitsSlot([], '胸部')).toBe(true);
    expect(equipmentFitsSlot(['主手'], '主手')).toBe(true);
    expect(equipmentFitsSlot(['副手'], '副手')).toBe(true);
    expect(equipmentFitsSlot(['主手'], '副手')).toBe(false);
    expect(equipmentFitsSlot(['副手'], '主手')).toBe(false);
    expect(equipmentFitsSlot(['手部'], '主手')).toBe(false);
    expect(equipmentFitsSlot(['主手'], '手部')).toBe(true);
  });
});
