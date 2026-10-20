import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs/promises';
import { Types } from 'mongoose';
import { Analysis } from '../models/Analysis.js';
import { config } from '../config.js';
import { AppError, asyncRoute } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { validateGithubUrl, validateZipUpload } from './validate.js';
import { enqueueAnalysis, getQueueStats } from '../jobs/jobManager.js';
import { streamAnalysisEvents } from './sse.js';
import { loadResult } from '../pipeline/cache/store.js';
import { buildAdjacency } from '../pipeline/resolve/buildGraph.js';
import { prImpact } from '../pipeline/onboard/onboarding.js';
import { fetchGoodFirstIssues } from '../pipeline/onboard/issues.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxZipBytes, files: 1, fields: 8, fieldSize: 4096 },
  fileFilter: (req, file, cb) => {
    if (/\.zip$/i.test(file.originalname || '')) return cb(null, true);
    return cb(new AppError('Only .zip repository archives are supported.', 400, 'INVALID_ZIP'));
  }
});
const startLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 6, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many analyses started from this address. Please try again later.', code: 'RATE_LIMITED' } });

router.get('/health', (req, res) => res.json({ ok: true, service: 'astral-cartographer-api', queue: getQueueStats() }));

function requireId(req, res, next) {
  if (!Types.ObjectId.isValid(req.params.id)) return next(new AppError('Invalid analysis ID.', 400, 'INVALID_ANALYSIS_ID'));
  next();
}

async function getAnalysisOr404(id) {
  const doc = await Analysis.findById(id).lean();
  if (!doc) throw new AppError('Analysis not found.', 404, 'ANALYSIS_NOT_FOUND');
  return doc;
}

async function getResult(doc) {
  if (doc.status !== 'done' || !doc.resultPath) throw new AppError('Analysis is not finished yet.', 409, 'ANALYSIS_NOT_READY');
  const result = await loadResult(doc.resultPath);
  if (!result) throw new AppError('Stored analysis result is missing or unreadable. Try analysing the repository again.', 500, 'RESULT_UNAVAILABLE');
  return result;
}

router.post('/analyses', startLimiter, upload.single('zip'), asyncRoute(async (req, res) => {
  let input;
  let source;
  if (req.file) {
    validateZipUpload(req.file);
    input = { type: 'zip', buffer: req.file.buffer, filename: path.basename(req.file.originalname) };
    source = { type: 'zip', filename: path.basename(req.file.originalname) };
  } else {
    const parsed = validateGithubUrl(req.body?.url);
    input = { type: 'github', ...parsed };
    source = { type: 'github', url: parsed.url, owner: parsed.owner, repo: parsed.repo };
  }
  const doc = await Analysis.create({ source, status: 'queued', progress: { stage: 'queued', done: 0, total: 0, message: 'Queued for analysis.' } });
  try { enqueueAnalysis(doc._id, input); }
  catch (error) {
    await Analysis.findByIdAndUpdate(doc._id, { status: 'failed', error: error.message, progress: { stage: 'failed', done: 0, total: 0, message: error.message } });
    throw new AppError(error.message, 503, 'QUEUE_FULL');
  }
  logger.info('Analysis queued', { id: String(doc._id), source: source.type });
  res.status(202).json({ id: String(doc._id), status: 'queued', cached: false, eventsUrl: `/api/analyses/${doc._id}/events` });
}));

router.get('/analyses/:id', requireId, asyncRoute(async (req, res) => {
  const a = await getAnalysisOr404(req.params.id);
  res.json({
    id: String(a._id), source: a.source, commitSha: a.commitSha, status: a.status, progress: a.progress,
    stats: a.stats, hasHistory: a.hasHistory, cached: a.cached, error: a.error || null,
    createdAt: a.createdAt, updatedAt: a.updatedAt
  });
}));

router.get('/analyses/:id/events', requireId, streamAnalysisEvents);

router.get('/analyses/:id/graph', requireId, asyncRoute(async (req, res) => {
  const a = await getAnalysisOr404(req.params.id);
  const result = await getResult(a);
  const view = req.query.view === 'folder' ? 'folder' : 'file';
  if (view === 'folder') {
    const folderMap = new Map(result.folders.map(folder => [folder.path, folder]));
    const folderFor = fileId => {
      let dir = path.posix.dirname(fileId);
      while (dir !== '.' && !folderMap.has(dir)) dir = path.posix.dirname(dir);
      return folderMap.has(dir) ? dir : '.';
    };
    const edgeCounts = new Map();
    for (const edge of result.edges.filter(e => e.type === 'import')) {
      const source = folderFor(edge.source); const target = folderFor(edge.target);
      if (source === target) continue;
      const key = `${source}\0${target}`;
      edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
    }
    return res.json({
      view,
      nodes: result.folders.map(folder => ({ data: {
        id: folder.path, label: folder.path === '.' ? 'Repository' : folder.name,
        fileCount: folder.fileCount, loc: folder.loc, health: folder.avgHealth ?? 0,
        isFolder: true, parent: folder.path === '.' ? undefined : path.posix.dirname(folder.path)
      } })),
      edges: [...edgeCounts].map(([key, count], i) => { const [source, target] = key.split('\0'); return { data: { id: `folder-edge-${i}`, source, target, weight: count, label: String(count) } }; })
    });
  }
  const cycleFiles = new Set(result.cycles.flatMap(cycle => cycle.files));
  res.json({
    view,
    nodes: Object.values(result.files).map(file => ({ data: {
      id: file.id, label: path.posix.basename(file.id), path: file.id, folder: file.folder,
      ext: file.ext, loc: file.loc, health: file.metrics?.health ?? 100, risk: file.metrics?.risk ?? 0,
      complexity: file.metrics?.complexity ?? 1, fanIn: file.metrics?.fanIn ?? 0, fanOut: file.metrics?.fanOut ?? 0,
      churn: (file.metrics?.churn?.added ?? 0) + (file.metrics?.churn?.deleted ?? 0),
      blastRadius: file.metrics?.blastRadius ?? 0, maxFnComplexity: file.metrics?.maxFnComplexity ?? 1,
      approximate: Boolean(file.metrics?.approximate),
      inCycle: cycleFiles.has(file.id), parseError: Boolean(file.parseError), unresolvedCount: file.unresolved?.length ?? 0
    } })),
    edges: result.edges.filter(edge => edge.type === 'import').map((edge, i) => ({ data: {
      id: `edge-${i}`, source: edge.source, target: edge.target, type: edge.type, inCycle: Boolean(edge.inCycle)
    } }))
  });
}));

router.get('/analyses/:id/files/*', requireId, asyncRoute(async (req, res) => {
  const a = await getAnalysisOr404(req.params.id);
  const result = await getResult(a);
  let fileId;
  try { fileId = String(req.params[0] || '').replace(/\\/g, '/'); }
  catch { throw new AppError('Invalid file path.', 400, 'INVALID_FILE_PATH'); }
  const file = result.files[fileId];
  if (!file || fileId.startsWith('/') || fileId.split('/').includes('..')) throw new AppError('File not found in this analysis.', 404, 'FILE_NOT_FOUND');
  const sourcePath = path.resolve(a.snapshotPath, fileId);
  if (!sourcePath.startsWith(path.resolve(a.snapshotPath) + path.sep)) throw new AppError('Invalid file path.', 400, 'INVALID_FILE_PATH');
  const source = await fs.readFile(sourcePath, 'utf8').catch(() => null);
  res.json({ file, source, functions: (file.functionIds || []).map(id => result.functions[id]).filter(Boolean) });
}));

router.get('/analyses/:id/search', requireId, asyncRoute(async (req, res) => {
  const a = await getAnalysisOr404(req.params.id);
  const result = await getResult(a);
  const q = String(req.query.q || '').trim().toLowerCase().slice(0, 200);
  if (!q) return res.json({ query: '', matches: [] });
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 40)));
  const matches = (result.searchIndex || []).filter(item => item.haystack.includes(q) || item.label.toLowerCase().includes(q)).slice(0, limit).map(({ haystack, ...item }) => item);
  res.json({ query: q, matches, count: matches.length });
}));

router.get('/analyses/:id/cycles', requireId, asyncRoute(async (req, res) => {
  const a = await getAnalysisOr404(req.params.id); const result = await getResult(a);
  res.json({ cycles: result.cycles, count: result.cycles.length });
}));

router.get('/analyses/:id/hotspots', requireId, asyncRoute(async (req, res) => {
  const a = await getAnalysisOr404(req.params.id); const result = await getResult(a);
  const limit = Math.max(1, Math.min(100, Number(req.query.limit || 20)));
  const files = Object.values(result.files).sort((x,y) => (y.metrics?.risk || 0) - (x.metrics?.risk || 0));
  res.json({
    hotspots: files.slice(0, limit).map(file => ({ id: file.id, loc: file.loc, health: file.metrics.health, risk: file.metrics.risk, complexity: file.metrics.complexity, churn: file.metrics.churn || null, flags: file.metrics.flags })),
    scatter: files.map(file => ({ id: file.id, x: file.metrics.churn ? file.metrics.churn.added + file.metrics.churn.deleted : 0, y: file.metrics.complexity, size: file.loc, risk: file.metrics.risk })),
    summary: {
      totalFiles: files.length,
      averageHealth: files.length ? Math.round(files.reduce((sum, file) => sum + (file.metrics?.health ?? 0), 0) / files.length) : 0,
      flaggedFiles: files.filter(file => (file.metrics?.flags || []).length > 0).length,
      maxRisk: files.reduce((max, file) => Math.max(max, file.metrics?.risk ?? 0), 0)
    },
    hasHistory: result.meta.hasHistory, approximate: result.meta.approximateScoring
  });
}));

router.get('/analyses/:id/onboarding', requireId, asyncRoute(async (req, res) => {
  const a = await getAnalysisOr404(req.params.id); const result = await getResult(a);
  res.json(result.onboarding);
}));

router.post('/analyses/:id/impact', requireId, asyncRoute(async (req, res) => {
  const a = await getAnalysisOr404(req.params.id); const result = await getResult(a);
  const changed = req.body?.files;
  if (!Array.isArray(changed) || changed.length > 500) throw new AppError('Body must contain a files array with at most 500 paths.', 400, 'INVALID_IMPACT_INPUT');
  const { inn } = buildAdjacency(Object.keys(result.files), result.edges.filter(edge => edge.type === 'import'));
  res.json(prImpact(changed, result.files, inn, result.cycles));
}));

router.get('/analyses/:id/issues', requireId, asyncRoute(async (req, res) => {
  const a = await getAnalysisOr404(req.params.id); const result = await getResult(a);
  if (a.source?.type !== 'github' || !a.source.owner || !a.source.repo) return res.json({ available: false, reason: 'Good-first-issue matching requires a GitHub repository URL.', issues: [] });
  res.json(await fetchGoodFirstIssues(a.source.owner, a.source.repo, Object.keys(result.files)));
}));

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof AppError) return res.status(err.statusCode).json({ error: err.message, code: err.code });
  if (err?.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `ZIP upload is limited to ${Math.round(config.maxZipBytes / 1024 / 1024)} MB.`, code: 'ZIP_TOO_LARGE' });
  if (err?.name === 'MulterError') return res.status(400).json({ error: err.message, code: 'UPLOAD_ERROR' });
  logger.error('Unhandled API error', { message: err?.message, path: req.path });
  res.status(500).json({ error: 'Unexpected server error.', code: 'INTERNAL_ERROR' });
});

export default router;
