import type express from 'express';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { asyncRoute, fail } from './http.js';
import type { ApiConfig } from './config.js';

type RequestUser = { id: string; username: string; v?: number };
declare global {
  namespace Express {
    interface Request {
      user?: RequestUser;
    }
  }
}

export function createAuth(db: PrismaClient, config: ApiConfig) {
  const secret = config.secret;
  const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: config.secureCookie, maxAge: 7 * 86400000 };
  function tokenOf(req: express.Request) {
    return req.cookies?.dnd_session || req.headers.authorization?.replace(/^Bearer /, '');
  }
  function verify(token?: string): RequestUser | null {
    try {
      return token ? (jwt.verify(token, secret) as RequestUser) : null;
    } catch {
      return null;
    }
  }
  const auth: express.RequestHandler = (req, _res, next) => {
    const user = verify(tokenOf(req));
    if (!user) return next(Object.assign(new Error('请先登录'), { status: 401 }));
    db.user
      .findUnique({ where: { id: user.id }, select: { sessionVersion: true } })
      .then((saved) => {
        if (!saved || saved.sessionVersion !== (user.v ?? 0))
          return next(Object.assign(new Error('会话已失效，请重新登录'), { status: 401 }));
        req.user = user;
        next();
      })
      .catch(next);
  };

  const issueToken = (user: RequestUser) => jwt.sign(user, secret, { expiresIn: '7d' });
  return { auth, verify, cookieOptions, issueToken };
}
export function registerAuthRoutes(
  app: express.Express,
  db: PrismaClient,
  session: ReturnType<typeof createAuth>,
  invalidateUser: (userId: string) => void,
) {
  const { auth, cookieOptions, issueToken } = session;
  app.post(
    '/api/auth/register',
    asyncRoute(async (req, res) => {
      const input = z
        .object({ username: z.string().trim().min(3).max(30), password: z.string().min(8).max(128) })
        .parse(req.body);
      const user = await db.user
        .create({
          data: { username: input.username, passwordHash: await bcrypt.hash(input.password, 12) },
          select: { id: true, username: true, avatarUrl: true },
        })
        .catch((e) => (e.code === 'P2002' ? fail(409, '用户名已存在') : Promise.reject(e)));
      res.cookie('dnd_session', issueToken({ id: user.id, username: user.username, v: 0 }), cookieOptions).json(user);
    }),
  );
  app.post(
    '/api/auth/login',
    asyncRoute(async (req, res) => {
      const input = z.object({ username: z.string(), password: z.string() }).parse(req.body);
      const user = await db.user.findUnique({ where: { username: input.username } });
      if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) fail(401, '用户名或密码错误');
      await db.user.update({ where: { id: user!.id }, data: { lastLoginAt: new Date() } });
      res
        .cookie(
          'dnd_session',
          issueToken({ id: user!.id, username: user!.username, v: user!.sessionVersion }),
          cookieOptions,
        )
        .json({ id: user!.id, username: user!.username, avatarUrl: user!.avatarUrl });
    }),
  );
  app.post('/api/auth/logout', (_req, res) => res.clearCookie('dnd_session').json({ ok: true }));
  app.get('/api/auth/me', auth, (req, res) => res.json(req.user));
  app.post(
    '/api/auth/password',
    auth,
    asyncRoute(async (req, res) => {
      const { oldPassword, newPassword } = z
        .object({ oldPassword: z.string(), newPassword: z.string().min(8).max(128) })
        .parse(req.body);
      const user = await db.user.findUniqueOrThrow({ where: { id: req.user!.id } });
      if (!(await bcrypt.compare(oldPassword, user.passwordHash))) fail(403, '旧密码错误');
      const updated = await db.user.update({
        where: { id: user.id },
        data: { passwordHash: await bcrypt.hash(newPassword, 12), sessionVersion: { increment: 1 } },
      });
      res
        .cookie(
          'dnd_session',
          issueToken({ id: user.id, username: user.username, v: updated.sessionVersion }),
          cookieOptions,
        )
        .json({ ok: true });
      invalidateUser(user.id);
    }),
  );
}
