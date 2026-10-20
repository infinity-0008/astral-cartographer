import { describe, expect, it } from 'vitest';
import AdmZip from 'adm-zip';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { extractZip } from '../src/pipeline/ingest/extractZip.js';

describe('ZIP ingestion security', () => {
  it('rejects traversal paths before extraction', async () => {
    const zip = new AdmZip();
    zip.addFile('../escaped.js', Buffer.from('console.log("bad")'));
    const root = await mkdtemp(path.join(os.tmpdir(), 'astral-zip-'));
    try {
      await expect(extractZip(zip.toBuffer(), path.join(root, 'extract'))).rejects.toMatchObject({ code: 'ZIP_PATH_TRAVERSAL' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
