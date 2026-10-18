import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EQUIPMENT_SLOTS,
  equipmentFitsSlot,
  isWearable,
  normalizeEquipmentSlots,
  equipmentAtSlot,
  equipmentConflicts,
} from './equipment.js';
describe('装备部位兼容', () => {
  it('默认主副手、六个衣甲部位与四个饰品栏，支持装备和饰品', () => {
    expect(DEFAULT_EQUIPMENT_SLOTS).toEqual([
      '主手',
      '副手',
      '头部',
      '胸部',
      '背包',
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
    expect(isWearable('背包')).toBe(true);
    expect(equipmentFitsSlot(['胸部'], '背包', '背包')).toBe(true);
    expect(equipmentFitsSlot(['胸部'], '胸部', '背包')).toBe(false);
    expect(equipmentFitsSlot([], '背包', '装备')).toBe(false);
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
    expect(equipmentFitsSlot(['主手'], '手部')).toBe(false);
    expect(equipmentFitsSlot(['副手'], '手部')).toBe(false);
  });
  it('解析中英文分隔符并去除空格、空项与重复项', () => {
    expect(normalizeEquipmentSlots([' 主手，副手 ', '头部, 胸部', '主手', ''])).toEqual([
      '主手',
      '副手',
      '头部',
      '胸部',
    ]);
    expect(equipmentFitsSlot('主手，副手', '副手')).toBe(true);
    expect(equipmentFitsSlot('主手，副手', '手部')).toBe(false);
  });
  it('双手武器仅放主副手，以同一个实例保留两手、替换任一手都冲突', () => {
    expect(isWearable('双手武器')).toBe(true);
    for (const slot of DEFAULT_EQUIPMENT_SLOTS)
      expect(equipmentFitsSlot([], slot, '双手武器')).toBe(['主手', '副手'].includes(slot));
    const equipment = [{ id: 'worn', slot: '副手', entryId: 'weapon' }];
    const inventory = [{ id: 'weapon', item: { kind: '双手武器' } }];
    expect(equipmentAtSlot(equipment, inventory, '主手')).toBe(equipment[0]);
    expect(equipmentAtSlot(equipment, inventory, '副手')).toBe(equipment[0]);
    expect(equipmentConflicts(equipment, inventory, '主手', '装备')).toEqual(equipment);
    expect(
      equipmentConflicts(
        [
          { id: 'a', slot: '主手', entryId: 'x' },
          { id: 'b', slot: '副手', entryId: 'y' },
        ],
        [],
        '副手',
        '双手武器',
      ),
    ).toHaveLength(2);
  });
});
