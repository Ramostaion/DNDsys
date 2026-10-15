import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import type { PrismaClient } from '@prisma/client';
import type { createRoomAccess } from './access.js';
import type { createAuth } from './auth.js';

export function createRealtime(
  server: HttpServer,
  db: PrismaClient,
  origin: string,
  verify: ReturnType<typeof createAuth>['verify'],
  member: ReturnType<typeof createRoomAccess>,
) {
  const io = new Server(server, { cors: { origin, credentials: true } });
  const presence = new Map<string, number>();
  function presenceChange(roomId: string, userId: string, delta: number) {
    const key = `${roomId}:${userId}`,
      count = Math.max(0, (presence.get(key) || 0) + delta);
    if (count) presence.set(key, count);
    else presence.delete(key);
    io.to(roomId).emit('presence', { userId, online: count > 0 });
  }

  function emit(roomId: string, event: string, data: unknown) {
    io.to(roomId).emit('change', { event, data, at: Date.now() });
  }
  function emitPrivate(roomId: string, event: string, data: unknown, userId: string) {
    io.to(`${roomId}:gm`).to(`user:${userId}`).emit('change', { event, data, at: Date.now() });
  }

  io.use(async (socket, next) => {
    try {
      const cookie = socket.handshake.headers.cookie || '';
      const match = /(?:^|;\s*)dnd_session=([^;]+)/.exec(cookie);
      const user = verify(match?.[1]);
      if (!user) throw new Error('未登录');
      const saved = await db.user.findUnique({ where: { id: user.id }, select: { sessionVersion: true } });
      if (!saved || saved.sessionVersion !== (user.v ?? 0)) throw new Error('会话已失效');
      socket.data.user = user;
      next();
    } catch (e) {
      next(e as Error);
    }
  });
  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.user.id}`);
    socket.on('room:join', async (roomId: string, ack?: (x: unknown) => void) => {
      try {
        const m = await member(roomId, socket.data.user.id);
        if (!socket.rooms.has(roomId)) {
          socket.join(roomId);
          if (m.role === 'GM') socket.join(`${roomId}:gm`);
          presenceChange(roomId, socket.data.user.id, 1);
        }
        ack?.({
          ok: true,
          onlineUserIds: [...presence.keys()]
            .filter((k) => k.startsWith(`${roomId}:`))
            .map((k) => k.slice(roomId.length + 1)),
        });
      } catch (e) {
        ack?.({ error: (e as Error).message });
      }
    });
    socket.on('room:leave', (roomId: string) => {
      if (socket.rooms.has(roomId)) {
        socket.leave(roomId);
        socket.leave(`${roomId}:gm`);
        presenceChange(roomId, socket.data.user.id, -1);
      }
    });
    socket.on('disconnecting', () => {
      for (const roomId of socket.rooms)
        if (roomId !== socket.id && !roomId.includes(':')) presenceChange(roomId, socket.data.user.id, -1);
    });
  });

  async function kick(roomId: string, userId: string) {
    for (const socket of await io.in(roomId).fetchSockets())
      if (socket.data.user?.id === userId) {
        socket.emit('kicked', { roomId });
        if (socket.rooms.has(roomId)) {
          socket.leave(roomId);
          socket.leave(`${roomId}:gm`);
          presenceChange(roomId, userId, -1);
        }
      }
  }
  const invalidateUser = (userId: string) => io.in(`user:${userId}`).disconnectSockets(true);
  const roomDeleted = (roomId: string) => {
    io.to(roomId).emit('room:deleted', { roomId });
    io.in(roomId).socketsLeave([roomId, `${roomId}:gm`]);
    for (const key of presence.keys()) if (key.startsWith(`${roomId}:`)) presence.delete(key);
  };
  return { io, emit, emitPrivate, kick, invalidateUser, roomDeleted };
}
