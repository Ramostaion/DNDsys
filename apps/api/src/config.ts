import { resolveUploadDir } from './storage.js';
import { resolve } from 'node:path';

export type ApiConfig = ReturnType<typeof readConfig>;

/** Read once at startup; HTTP and Socket.IO use the same origin and session settings. */
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须为 1–65535 的整数');
  const url = new URL(env.WEB_ORIGIN || 'http://localhost:5242');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('WEB_ORIGIN 必须是完整的 HTTP 或 HTTPS 访问源，不含路径');
  const secret = env.JWT_SECRET || 'development-secret-replace-before-deployment';
  if (env.NODE_ENV === 'production' && (!env.JWT_SECRET || secret.length < 32))
    throw new Error('生产环境需要至少 32 字符的 JWT_SECRET');
  return {
    port,
    host: env.HOST || '0.0.0.0',
    origin: url.origin,
    secret,
    secureCookie: url.protocol === 'https:',
    uploadDir: resolveUploadDir(env),
    webDir: env.WEB_STATIC_DIR
      ? resolve(env.WEB_STATIC_DIR)
      : env.NODE_ENV === 'production'
        ? resolve('../web/dist')
        : undefined,
    imageThreads: integerSetting(env.DND_IMAGE_THREADS, 2, 1, 12, 'DND_IMAGE_THREADS'),
    imageCacheMb: integerSetting(env.DND_IMAGE_CACHE_MB, 128, 0, 1024, 'DND_IMAGE_CACHE_MB'),
  };
}

function integerSetting(value: string | undefined, fallback: number, min: number, max: number, name: string) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${name} 必须为 ${min}–${max} 的整数`);
  return number;
}
