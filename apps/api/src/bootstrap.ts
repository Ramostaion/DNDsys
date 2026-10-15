import type { PrismaClient } from '@prisma/client';
import type { ApiConfig } from './config.js';
import { createApplication } from './app.js';
import { initializeStorage } from './storage.js';
import { arrangeInventory } from './inventory-layout.js';
import { refreshCharacter } from './character-values.js';
import { rulesOf } from './data.js';
import sharp from 'sharp';

export async function startServer(db: PrismaClient, config: ApiConfig) {
  sharp.concurrency(config.imageThreads);
  sharp.cache({ memory: config.imageCacheMb });
  await initializeStorage(config.uploadDir);
  await db.$connect();
  // Keep legacy equipment placement and derived values compatible after an upgrade.
  const characters = await db.character.findMany({ select: { id: true, room: { select: { rules: true } } } });
  console.log(`Preparing ${characters.length} stored characters…`);
  for (const character of characters) {
    await db.$transaction(
      async (tx) => {
        await arrangeInventory(tx, character.id);
        await refreshCharacter(tx, character.id, rulesOf(character.room.rules));
      },
      { maxWait: 10_000, timeout: 30_000 },
    );
  }
  const application = createApplication(db, config);
  try {
    await new Promise<void>((resolve, reject) => {
      application.server.once('error', reject);
      application.server.listen(config.port, config.host, () => {
        application.server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    application.io.close();
    throw error;
  }
  console.log(`DND API listening on ${config.host}:${config.port}; upload storage: ${config.uploadDir}`);
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      application.beginShutdown();
      await new Promise<void>((resolve) => application.io.close(() => resolve()));
      await db.$disconnect();
    })());
  return { ...application, close };
}
