import { expect, it } from 'vitest';
import type { Snapshot } from '../api';
import { inventoryDropHint } from './inventory-drag-feedback';

const sword = { id: 'sword', kind: '装备', compatibleSlots: ['主手'] };
const hero = {
  id: 'hero',
  ownerId: 'gm',
  inventoryVisible: true,
  inventorySlots: 2,
  inventory: [
    { id: 'entry', position: 0, item: sword },
    { id: 'other', position: 1, item: sword },
  ],
  equipment: [],
};
const snap = {
  room: { id: 'room' },
  members: [{ userId: 'gm', role: 'GM' }],
  characters: [hero],
  items: [sword],
} as unknown as Snapshot;
const drag = { roomId: 'room', characterId: 'hero', entryId: 'entry' };
it('distinguishes inventory swaps, occupied incoming slots and incompatible equipment', () => {
  expect(inventoryDropHint(snap, 'gm', hero, drag, 1)).toEqual({ allowed: true, label: '交换两个格子' });
  expect(inventoryDropHint(snap, 'gm', hero, drag, 0)?.allowed).toBe(false);
  expect(inventoryDropHint(snap, 'gm', hero, drag, undefined, '主手')?.allowed).toBe(true);
  expect(inventoryDropHint(snap, 'gm', hero, drag, undefined, '头部')?.allowed).toBe(false);
  expect(inventoryDropHint(snap, 'gm', hero, { ...drag, sourceSlot: '主手' }, 1)?.allowed).toBe(false);
});
it('does not preview unavailable or foreign-room items as legal targets', () => {
  expect(inventoryDropHint(snap, 'gm', hero, { ...drag, roomId: 'other' }, 1)?.allowed).toBe(false);
  expect(inventoryDropHint(snap, 'gm', hero, { ...drag, entryId: 'missing' }, 1)?.allowed).toBe(false);
  expect(inventoryDropHint(snap, 'gm', hero, null, 1)).toBeNull();
});
it('allows unequipping into a full backpack when an existing stack already reserves the destination cell', () => {
  const stacked = {
    ...hero,
    inventory: [{ ...hero.inventory[0], quantity: 2 }],
    inventorySlots: 1,
    equipment: [{ id: 'worn', entryId: 'entry', slot: '主手' }],
  };
  const state = { ...snap, characters: [stacked] } as unknown as Snapshot;
  const equipped = { ...drag, sourceSlot: '主手' };
  expect(inventoryDropHint(state, 'gm', stacked, equipped, 0)).toEqual({
    allowed: true,
    label: '卸下并合并到原物品格',
  });
  expect(inventoryDropHint(state, 'gm', stacked, equipped)?.allowed).toBe(true);
  const single = {
    ...stacked,
    inventory: [
      { ...stacked.inventory[0], quantity: 1, position: -2 },
      { ...hero.inventory[1], quantity: 1, position: 0 },
    ],
  };
  expect(
    inventoryDropHint({ ...snap, characters: [single] } as unknown as Snapshot, 'gm', single, equipped)?.allowed,
  ).toBe(false);
});
