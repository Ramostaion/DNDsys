import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { removeRoomUploads } from './room-lifecycle.js';

it('房间图片清理只删除指定子目录，保留其他房间和旧共享文件，重复清理安全', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dnd-room-delete-'));
  try {
    await mkdir(join(directory, 'room1', 'private-clues'), { recursive: true });
    await mkdir(join(directory, 'room2'));
    await writeFile(join(directory, 'room1', 'private-clues', 'image.webp'), 'removed');
    await writeFile(join(directory, 'room2', 'image.webp'), 'kept');
    await writeFile(join(directory, 'shared.webp'), 'legacy');
    await removeRoomUploads('room1', directory);
    await expect(access(join(directory, 'room1'))).rejects.toThrow();
    expect(await readFile(join(directory, 'room2', 'image.webp'), 'utf8')).toBe('kept');
    expect(await readFile(join(directory, 'shared.webp'), 'utf8')).toBe('legacy');
    await removeRoomUploads('room1', directory);
    for (const id of ['', '..', '../room2', '/room2', 'room2/image.webp'])
      await expect(removeRoomUploads(id, directory)).rejects.toThrow('房间图片目录无效');
    expect(await readFile(join(directory, 'room2', 'image.webp'), 'utf8')).toBe('kept');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
