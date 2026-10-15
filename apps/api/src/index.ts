import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { readConfig } from './config.js';
import { startServer } from './bootstrap.js';

const db = new PrismaClient();
try {
  const runtime = await startServer(db, readConfig());
  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log('Stopping DND API (' + signal + ')…');
    const deadline = setTimeout(() => {
      console.error('Shutdown timed out');
      process.exit(1);
    }, 15_000);
    deadline.unref();
    void runtime
      .close()
      .then(() => {
        clearTimeout(deadline);
        process.exit(0);
      })
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
} catch (error) {
  console.error('DND API startup failed:', error instanceof Error ? error.message : error);
  await db.$disconnect();
  process.exit(1);
}
