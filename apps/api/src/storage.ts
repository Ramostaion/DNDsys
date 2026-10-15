import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const resolveUploadDir = (env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()) =>
  resolve(cwd, env.UPLOAD_DIR || 'uploads');
export const uploadDir = resolveUploadDir();

export async function initializeStorage(directory = uploadDir) {
  await mkdir(directory, { recursive: true });
  const probe = join(directory, `.startup-${randomUUID()}`);
  try {
    await writeFile(probe, '', { flag: 'wx' });
  } catch {
    throw new Error(`图片目录不可写，请检查目录及写入权限：${directory}`);
  } finally {
    await unlink(probe).catch(() => {});
  }
}
