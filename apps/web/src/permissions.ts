import type { Snapshot } from './api';
import {
  canControlCharacter,
  canViewCharacterInventory,
  canExchangeWithFallenCharacter,
  characterCurrentHealth,
  memberCan,
  type RoomCapability,
} from '@dnd/shared';

export type { RoomCapability as Capability } from '@dnd/shared';
export function canCapability(snap: Snapshot, userId: string, capability: RoomCapability) {
  return memberCan(
    snap.room,
    snap.members.find((member) => member.userId === userId),
    capability,
  );
}
export function canEditBasics(snap: Snapshot, userId: string, character: any) {
  return canEditCharacter(snap, userId, character) && canCapability(snap, userId, 'characterBasics');
}
export function canEditCharacter(snap: Snapshot, userId: string, character: any) {
  return canControlCharacter(
    snap.members.find((member) => member.userId === userId),
    character,
    userId,
  );
}
export function canViewInventory(snap: Snapshot, userId: string, character: any) {
  const member = snap.members.find((member) => member.userId === userId);
  if (typeof character.inventoryVisible === 'boolean') return Boolean(member) && character.inventoryVisible;
  return canViewCharacterInventory(
    member,
    { ...character, healthCurrent: characterCurrentHealth(snap.room, character) },
    userId,
    canCapability(snap, userId, 'viewOtherInventories'),
  );
}

export function canTransferInventory(snap: Snapshot, userId: string, source: any, target: any) {
  const member = snap.members.find((member) => member.userId === userId);
  if (!canViewInventory(snap, userId, source) || !canViewInventory(snap, userId, target)) return false;
  const access = (c: any) => ({
    ...c,
    healthCurrent: c.inventoryLootable === true ? 0 : characterCurrentHealth(snap.room, c),
  });
  return (
    canExchangeWithFallenCharacter(member, access(source), access(target), userId) ||
    (canEditCharacter(snap, userId, source) && canEditCharacter(snap, userId, target))
  );
}
