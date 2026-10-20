import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Piscina from 'piscina';

const here = path.dirname(fileURLToPath(import.meta.url));
const maxThreads = Math.max(1, Math.min(8, os.cpus().length - 1));
let pool;
export function getParsePool() {
  if (!pool) pool = new Piscina({ filename: path.join(here, 'parseWorker.js'), minThreads: 1, maxThreads });
  return pool;
}
export async function closeParsePool() {
  if (pool) { await pool.destroy(); pool = undefined; }
}
