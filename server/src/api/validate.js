import path from 'node:path';
import { AppError } from '../utils/errors.js';
import { config } from '../config.js';

const GH_REPO_URL = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100})(?:\.git)?\/?$/i;

export function validateGithubUrl(value) {
  if (typeof value !== 'string' || value.length > 500) {
    throw new AppError('Enter a valid public GitHub repository URL.', 400, 'INVALID_GITHUB_URL');
  }
  const url = value.trim();
  const match = GH_REPO_URL.exec(url);
  if (!match || match[1] === '.' || match[1] === '..' || match[2] === '.' || match[2] === '..') {
    throw new AppError('Only URLs in the form https://github.com/owner/repository are supported.', 400, 'INVALID_GITHUB_URL');
  }
  const repo = match[2].replace(/\.git$/i, '');
  return { url: `https://github.com/${match[1]}/${repo}.git`, owner: match[1], repo };
}

export function validateZipUpload(file) {
  if (!file) throw new AppError('Provide a GitHub URL or upload a ZIP archive.', 400, 'SOURCE_REQUIRED');
  if (file.size > config.maxZipBytes) {
    throw new AppError(`ZIP exceeds the ${Math.round(config.maxZipBytes / 1024 / 1024)} MB upload limit.`, 413, 'ZIP_TOO_LARGE');
  }
  if (!/\.zip$/i.test(path.basename(file.originalname || ''))) {
    throw new AppError('Only .zip repository archives are supported.', 400, 'INVALID_ZIP');
  }
  if (!file.buffer?.length) throw new AppError('The uploaded ZIP is empty.', 400, 'EMPTY_ZIP');
  return true;
}
