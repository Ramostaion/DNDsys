import type express from 'express';
import type { PrismaClient } from '@prisma/client';
import type { createRoomAccess } from '../access.js';

export type RouteContext = {
  db: PrismaClient;
  auth: express.RequestHandler;
  member: ReturnType<typeof createRoomAccess>;
  emit: (roomId: string, event: string, data: unknown) => void;
};
