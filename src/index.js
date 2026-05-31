import chokidar from 'chokidar';
import path from 'path';
import 'dotenv/config';
import { organizeFile, moveFile } from './organizer.js';
import { logger } from './logger.js';

const WATCH_PATH = process.env.WATCH_PATH;
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!WATCH_PATH) {
  logger.error('WATCH_PATH is not set in .env');
  process.exit(1);
}

if (!process.env.VERCEL_AI_GATEWAY_TOKEN) {
  logger.error('VERCEL_AI_GATEWAY_TOKEN is not set in .env');
  process.exit(1);
}

logger.info(`Starting Buster Sword NAS agent`);
logger.info(`Watching: ${WATCH_PATH}`);
logger.info(`Mode: ${DRY_RUN ? 'DRY RUN (no files will be moved)' : 'LIVE'}`);

const watcher = chokidar.watch(WATCH_PATH, {
  ignoreInitial: true,       // Don't process files already on the drive
  awaitWriteFinish: {
    stabilityThreshold: 3000, // Wait 3s after file stops changing (handles slow copies)
    pollInterval: 500,
  },
  depth: 0,                  // Only watch root of the drive, not subfolders
});

watcher.on('add', async (filePath) => {
  // Only process PDFs
  if (path.extname(filePath).toLowerCase() !== '.pdf') {
    logger.info(`Skipping non-PDF file: ${path.basename(filePath)}`);
    return;
  }

  try {
    const result = await organizeFile(filePath, WATCH_PATH);

    logger.info(`AI decision for "${path.basename(filePath)}":`);
    logger.info(`  → Folder: ${result.folder} ${result.isNewFolder ? '(new)' : '(existing)'}`);
    logger.info(`  → Rename: ${result.rename}`);
    logger.info(`  → Reason: ${result.reason}`);

    if (DRY_RUN) {
      logger.warn(`DRY RUN — file not moved`);
      return;
    }

    const finalPath = moveFile(filePath, WATCH_PATH, result.folder, result.rename);
    logger.success(`Moved to: ${finalPath}`);

  } catch (err) {
    logger.error(`Failed to organize ${path.basename(filePath)}`, err);
  }
});

watcher.on('error', (err) => logger.error('Watcher error', err));

process.on('SIGINT', () => {
  logger.info('Shutting down...');
  watcher.close();
  process.exit(0);
});