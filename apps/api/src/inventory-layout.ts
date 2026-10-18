import type { Prisma } from '@prisma/client';
import { fail } from './http.js';
import { inventoryCapacity, firstInventorySpace } from '@dnd/shared';

// Equipped instances keep their identity and notes, but do not occupy backpack cells.
// -1 is reserved for the temporary position used when swapping two cells.
export async function arrangeInventory(tx: Prisma.TransactionClient, characterId: string) {
  const character = await tx.character.findUniqueOrThrow({
    where: { id: characterId },
    include: { room: true, inventory: { include: { equipped: true }, orderBy: { position: 'asc' } } },
  });
  const occupied = new Set(character.inventory.map((entry) => entry.position));
  for (const entry of character.inventory) {
    if (entry.quantity > entry.equipped.length || entry.position < 0) continue;
    let position = -2;
    while (occupied.has(position)) position--;
    await tx.inventoryEntry.update({ where: { id: entry.id }, data: { position, version: { increment: 1 } } });
    occupied.delete(entry.position);
    occupied.add(position);
    entry.position = position;
  }
  for (const entry of character.inventory) {
    if (entry.quantity <= entry.equipped.length || entry.position >= 0) continue;
    const position = firstInventorySpace(inventoryCapacity(character.room, character), character.inventory);
    if (position === undefined) return fail(409, '背包已满，请先腾出一格再卸下或替换装备');
    await tx.inventoryEntry.update({ where: { id: entry.id }, data: { position, version: { increment: 1 } } });
    occupied.delete(entry.position);
    occupied.add(position);
    entry.position = position;
  }
}

export function equippedPosition(entries: { position: number }[]) {
  let position = -2;
  while (entries.some((entry) => entry.position === position)) position--;
  return position;
}
