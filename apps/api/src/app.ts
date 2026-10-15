import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createServer } from 'node:http';
import type { PrismaClient } from '@prisma/client';
import type { ApiConfig } from './config.js';
import { createAuth, registerAuthRoutes } from './auth.js';
import { createRoomAccess } from './access.js';
import { createRealtime } from './realtime.js';
import { registerRoomRoutes } from './routes/rooms.js';
import { registerUploadRoutes } from './routes/uploads.js';
import { registerOperations } from './operations.js';
import { registerPresentation } from './presentation.js';
import { registerPrivateClues } from './private-clues.js';
import { errorHandler } from './error-handler.js';
import { registerWebRoutes } from './web-static.js';

/** Compose modules without opening a port, connecting the database or modifying stored data. */
export function createApplication(db: PrismaClient, config: ApiConfig) {
  const app = express(),
    server = createServer(app);
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  const session = createAuth(db, config),
    member = createRoomAccess(db);
  const realtime = createRealtime(server, db, config.origin, session.verify, member);
  const context = { db, auth: session.auth, member, emit: realtime.emit };
  let stopping = false;
  app.use(cors({ origin: config.origin, credentials: true }), express.json({ limit: '1mb' }), cookieParser());
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.once('finish', () => {
      if (stopping && !server.listening) server.closeIdleConnections();
    });
    if (stopping && !['/api/live', '/api/health'].includes(req.path))
      return res.status(503).json({ error: '后台正在停止，请稍后重试' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== config.origin)
      return res.status(403).json({ error: '请求来源不被允许' });
    next();
  });
  app.get('/api/live', (_req, res) => res.json({ ok: true }));
  app.get('/api/health', async (_req, res) => {
    if (stopping) return res.status(503).json({ ok: false });
    try {
      await db.$queryRaw`SELECT 1`;
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false, error: '数据库暂时不可用' });
    }
  });
  registerAuthRoutes(app, db, session, realtime.invalidateUser);
  registerRoomRoutes(app, context, realtime.kick, realtime.roomDeleted);
  registerUploadRoutes(app, context);
  registerOperations(app, db, session.auth, realtime.emit, realtime.emitPrivate);
  registerPresentation(app, db, session.auth, (roomId, revision) =>
    realtime.io.to(roomId).emit('presentation.changed', { roomId, revision }),
  );
  registerPrivateClues(app, db, session.auth, (roomId, userIds, kind) => {
    for (const userId of new Set(userIds))
      realtime.io.to(`user:${userId}`).emit('privateClue.changed', { roomId, kind });
  });
  if (config.webDir) registerWebRoutes(app, config.webDir);
  app.use(errorHandler);
  return {
    app,
    server,
    io: realtime.io,
    beginShutdown: () => {
      stopping = true;
    },
  };
}
