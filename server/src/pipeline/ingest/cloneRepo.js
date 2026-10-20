import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { AppError } from '../../utils/errors.js';

const execFileAsync = promisify(execFile);

export async function cloneRepo(url, destDir, opts = {}) {
  const depth = Math.max(1, Math.min(500, Number(opts.depth || config.historyDepth)));
  await fs.mkdir(path.dirname(destDir), { recursive: true });
  try {
    await execFileAsync('git', [
      'clone', '--depth', String(depth), '--single-branch', '--no-tags', '--', url, destDir
    ], { timeout: config.cloneTimeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  } catch (error) {
    const reason = error.killed ? 'Git clone timed out.' : (error.stderr || error.message || 'Git clone failed.').trim();
    throw new AppError(`Could not clone this repository. It must be public and accessible. ${reason.slice(0, 400)}`, 422, 'CLONE_FAILED');
  }
  const stat = await fs.stat(destDir);
  if (!stat.isDirectory()) throw new AppError('Git clone did not produce a repository directory.', 500, 'CLONE_INVALID_RESULT');
  return destDir;
}

export async function getCommitSha(repoDir) {
  const { stdout } = await execFileAsync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], {
    timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true
  });
  return stdout.trim();
}

export async function hasUsableHistory(repoDir) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', repoDir, 'rev-list', '--count', 'HEAD'], {
      timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true
    });
    return Number(stdout.trim()) > 1;
  } catch { return false; }
}
