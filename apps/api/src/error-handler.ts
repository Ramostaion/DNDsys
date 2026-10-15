import type express from 'express';
import { z } from 'zod';
import multer from 'multer';

export const errorHandler: express.ErrorRequestHandler = (
  err: unknown,
  _req: express.Request,
  res: express.Response,
  _next: express.NextFunction,
) => {
  const e = err as Error & { status?: number; code?: string };
  if (e.code === 'DICE_COOLDOWN') {
    const cooldown = err as Error & { serverNow: number; cooldownUntil: number; remainingMs: number };
    return res.status(429).json({
      error: e.message,
      code: e.code,
      serverNow: cooldown.serverNow,
      cooldownUntil: cooldown.cooldownUntil,
      remainingMs: cooldown.remainingMs,
    });
  }
  if (e instanceof z.ZodError) return res.status(400).json({ error: e.issues.map((i) => i.message).join('；') });
  if (e instanceof multer.MulterError)
    return res
      .status(e.code === 'LIMIT_FILE_SIZE' ? 413 : 400)
      .json({ error: e.code === 'LIMIT_FILE_SIZE' ? '图片超过 10MB' : '上传文件无效' });
  if (e.code === 'P2025') return res.status(404).json({ error: '目标不存在' });
  if (e.code === 'P2034') return res.status(409).json({ error: '数据已被其他人修改，请刷新后重试' });
  if (e.code === 'P2002' || e.code === 'P2003') return res.status(409).json({ error: '数据冲突，请刷新后重试' });
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : '服务器内部错误' });
};
