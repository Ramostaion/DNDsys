import { describe, it, expect } from 'vitest';
import { itemFields, validateItemFields } from './item-fields';
describe('物品自定义项目', () => {
  it('旧 JSON 属性可阅读，系统字段不混入资料，原数据不被改写', () => {
    const data = { 防御: 3, modifiers: { hp: 2 }, 重量: 2, 来源: { 地点: '铁矿' }, 可出售: true };
    const copy = JSON.stringify(data);
    expect(itemFields(data)).toEqual([
      { name: '重量', value: 2 },
      { name: '来源', value: '{"地点":"铁矿"}' },
      { name: '可出售', value: 'true' },
    ]);
    expect(JSON.stringify(data)).toBe(copy);
  });
  it('空项目名、重复项目名和无效数值会被拒绝', () => {
    expect(() => validateItemFields([{ name: ' ', value: 2 }])).toThrow('名称');
    expect(() =>
      validateItemFields([
        { name: '重量', value: 1 },
        { name: ' 重量 ', value: 2 },
      ]),
    ).toThrow('重复');
    expect(() => validateItemFields([{ name: '重量', value: NaN }])).toThrow('无效');
    expect(
      validateItemFields([
        { name: ' 材质 ', value: '铁' },
        { name: '重量', value: 0 },
      ]),
    ).toEqual([
      { name: '材质', value: '铁' },
      { name: '重量', value: 0 },
    ]);
  });
});
