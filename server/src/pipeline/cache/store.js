import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzip, gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { config } from '../../config.js';
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export function cacheDirectory(cacheKey) { return path.join(config.cacheDir, cacheKey); }
export async function saveResult(cacheKey, result) {
  const dir = cacheDirectory(cacheKey);
  await fs.mkdir(dir, { recursive: true });
  const resultPath = path.join(dir, 'result.json.gz');
  const compressed = await gzipAsync(Buffer.from(JSON.stringify(result)), { level: 6 });
  const temporary = `${resultPath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, compressed);
  await fs.rename(temporary, resultPath);
  return { resultPath, snapshotPath: path.join(dir, 'source') };
}

export async function loadResult(resultPath) {
  if (!resultPath) return null;
  try {
    const bytes = await fs.readFile(resultPath);
    return JSON.parse((await gunzipAsync(bytes)).toString('utf8'));
  } catch { return null; }
}

export async function saveParsed(parsedCacheKey, parsed) {
  const dir = path.join(config.cacheDir, 'parse-cache');
  await fs.mkdir(dir, { recursive: true });
  const finalPath = path.join(dir, `${parsedCacheKey}.json.gz`);
  const compressed = await gzipAsync(Buffer.from(JSON.stringify(parsed)));
  const temporary = `${finalPath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, compressed);
  await fs.rename(temporary, finalPath);
}

export async function loadParsed(parsedCacheKey) {
  const file = path.join(config.cacheDir, 'parse-cache', `${parsedCacheKey}.json.gz`);
  try { return JSON.parse((await gunzipAsync(await fs.readFile(file))).toString('utf8')); }
  catch { return null; }
}

export async function evictOld(maxEntries = 30) {
  await fs.mkdir(config.cacheDir, { recursive: true });
  const entries = await fs.readdir(config.cacheDir, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'parse-cache') continue;
    const full = path.join(config.cacheDir, entry.name);
    const stat = await fs.stat(full).catch(() => null);
    if (stat) dirs.push({ path: full, mtime: stat.mtimeMs });
  }
  dirs.sort((a, b) => b.mtime - a.mtime);
  for (const old of dirs.slice(Math.max(1, maxEntries))) await fs.rm(old.path, { recursive: true, force: true });
  const parsedDir = path.join(config.cacheDir, 'parse-cache');
  const parsed = [];
  for (const entry of await fs.readdir(parsedDir, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isFile()) continue;
    const full = path.join(parsedDir, entry.name);
    const stat = await fs.stat(full).catch(() => null);
    if (stat) parsed.push({ path: full, mtime: stat.mtimeMs });
  }
  parsed.sort((a, b) => b.mtime - a.mtime);
  for (const old of parsed.slice(5000)) await fs.rm(old.path, { force: true });
}
