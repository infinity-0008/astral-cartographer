import 'dotenv/config';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

async function main() {
  await fs.mkdir(config.cacheDir, { recursive: true });
  await fs.mkdir(config.tempDir, { recursive: true });
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
  logger.info('Connected to MongoDB');
  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info(`Astral Cartographer API listening on port ${config.port}`);
  });

  const shutdown = async signal => {
    logger.info(`Received ${signal}; shutting down.`);
    server.close(async () => {
      await mongoose.disconnect().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(error => {
  logger.error('Server startup failed', error.message);
  process.exit(1);
});
