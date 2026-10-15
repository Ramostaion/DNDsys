import type { Prisma, Room, RoomMember } from '@prisma/client';
import type { RuleConfig } from '@dnd/shared';
export type InventoryCharacter = {
  ownerId: string | null;
  visibility: string;
  isNpc: boolean;
  currentHp?: number;
  derived?: unknown;
};
export type OperationContext = {
  tx: Prisma.TransactionClient;
  room: Room;
  member: RoomMember;
  rules: RuleConfig;
  roomId: string;
  userId: string;
  type: string;
  opId: string;
  requestedAt: number;
  p: Record<string, any>;
  createdFiles: string[];
  inventoryCharacters: Set<string>;
  inventoryEditable: (character: InventoryCharacter) => void;
};
