import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { config } from '../src/config.js';
import { validateGithubUrl } from '../src/api/validate.js';
import { cloneRepo } from '../src/pipeline/ingest/cloneRepo.js';
import { walkTree } from '../src/pipeline/scan/walkTree.js';
import { parseFile } from '../src/pipeline/parse/parseFile.js';
import { getParsePool, closeParsePool } from '../src/pipeline/parse/pool.js';
import { buildResolver } from '../src/pipeline/resolve/buildResolver.js';
import { buildGraph, resolveCalls } from '../src/pipeline/resolve/buildGraph.js';
import { analyzeGraph } from '../src/pipeline/analyze/analyzeGraph.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.resolve(here, '../test/fixtures');
const args = process.argv.slice(2);
const targets = args.length ? args : [
  path.join(fixtureRoot, 'cycle3'), path.join(fixtureRoot, 'diamond'), path.join(fixtureRoot, 'alias'),
  path.join(fixtureRoot, 'tsExt'), path.join(fixtureRoot, 'barrel'), path.join(fixtureRoot, 'dynamicImport')
];

async function withPeakRss(fn) {
  let peak = process.memoryUsage().rss;
  const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 25);
  timer.unref?.();
  const value = await fn();
  clearInterval(timer);
  peak = Math.max(peak, process.memoryUsage().rss);
  return { value, peakRssMB: Number((peak / 1024 / 1024).toFixed(1)) };
}

async function prepareTarget(target, tempRoot) {
  if (/^https:\/\/github\.com\//i.test(target)) {
    const parsed = validateGithubUrl(target);
    const repoDir = path.join(tempRoot, `repo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const start = performance.now();
    await cloneRepo(parsed.url, repoDir);
    return { repoDir, label: `${parsed.owner}/${parsed.repo}`, cloneMs: Math.round(performance.now() - start), cleanup: true };
  }
  const resolved = path.resolve(target);
  await fs.access(resolved);
  return { repoDir: resolved, label: path.basename(resolved), cloneMs: null, cleanup: false };
}

async function benchOne(target, tempRoot) {
  const prepared = await prepareTarget(target, tempRoot);
  const { repoDir, label } = prepared;
  try {
    const scanStart = performance.now();
    const scan = await walkTree(repoDir);
    const source = await Promise.all(scan.sourceFiles.map(async item => ({ id: item.path, code: await fs.readFile(item.absPath, 'utf8') })));
    const scanMs = Math.round(performance.now() - scanStart);
    const serial = await withPeakRss(async () => {
      const start = performance.now();
      const parsed = source.map(item => parseFile(item.id, item.code));
      return { parsed, ms: Math.round(performance.now() - start) };
    });
    const parallel = await withPeakRss(async () => {
      const start = performance.now();
      const pool = getParsePool();
      const parsed = [];
      for (let i = 0; i < source.length; i += 20) parsed.push(...await pool.run({ files: source.slice(i, i + 20) }));
      return { parsed, ms: Math.round(performance.now() - start) };
    });
    const resolver = await buildResolver(repoDir, new Set(source.map(item => item.id)));
    const graph = resolveCalls(buildGraph(parallel.value.parsed, resolver));
    const analyzed = analyzeGraph(graph);
    return {
      label, files: source.length, loc: parallel.value.parsed.reduce((sum, f) => sum + f.loc, 0),
      importEdges: analyzed.edges.filter(e => e.type === 'import').length,
      callEdges: analyzed.edges.filter(e => e.type === 'call').length,
      cycles: analyzed.cycles.length, cloneMs: prepared.cloneMs, scanMs,
      serialParseMs: serial.value.ms, serialPeakRssMB: serial.peakRssMB,
      workerParseMs: parallel.value.ms, workerPeakRssMB: parallel.peakRssMB,
      fps: 'Measure in browser dev mode (GraphCanvas FPS counter)'
    };
  } finally {
    if (prepared.cleanup) await fs.rm(repoDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function main() {
  await fs.mkdir(config.tempDir, { recursive: true });
  const tempRoot = await fs.mkdtemp(path.join(config.tempDir, 'bench-'));
  const results = [];
  try {
    for (const target of targets) {
      try { results.push(await benchOne(target, tempRoot)); }
      catch (error) { results.push({ label: target, error: error.message }); }
    }
  } finally {
    await closeParsePool().catch(() => {});
    await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
  }
  const headers = ['Repository / fixture', 'Files', 'LOC', 'Import edges', 'Call edges', 'Cycles', 'Clone ms', 'Scan ms', 'Serial parse ms', 'Serial peak RSS MB', 'Worker parse ms', 'Worker peak RSS MB', 'FPS'];
  const rows = results.map(r => r.error ? [r.label, `ERROR: ${r.error}`] : [r.label, r.files, r.loc, r.importEdges, r.callEdges, r.cycles, r.cloneMs ?? 'n/a', r.scanMs, r.serialParseMs, r.serialPeakRssMB, r.workerParseMs, r.workerPeakRssMB, r.fps]);
  const markdown = [
    '# Astral Cartographer benchmark results', '',
    `Date: ${new Date().toISOString()}`, '',
    `Machine: ${os.platform()} ${os.release()} | ${os.arch()} | ${os.cpus().length} logical CPUs | ${Math.round(os.totalmem() / 1024 / 1024)} MB RAM | Node ${process.version}`, '',
    'These are measurements from this run, not performance guarantees. Use three public repositories of approximately 50, 500 and 3,000 source files for the full comparison. FPS must be measured in the browser using the GraphCanvas FPS counter, so the CLI reports it as a separate interactive measurement.', '',
    `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(value => String(value).replace(/\|/g, '\\|')).join(' | ')} |`), ''
  ].join('\n');
  const output = path.join(here, 'results.md');
  await fs.writeFile(output, markdown);
  console.log(`Wrote ${output}`);
  console.log(markdown);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
