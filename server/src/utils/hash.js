import { createHash } from 'node:crypto';
export const sha1 = (value) => createHash('sha1').update(value).digest('hex');
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
