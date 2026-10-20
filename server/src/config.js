import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');
const resolveFromServer = (value, fallback) => path.resolve(serverRoot, value || fallback);

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 4000),
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/astral_cartographer',
  cacheDir: resolveFromServer(process.env.CACHE_DIR, 'cache'),
  tempDir: resolveFromServer(process.env.TEMP_DIR, 'tmp'),
  maxRepoBytes: Number(process.env.MAX_REPO_MB || 80) * 1024 * 1024,
  maxZipBytes: Number(process.env.MAX_ZIP_MB || 25) * 1024 * 1024,
  maxFiles: Number(process.env.MAX_FILES || 12000),
  maxSourceFileBytes: Number(process.env.MAX_SOURCE_FILE_MB || 1) * 1024 * 1024,
  cloneTimeoutMs: Number(process.env.CLONE_TIMEOUT_MS || 120000),
  analysisTimeoutMs: Number(process.env.ANALYSIS_TIMEOUT_MS || 240000),
  historyDepth: Number(process.env.HISTORY_DEPTH || 100),
  githubToken: process.env.GITHUB_TOKEN || ''
};
