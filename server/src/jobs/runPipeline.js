import fs from 'node:fs/promises';
import path from 'node:path';
import { Analysis } from '../models/Analysis.js';
import { config } from '../config.js';
import { AppError } from '../utils/errors.js';
import { sha1, sha256 } from '../utils/hash.js';
import { logger } from '../utils/logger.js';
import { cloneRepo, getCommitSha } from '../pipeline/ingest/cloneRepo.js';
import { extractZip } from '../pipeline/ingest/extractZip.js';
import { walkTree, isTestFile, buildFolderTree } from '../pipeline/scan/walkTree.js';
import { getParsePool } from '../pipeline/parse/pool.js';
import { buildResolver } from '../pipeline/resolve/buildResolver.js';
import { buildGraph, resolveCalls } from '../pipeline/resolve/buildGraph.js';
import { analyzeGraph } from '../pipeline/analyze/analyzeGraph.js';
import { getChurn, hasUsableHistory } from '../pipeline/churn/gitChurn.js';
import { scoreHealth } from '../pipeline/score/health.js';
import { rankStarterFiles, buildLearningPath } from '../pipeline/onboard/onboarding.js';
import { cacheDirectory, loadResult, loadParsed, saveParsed, saveResult, evictOld } from '../pipeline/cache/store.js';

const parseChunkSize = 20;
function assertWithinTime(startedAt) {
  if (performance.now() - startedAt > config.analysisTimeoutMs) throw new AppError('Analysis exceeded the configured time limit. Try a smaller repository.', 408, 'ANALYSIS_TIMEOUT');
}

async function report(id, callback, status, done, total, message, extra = {}) {
  const progress = { stage: status, done: Math.max(0, done || 0), total: Math.max(0, total || 0), message };
  await Analysis.findByIdAndUpdate(id, { $set: { status, progress, ...extra } }).exec();
  callback?.({ id, status, progress, stats: extra.stats });
}

async function findCached(cacheKey, currentId) {
  const existing = await Analysis.findOne({ cacheKey, status: 'done', _id: { $ne: currentId } }).sort({ createdAt: -1 }).lean();
  if (!existing?.resultPath) return null;
  const result = await loadResult(existing.resultPath);
  if (!result) return null;
  try { await fs.access(existing.snapshotPath); } catch { return null; }
  return existing;
}

async function cacheHit(id, cached, cacheKey, callback) {
  await Analysis.findByIdAndUpdate(id, { $set: {
    cacheKey, status: 'done', cached: true,
    progress: { stage: 'done', done: 1, total: 1, message: 'Loaded completed analysis from cache.' },
    stats: cached.stats, hasHistory: cached.hasHistory, resultPath: cached.resultPath,
    snapshotPath: cached.snapshotPath, commitSha: cached.commitSha
  } }).exec();
  callback?.({ id, status: 'done', cached: true, progress: { stage: 'done', done: 1, total: 1, message: 'Loaded completed analysis from cache.' }, stats: cached.stats });
}

export async function runPipeline(analysisId, input, onProgress) {
  const startedAt = performance.now();
  let jobDir;
  let repoDir;
  try {
    await fs.mkdir(config.tempDir, { recursive: true });
    jobDir = await fs.mkdtemp(path.join(config.tempDir, 'astral-'));
    let sourceMeta;
    let sourceIdentity;
    let cacheKey;
    let commitSha = null;
    let hasHistoryFlag = false;
    let zipSummary = { skippedLargeSourceFiles: 0 };

    if (input.type === 'zip') {
      sourceIdentity = `zip:${sha256(input.buffer)}`;
      cacheKey = sha256(sourceIdentity);
      sourceMeta = { type: 'zip', filename: input.filename };
      const cached = await findCached(cacheKey, analysisId);
      if (cached) { await cacheHit(analysisId, cached, cacheKey, onProgress); return; }
      await report(analysisId, onProgress, 'scanning', 0, 1, 'Validating and safely extracting ZIP archive.');
      repoDir = path.join(jobDir, 'repo');
      zipSummary = await extractZip(input.buffer, repoDir);
    } else {
      sourceMeta = { type: 'github', url: input.url, owner: input.owner, repo: input.repo };
      await report(analysisId, onProgress, 'cloning', 0, 1, `Cloning ${input.owner}/${input.repo}.`);
      repoDir = path.join(jobDir, 'repo');
      await cloneRepo(input.url, repoDir, { depth: config.historyDepth });
      commitSha = await getCommitSha(repoDir);
      sourceIdentity = `${input.owner}/${input.repo}@${commitSha}`;
      cacheKey = sha256(sourceIdentity);
      hasHistoryFlag = await hasUsableHistory(repoDir);
      const cached = await findCached(cacheKey, analysisId);
      if (cached) { await cacheHit(analysisId, cached, cacheKey, onProgress); return; }
    }

    const scanStart = performance.now();
    await report(analysisId, onProgress, 'scanning', 0, 0, 'Walking the repository and applying ignore/size rules.');
    assertWithinTime(startedAt);
    const scan = await walkTree(repoDir);
    assertWithinTime(startedAt);
    if (!scan.sourceFiles.length) throw new AppError('No JavaScript or TypeScript source files were found. Supported extensions: .js, .jsx, .ts, .tsx, .mjs, .cjs.', 422, 'NO_SOURCE_FILES');
    const scanMs = performance.now() - scanStart;

    await report(analysisId, onProgress, 'parsing', 0, scan.sourceFiles.length, `Parsing ${scan.sourceFiles.length} source files with worker threads.`);
    const parseStart = performance.now();
    const parsedFiles = [];
    const pool = getParsePool();
    for (let offset = 0; offset < scan.sourceFiles.length; offset += parseChunkSize) {
      assertWithinTime(startedAt);
      const chunk = scan.sourceFiles.slice(offset, offset + parseChunkSize);
      const withCode = await Promise.all(chunk.map(async file => ({
        id: file.path,
        code: await fs.readFile(file.absPath, 'utf8').catch(() => '')
      })));
      const pending = [];
      const pendingKeys = [];
      for (const file of withCode) {
        const parseCacheKey = sha1(`parse-v1\0${file.id}\0${file.code}`);
        const cached = await loadParsed(parseCacheKey);
        if (cached) parsedFiles.push({ ...cached, isTest: isTestFile(file.id) });
        else { pending.push(file); pendingKeys.push(parseCacheKey); }
      }
      if (pending.length) {
        const parsed = await pool.run({ files: pending });
        for (let i = 0; i < parsed.length; i++) {
          const item = { ...parsed[i], isTest: isTestFile(parsed[i].id) };
          parsedFiles.push(item);
          saveParsed(pendingKeys[i], item).catch(error => logger.warn('Could not save per-file parse cache', error.message));
        }
      }
      await report(analysisId, onProgress, 'parsing', Math.min(offset + chunk.length, scan.sourceFiles.length), scan.sourceFiles.length,
        `Parsed ${Math.min(offset + chunk.length, scan.sourceFiles.length)} of ${scan.sourceFiles.length} files.`);
    }
    parsedFiles.sort((a, b) => a.id.localeCompare(b.id));
    const parseMs = performance.now() - parseStart;
    assertWithinTime(startedAt);

    await report(analysisId, onProgress, 'resolving', 0, parsedFiles.length, 'Resolving imports, aliases, workspaces and calls.');
    const resolver = await buildResolver(repoDir, new Set(parsedFiles.map(file => file.id)));
    let graph = buildGraph(parsedFiles, resolver);
    graph = resolveCalls(graph);
    await report(analysisId, onProgress, 'analyzing', 0, Object.keys(graph.files).length, 'Detecting cycles and calculating fan metrics and impact radius.');
    const analyzed = analyzeGraph(graph);
    assertWithinTime(startedAt);

    await report(analysisId, onProgress, 'scoring', 0, Object.keys(analyzed.files).length, 'Calculating repository health and architectural flags.');
    let churnStats = null;
    if (input.type === 'github' && hasHistoryFlag) churnStats = await getChurn(repoDir, 6);
    scoreHealth(analyzed.files, churnStats, analyzed.functions);
    await report(analysisId, onProgress, 'onboarding', 0, Object.keys(analyzed.files).length, 'Ranking contributor-friendly entry points and dependency-first learning levels.');
    const onboardingStarters = rankStarterFiles(analyzed.files, analyzed.adjacency.inn, churnStats);
    const learningPath = buildLearningPath(analyzed.learningLevels);

    // Keep source snapshots separate from result JSON so the browser requests code on demand.
    const snapshotPath = path.join(cacheDirectory(cacheKey), 'source');
    await fs.mkdir(snapshotPath, { recursive: true });
    for (const sourceFile of scan.sourceFiles) {
      const target = path.resolve(snapshotPath, sourceFile.path);
      if (!target.startsWith(path.resolve(snapshotPath) + path.sep)) continue;
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(sourceFile.absPath, target).catch(() => {});
    }

    assertWithinTime(startedAt);
    const totalMs = Math.round(performance.now() - startedAt);
    const fileValues = Object.values(analyzed.files);
    const stats = {
      files: fileValues.length,
      loc: fileValues.reduce((sum, file) => sum + file.loc, 0),
      edges: analyzed.edges.filter(edge => edge.type === 'import').length,
      cycles: analyzed.cycles.length,
      parseMs: Math.round(parseMs),
      totalMs
    };
    const folders = buildFolderTree(fileValues);
    const functionsByFile = new Map();
    for (const fn of Object.values(analyzed.functions)) {
      if (!functionsByFile.has(fn.file)) functionsByFile.set(fn.file, []);
      functionsByFile.get(fn.file).push(fn);
    }
    const searchIndex = [
      ...fileValues.map(file => ({ id: file.id, type: 'file', label: file.id, haystack: `${file.id} ${file.ext} ${file.folder}`.toLowerCase() })),
      ...Object.values(analyzed.functions).map(fn => ({ id: fn.id, type: 'function', label: `${fn.name} (${fn.file}:${fn.startLine})`, file: fn.file, haystack: `${fn.name} ${fn.file}`.toLowerCase() }))
    ];
    const result = {
      meta: {
        id: String(analysisId), cacheKey, source: sourceMeta, commitSha, fileCount: fileValues.length,
        loc: stats.loc, parseMs: stats.parseMs, totalMs: stats.totalMs, hasHistory: Boolean(churnStats),
        skippedCount: scan.skippedCount + zipSummary.skippedLargeSourceFiles, totalSourceBytes: scan.totalSourceBytes, scanMs: Math.round(scanMs),
        unresolvedCount: fileValues.reduce((sum, file) => sum + file.unresolved.length, 0),
        parseErrorCount: fileValues.filter(file => file.parseError).length,
        callGraphResolved: Object.values(analyzed.functions).reduce((sum, fn) => sum + fn.calls.length, 0),
        callGraphUnresolved: Object.values(analyzed.functions).reduce((sum, fn) => sum + fn.unresolvedCalls, 0),
        cacheHit: false, approximateScoring: !churnStats,
        supportedLanguages: ['JavaScript', 'TypeScript']
      },
      files: analyzed.files,
      functions: analyzed.functions,
      edges: analyzed.edges,
      cycles: analyzed.cycles,
      folders,
      onboarding: { starters: onboardingStarters, learningOrder: analyzed.learningLevels, learningPath },
      searchIndex
    };
    await report(analysisId, onProgress, 'persisting', 0, 1, 'Saving compressed analysis and source snapshot.', { cacheKey, commitSha, hasHistory: Boolean(churnStats), stats });
    const saved = await saveResult(cacheKey, result);
    await Analysis.findByIdAndUpdate(analysisId, { $set: {
      cacheKey, commitSha, source: sourceMeta, status: 'done', progress: { stage: 'done', done: 1, total: 1, message: 'Analysis completed.' },
      stats, hasHistory: Boolean(churnStats), resultPath: saved.resultPath, snapshotPath: saved.snapshotPath,
      cached: false, error: undefined
    } }).exec();
    onProgress?.({ id: String(analysisId), status: 'done', progress: { stage: 'done', done: 1, total: 1, message: 'Analysis completed.' }, stats });
    await evictOld(30).catch(error => logger.warn('Cache cleanup failed', error.message));
    logger.info('Analysis completed', { id: String(analysisId), source: sourceMeta, stats });
  } catch (error) {
    const message = error instanceof AppError ? error.message : (error?.message || 'Analysis failed unexpectedly.');
    const code = error?.code || 'ANALYSIS_FAILED';
    logger.error('Analysis failed', { id: String(analysisId), message, code });
    await Analysis.findByIdAndUpdate(analysisId, { $set: {
      status: 'failed', error: message,
      progress: { stage: 'failed', done: 0, total: 0, message }
    } }).exec().catch(() => {});
    onProgress?.({ id: String(analysisId), status: 'failed', error: message, code, progress: { stage: 'failed', done: 0, total: 0, message } });
  } finally {
    if (jobDir) await fs.rm(jobDir, { recursive: true, force: true }).catch(error => logger.warn('Temp cleanup failed', error.message));
  }
}
