import AdmZip from 'adm-zip';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { AppError } from '../../utils/errors.js';

const MAX_ENTRIES = config.maxFiles * 3;

function safeEntryPath(rawName) {
  const normalized = String(rawName).replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized) || normalized.includes('\0')) return null;
  const cleaned = path.posix.normalize(normalized);
  if (cleaned === '..' || cleaned.startsWith('../') || cleaned === '.') return cleaned === '.' ? '' : null;
  return cleaned;
}

export async function extractZip(buffer, destDir, limits = {}) {
  const maxFiles = limits.maxFiles || config.maxFiles;
  const maxTotalBytes = limits.maxTotalBytes || config.maxRepoBytes;
  const maxFileBytes = limits.maxFileBytes || config.maxSourceFileBytes;
  await fs.mkdir(destDir, { recursive: true });
  let zip;
  try { zip = new AdmZip(buffer); } catch { throw new AppError('The uploaded archive is not a valid ZIP file.', 400, 'INVALID_ZIP'); }
  const entries = zip.getEntries();
  if (!entries.length) throw new AppError('The uploaded ZIP is empty.', 400, 'EMPTY_ZIP');
  if (entries.length > MAX_ENTRIES) throw new AppError(`ZIP contains too many entries (limit ${MAX_ENTRIES}).`, 413, 'ZIP_ENTRY_LIMIT');
  let declaredTotal = 0;
  let sourceFiles = 0;
  let skippedLargeSourceFiles = 0;
  for (const entry of entries) {
    const relative = safeEntryPath(entry.entryName);
    if (relative === null) throw new AppError('ZIP contains an unsafe path; extraction was blocked.', 400, 'ZIP_PATH_TRAVERSAL');
    if (!relative || entry.isDirectory) continue;
    const declared = Number(entry.header?.size ?? 0);
    if (!Number.isFinite(declared) || declared < 0) throw new AppError('ZIP contains an invalid entry.', 400, 'ZIP_INVALID_ENTRY');
    declaredTotal += declared;
    if (declaredTotal > maxTotalBytes) throw new AppError(`Uncompressed ZIP content exceeds the ${Math.round(maxTotalBytes / 1024 / 1024)} MB limit.`, 413, 'ZIP_BOMB_LIMIT');
    if (declared > maxFileBytes && /\.(?:js|jsx|ts|tsx|mjs|cjs)$/i.test(relative)) {
      // Large source files will be skipped by the scanner, but extracting giant source is unnecessary.
      skippedLargeSourceFiles++;
      continue;
    }
    const target = path.resolve(destDir, relative);
    const root = path.resolve(destDir) + path.sep;
    if (!target.startsWith(root)) throw new AppError('ZIP path escaped the extraction directory.', 400, 'ZIP_PATH_TRAVERSAL');
    const data = entry.getData();
    if (data.length !== declared && declared !== 0) throw new AppError('ZIP entry size did not match its metadata.', 400, 'ZIP_CORRUPT_ENTRY');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data, { flag: 'wx' }).catch(async error => {
      if (error.code === 'EEXIST') throw new AppError('ZIP contains duplicate paths, which are not allowed.', 400, 'ZIP_DUPLICATE_PATH');
      throw error;
    });
    sourceFiles++;
    if (sourceFiles > maxFiles * 2) throw new AppError('ZIP contains too many extracted files.', 413, 'ZIP_FILE_LIMIT');
  }
  return { rootDir: destDir, entries: entries.length, extractedFiles: sourceFiles, declaredBytes: declaredTotal, skippedLargeSourceFiles };
}
