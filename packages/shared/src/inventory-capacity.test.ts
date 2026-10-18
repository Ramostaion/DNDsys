import { describe, expect, it } from 'vitest';
import { firstInventorySpace, inventoryCapacity } from './inventory-capacity.js';

const room = { sheetMode: true, sheetSchema: [{ fieldId: 'power', name: '力量', type: 'number', defaultValue: 15 }] };
describe('力量背包容量', () => {
  it.each([
    [15, 24],
    [16, 26],
    [17, 28],
    [14, 22],
    [10, 14],
    [3, 0],
    [0, 0],
    [14.5, 23],
  ])('力量 %s 对应 %s 格', (value, slots) => {
    expect(inventoryCapacity(room, { derived: { values: { power: value } } })).toBe(slots);
  });
  it('uses defaults and effective modifiers, rather than the raw score or ability bonus', () => {
    expect(inventoryCapacity(room, {})).toBe(24);
    expect(
      inventoryCapacity(room, { fieldValues: { power: 10 }, derived: { values: { power: 18, 力量加值: 4 } } }),
    ).toBe(30);
    expect(
      inventoryCapacity({ sheetMode: false }, { attributes: { 力量: 12 }, derived: { values: { 力量: 16 } } }),
    ).toBe(26);
  });
  it('does not invent strength in cards without the entry, and preserves explicit old capacity there', () => {
    expect(inventoryCapacity({ sheetMode: true }, { derived: { values: { 力量: 10 } } })).toBe(24);
    expect(inventoryCapacity({ sheetMode: false }, { inventorySlots: 8, derived: { values: { 力量: 10 } } })).toBe(8);
    expect(
      inventoryCapacity({ sheetMode: true, sheetSchema: [{ fieldId: 'power', name: '力量', type: 'text' }] }, {}),
    ).toBe(24);
  });
  it('recognizes stable strength IDs and avoids invalid or ambiguous numeric entries', () => {
    expect(
      inventoryCapacity(
        { sheetMode: true, sheetSchema: [{ fieldId: 'strength', name: '体能', type: 'number' }] },
        { fieldValues: { strength: 16 } },
      ),
    ).toBe(26);
    expect(inventoryCapacity(room, { derived: { values: { power: 19 }, errors: { power: 'invalid formula' } } })).toBe(
      24,
    );
    expect(inventoryCapacity(room, { fieldValues: { power: '20' } })).toBe(24);
    expect(
      inventoryCapacity(
        { sheetMode: true, sheetSchema: [room.sheetSchema[0], { ...room.sheetSchema[0], fieldId: 'other' }] },
        {},
      ),
    ).toBe(24);
  });
  it('bounds integer capacity and finds free cells without allocating by capacity', () => {
    expect(inventoryCapacity(room, { fieldValues: { power: 1e12 } })).toBe(2147483647);
    expect(firstInventorySpace(2147483647, [{ position: -2 }, { position: 0 }, { position: 1 }])).toBe(2);
    expect(firstInventorySpace(2, [{ position: 0 }, { position: 3 }])).toBeUndefined();
    expect(firstInventorySpace(0, [])).toBeUndefined();
  });
  it('adds authoritative backpack cells after base strength capacity, clamped without negative or invalid bonuses', () => {
    expect(inventoryCapacity({ sheetMode: true }, { derived: { inventoryBonus: 2 } })).toBe(26);
    expect(inventoryCapacity({ sheetMode: false }, { attributes: { 力量: 16 }, derived: { inventoryBonus: 2 } })).toBe(
      28,
    );
    expect(inventoryCapacity({ sheetMode: false }, { attributes: { 力量: 0 }, derived: { inventoryBonus: 2 } })).toBe(
      2,
    );
    expect(inventoryCapacity({}, { derived: { inventoryBonus: -2 } })).toBe(24);
    expect(inventoryCapacity({}, { derived: { inventoryBonus: '9' } })).toBe(24);
  });
});
