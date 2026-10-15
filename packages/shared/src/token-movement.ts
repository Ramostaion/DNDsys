/** Transient presentation of a committed move; coordinates are map world coordinates. */
export type TokenMoveEvent = {
  eventId: string;
  roomId: string;
  tokenId: string;
  characterId: string;
  mapId: string;
  actorId: string;
  version: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  completedAt: number;
  serverNow: number;
};
