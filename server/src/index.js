import 'dotenv/config';
import fs from 'node:fs/promises';
import mongoose from 'mongoose';
import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

// ─── Startup ─────────────────────────────────────────────────────────────────

async function main() {
  // Ensure working directories exist before anything else
  await Promise.all([
    fs.mkdir(config.cacheDir, { recursive: true }),
    fs.mkdir(config.tempDir,  { recursive: true }),
  ]);

  // Connect to MongoDB; fail fast if unreachable within 10 s
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10_000 });
  logger.info(`Connected to MongoDB (env=${config.env})`);

  // Build Express app and bind to all interfaces (required for Render / Docker)
  const app    = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    logger.info(`Astral Cartographer API  →  http://0.0.0.0:${config.port}  [${config.env}]`);
  });

  // Catch port-in-use or other bind errors immediately
  server.on('error', err => {
    logger.error('Failed to bind server', err.message);
    process.exit(1);
  });

  // ─── Graceful Shutdown ──────────────────────────────────────────────────────

  const FORCE_EXIT_MS = 10_000;

  async function shutdown(signal) {
    logger.info(`${signal} received — shutting down gracefully`);

    // Stop accepting new connections; wait for in-flight requests to finish
    server.close(async () => {
      try {
        await mongoose.disconnect();
        logger.info('MongoDB disconnected — bye 👋');
      } catch {
        // ignore disconnect errors during shutdown
      } finally {
        process.exit(0);
      }
    });

    // Safety net: force-exit if graceful shutdown stalls
    setTimeout(() => {
      logger.warn(`Forced exit after ${FORCE_EXIT_MS / 1000}s`);
      process.exit(1);
    }, FORCE_EXIT_MS).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM')); // Render / Docker stop
  process.on('SIGINT',  () => shutdown('SIGINT'));  // Ctrl-C in terminal
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

main().catch(err => {
  logger.error('Server startup failed', err.message);
  process.exit(1);
});

