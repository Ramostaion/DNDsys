import type express from 'express';
import { static as serveStatic } from 'express';
import { existsSync } from 'node:fs';
import { resolve, join, sep, extname } from 'node:path';

/** Serve one production origin; private uploads keep their existing authenticated routes. */
export function registerWebRoutes(app: express.Express, directory: string) {
  const index = join(directory, 'index.html'),
    assets = resolve(directory, 'assets');
  if (!existsSync(index)) throw new Error('缺少正式网页构建，请先运行 pnpm build 或使用一键启动');
  app.use('/assets', (req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || req.headers.range) return next();
    let file: string;
    try {
      file = resolve(assets, '.' + decodeURIComponent(req.path));
    } catch {
      return next();
    }
    if (!file.startsWith(assets + sep)) return next();
    res.vary('Accept-Encoding');
    const encoding = req.acceptsEncodings('br', 'gzip', 'identity');
    const compressed = encoding === 'br' ? file + '.br' : encoding === 'gzip' ? file + '.gz' : undefined;
    if (!compressed || !existsSync(compressed)) return next();
    res.type(extname(file)).set('Content-Encoding', encoding as string);
    res.sendFile(compressed, { maxAge: '1y', immutable: true }, (error) => {
      if (error) next(error);
    });
  });
  app.use('/assets', serveStatic(assets, { maxAge: '1y', immutable: true, index: false }));
  app.use(
    serveStatic(directory, {
      index: false,
      maxAge: '1h',
      setHeaders: (res, path) => {
        if (path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get(/^\/(?!api(?:\/|$)|uploads(?:\/|$)|socket\.io(?:\/|$)|assets(?:\/|$)).*/, (_req, res) => {
    res.sendFile(index, { headers: { 'Cache-Control': 'no-cache' } });
  });
}
