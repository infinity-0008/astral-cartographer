import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { IGNORED_DIRS, IGNORED_FILES, isSourcePath } from '../../utils/limits.js';
import { AppError } from '../../utils/errors.js';

export function isTestFile(filePath) {
  return /(^|\/)(__tests__|tests?|specs?)(\/|$)|\.(?:test|spec)\.[^.]+$/i.test(filePath.replace(/\\/g, '/'));
}

export function shouldIgnore(filePath, sizeBytes) {
  const posix = filePath.replace(/\\/g, '/');
  const parts = posix.split('/');
  if (parts.some(part => IGNORED_DIRS.has(part))) return true;
  const name = parts.at(-1) || '';
  if (IGNORED_FILES.has(name) || /\.min\.(?:js|jsx|ts|tsx|mjs|cjs)$/i.test(name)) return true;
  if (/\.(?:map|json|jsonc|md|mdx|html|css|scss|less|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|pdf)$/i.test(name)) return true;
  if (!isSourcePath(name)) return true;
  if (sizeBytes > config.maxSourceFileBytes) return true;
  return false;
}

export async function walkTree(rootDir) {
  const results = [];
  let skipped = 0;
  let totalBytes = 0;
  const stack = [{ abs: rootDir, rel: '' }];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try { entries = await fs.readdir(current.abs, { withFileTypes: true }); }
    catch { skipped++; continue; }
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue;
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) { skipped++; continue; }
      const abs = path.join(current.abs, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) stack.push({ abs, rel });
        else skipped++;
        continue;
      }
      if (!entry.isFile()) { skipped++; continue; }
      let stat;
      try { stat = await fs.stat(abs); } catch { skipped++; continue; }
      totalBytes += stat.size;
      if (totalBytes > config.maxRepoBytes) {
        throw new AppError(`Repository source scan exceeded ${Math.round(config.maxRepoBytes / 1024 / 1024)} MB.`, 413, 'REPO_SIZE_LIMIT');
      }
      if (shouldIgnore(rel, stat.size)) { skipped++; continue; }
      results.push({ path: rel.replace(/\\/g, '/'), absPath: abs, sizeBytes: stat.size });
      if (results.length > config.maxFiles) {
        throw new AppError(`Repository contains more than ${config.maxFiles} supported source files.`, 413, 'REPO_FILE_LIMIT');
      }
    }
  }
  results.sort((a, b) => a.path.localeCompare(b.path));
  return { sourceFiles: results, skippedCount: skipped, totalSourceBytes: totalBytes };
}

export function buildFolderTree(files) {
  const root = { name: '.', path: '.', children: [], fileCount: 0, loc: 0, healthTotal: 0 };
  const folders = new Map([['.', root]]);
  for (const file of files) {
    const parts = file.id.split('/');
    let currentPath = '.';
    let current = root;
    current.fileCount++;
    current.loc += file.loc || 0;
    current.healthTotal += file.metrics?.health ?? 0;
    for (const part of parts.slice(0, -1)) {
      currentPath = currentPath === '.' ? part : `${currentPath}/${part}`;
      if (!folders.has(currentPath)) {
        const folder = { name: part, path: currentPath, children: [], fileCount: 0, loc: 0, healthTotal: 0 };
        folders.set(currentPath, folder);
        current.children.push(folder);
      }
      current = folders.get(currentPath);
      current.fileCount++;
      current.loc += file.loc || 0;
      current.healthTotal += file.metrics?.health ?? 0;
    }
  }
  return [...folders.values()].map(folder => ({
    ...folder,
    children: folder.children.map(child => child.path),
    avgHealth: folder.fileCount ? Math.round(folder.healthTotal / folder.fileCount) : null
  }));
}
