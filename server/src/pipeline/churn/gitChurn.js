import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execFileAsync = promisify(execFile);

export function parseNumstat(text) {
  const stats = new Map();
  let currentCommit = null;
  let currentAuthor = null;
  let currentDate = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('__COMMIT__')) {
      const [hash, author = '', date = ''] = line.slice('__COMMIT__'.length).split('|');
      currentCommit = hash.trim(); currentAuthor = author.trim(); currentDate = date.trim(); continue;
    }
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length < 3 || parts[0] === '-' || parts[1] === '-') continue;
    const added = Number(parts[0]);
    const deleted = Number(parts[1]);
    let filePath = parts.slice(2).join('\t');
    if (filePath.includes(' => ')) filePath = filePath.split(' => ').at(-1).replace(/[{}]/g, '');
    if (!Number.isFinite(added) || !Number.isFinite(deleted)) continue;
    if (!stats.has(filePath)) stats.set(filePath, { commits: new Set(), added: 0, deleted: 0, authors: new Set(), lastChanged: null });
    const stat = stats.get(filePath);
    stat.added += added; stat.deleted += deleted;
    if (currentCommit) stat.commits.add(currentCommit);
    if (currentAuthor) stat.authors.add(currentAuthor);
    stat.lastChanged = stat.lastChanged || currentDate || currentCommit;
  }
  return new Map([...stats].map(([file, s]) => [file, {
    commits: s.commits.size, added: s.added, deleted: s.deleted, authors: s.authors.size, lastChanged: s.lastChanged
  }]));
}

export async function hasUsableHistory(repoDir) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoDir, 'rev-list', '--count', 'HEAD'], { timeout: 8000, maxBuffer: 1024 * 1024 });
    return Number(stdout.trim()) > 1;
  } catch { return false; }
}

export async function getChurn(repoDir, sinceMonths = 6) {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C', repoDir, 'log', `--since=${Math.max(1, Math.min(60, sinceMonths))} months ago`,
      '--numstat', '--format=__COMMIT__%H|%an|%cI', '--'
    ], { timeout: 20000, maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    return parseNumstat(stdout);
  } catch { return null; }
}
