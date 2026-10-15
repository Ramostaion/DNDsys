import type express from 'express';

export const fail = (status: number, message: string): never => {
  throw Object.assign(new Error(message), { status });
};
export const asyncRoute =
  (handler: express.RequestHandler): express.RequestHandler =>
  (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
