import { describe, expect, it } from 'vitest';
import { parseFile } from '../src/pipeline/parse/parseFile.js';
import { tarjanSCC, findCycles } from '../src/pipeline/analyze/tarjan.js';
import { blastRadius, computeFanMetrics, condense } from '../src/pipeline/analyze/metrics.js';
import { percentileRank, scoreHealth } from '../src/pipeline/score/health.js';
import { buildGraph, resolveCalls, buildAdjacency } from '../src/pipeline/resolve/buildGraph.js';
import { buildResolver, resolveImport } from '../src/pipeline/resolve/buildResolver.js';
import { parseNumstat } from '../src/pipeline/churn/gitChurn.js';
import { matchIssueToFiles } from '../src/pipeline/onboard/issues.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function adjacency(nodes, edges) {
  const out = new Map(nodes.map(node => [node, []]));
  for (const [a, b] of edges) out.get(a).push(b);
  return out;
}

describe('AST parser', () => {
  it('extracts imports, exports, named arrows, and branch complexity', () => {
    const parsed = parseFile('src/calc.js', `import { read } from './read.js';\nexport const calculate = (a, b) => { if (a && b) return a ? 1 : 0; return read(a); };`);
    expect(parsed.parseError).toBeUndefined();
    expect(parsed.imports.map(item => item.spec)).toContain('./read.js');
    expect(parsed.exports).toContain('calculate');
    const calculate = parsed.functions.find(fn => fn.name === 'calculate');
    expect(calculate).toBeTruthy();
    expect(calculate.exported).toBe(true);
    expect(calculate.complexity).toBe(4);
  });

  it('keeps a syntax-error file representable instead of crashing a batch', () => {
    const parsed = parseFile('broken.js', 'export const x = ;');
    expect(parsed.id).toBe('broken.js');
    expect(parsed.parseError).toBeTruthy();
    expect(parsed.functions).toEqual([]);
  });

  it('resolves local calls and counts unresolved calls', () => {
    const a = parseFile('a.js', 'function helper(){ return 1 } export function run(){ return helper() + missingCall() }');
    const graph = buildGraph([a], { rootDir: '/', fileSet: new Set(['a.js']), aliases: [], workspacePackages: new Map() });
    resolveCalls(graph);
    const run = Object.values(graph.functions).find(fn => fn.name === 'run');
    expect(run.calls.some(id => graph.functions[id]?.name === 'helper')).toBe(true);
    expect(run.unresolvedCalls).toBe(1);
  });

  it('tracks CommonJS require bindings and module export assignments', () => {
    const dep = parseFile('dep.cjs', `function run() { return 7; } exports.run = run; module.exports.extra = () => 1;`);
    const app = parseFile('app.cjs', `const dep = require('./dep.cjs'); function main() { return dep.run(); } module.exports = main;`);
    expect(app.imports.some(item => item.kind === 'require' && item.spec === './dep.cjs')).toBe(true);
    expect(dep.exports).toContain('run');
    expect(dep.exports).toContain('extra');
    expect(app.exports).toContain('default');
    expect(Object.values(app.functions).find(fn => fn.name === 'main')?.defaultExport).toBe(true);
    const graph = buildGraph([app, dep], { rootDir: '/', fileSet: new Set(['app.cjs', 'dep.cjs']), aliases: [], workspacePackages: new Map() });
    resolveCalls(graph);
    const main = Object.values(graph.functions).find(fn => fn.name === 'main');
    expect(main.calls.some(id => graph.functions[id]?.name === 'run')).toBe(true);
  });

  it('resolves destructured CommonJS exports and records dynamic imports', () => {
    const dep = parseFile('dep.mjs', `export function boot() { return 1; }`);
    const app = parseFile('app.mjs', `import { boot } from './dep.mjs'; export async function main() { const mod = await import('./dep.mjs'); const { boot: start } = require('./dep.mjs'); return boot() + mod.boot() + start(); }`);
    expect(app.imports.some(item => item.kind === 'dynamic' && item.spec === './dep.mjs')).toBe(true);
    expect(app.imports.some(item => item.kind === 'require' && item.spec === './dep.mjs')).toBe(true);
    expect(dep.exports).toContain('boot');
  });
});

describe('Import resolver', () => {
  it('resolves .js specifiers to TypeScript siblings and folder index files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'astral-resolver-'));
    try {
      await mkdir(path.join(root, 'src', 'lib'), { recursive: true });
      await writeFile(path.join(root, 'src', 'util.ts'), 'export const value = 1;');
      await writeFile(path.join(root, 'src', 'lib', 'index.tsx'), 'export default function Lib() {}');
      const ctx = await buildResolver(root, new Set(['src/util.ts', 'src/lib/index.tsx']));
      expect(resolveImport('src/app.ts', './util.js', ctx)).toBe('src/util.ts');
      expect(resolveImport('src/app.ts', './lib', ctx)).toBe('src/lib/index.tsx');
      expect(resolveImport('src/app.ts', 'react', ctx)).toBe('external');
      expect(resolveImport('src/app.ts', './missing', ctx)).toBe(null);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('supports tsconfig path aliases', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'astral-alias-'));
    try {
      await mkdir(path.join(root, 'src', 'utils'), { recursive: true });
      await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] } } }));
      await writeFile(path.join(root, 'src', 'utils', 'format.ts'), 'export const format = () => {};');
      const ctx = await buildResolver(root, new Set(['src/utils/format.ts']));
      expect(resolveImport('src/app.ts', '@/utils/format', ctx)).toBe('src/utils/format.ts');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('Graph analysis', () => {
  it('finds a three-file cycle and the shortest readable path', () => {
    const nodes = ['a.js', 'b.js', 'c.js', 'd.js'];
    const out = adjacency(nodes, [['a.js','b.js'], ['b.js','c.js'], ['c.js','a.js'], ['d.js','a.js']]);
    const components = tarjanSCC(nodes, out);
    expect(components.some(component => component.length === 3)).toBe(true);
    const cycles = findCycles(components, out);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].path[0]).toBe(cycles[0].path.at(-1));
    expect(cycles[0].length).toBe(3);
  });

  it('detects self-loops and ignores acyclic singleton components', () => {
    const nodes = ['self.js', 'leaf.js'];
    const out = adjacency(nodes, [['self.js','self.js']]);
    expect(findCycles(tarjanSCC(nodes, out), out)).toMatchObject([{ files: ['self.js'], path: ['self.js', 'self.js'], length: 1 }]);
  });

  it('computes diamond blast radius safely', () => {
    const nodes = ['app.js', 'left.js', 'right.js', 'core.js'];
    const edges = [['app.js','left.js'], ['app.js','right.js'], ['left.js','core.js'], ['right.js','core.js']];
    const out = adjacency(nodes, edges);
    const inn = new Map(nodes.map(n => [n, []]));
    for (const [a,b] of edges) inn.get(b).push(a);
    expect([...blastRadius('core.js', inn)].sort()).toEqual(['app.js', 'left.js', 'right.js']);
  });

  it('terminates in a cycle and derives dependency-first learning levels', () => {
    const nodes = ['app.js', 'util.js', 'base.js'];
    const out = adjacency(nodes, [['app.js','util.js'], ['util.js','base.js']]);
    const inn = new Map(nodes.map(n => [n, []]));
    for (const [a, list] of out) for (const b of list) inn.get(b).push(a);
    const condensed = condense(tarjanSCC(nodes, out), out, inn);
    expect(condensed.learningLevels[0]).toEqual(['base.js']);
    expect(condensed.learningLevels[1]).toEqual(['util.js']);
    expect(condensed.learningLevels[2]).toEqual(['app.js']);
    inn.get('base.js').push('app.js');
    expect(blastRadius('base.js', inn).size).toBeGreaterThan(0);
  });

  it('builds fan metrics with cycle markers', () => {
    const files = { a: { id:'a', isTest:false }, b: { id:'b', isTest:true } };
    const out = adjacency(['a','b'], [['a','b'], ['b','a']]);
    const inn = new Map([['a',['b']], ['b',['a']]]);
    expect(computeFanMetrics(files, out, inn, [{ files:['a','b'] }]).a).toMatchObject({ fanIn:1, fanOut:1, instability:0.5, inCycle:true });
  });
});

describe('Health, churn and issue helpers', () => {
  it('handles percentile ties and single values', () => {
    expect(percentileRank([4])(4)).toBe(0.5);
    expect(percentileRank([2,2,2])(2)).toBe(0.5);
    expect(percentileRank([1,2,3])(3)).toBe(1);
  });

  it('produces bounded health values and flags without history', () => {
    const files = {
      'a.js': { id:'a.js', loc:50, functionIds:[], metrics:{ complexity:8, fanIn:7, fanOut:4, instability:0.8, inCycle:true, blastRadius:3, testsAffected:[] } },
      'b.js': { id:'b.js', loc:12, functionIds:[], metrics:{ complexity:2, fanIn:0, fanOut:1, instability:1, inCycle:false, blastRadius:1, testsAffected:[] } }
    };
    scoreHealth(files, null, {});
    for (const file of Object.values(files)) expect(file.metrics.health).toBeGreaterThanOrEqual(0);
    for (const file of Object.values(files)) expect(file.metrics.health).toBeLessThanOrEqual(100);
    expect(files['a.js'].metrics.approximate).toBe(true);
    expect(files['a.js'].metrics.flags.some(flag => flag.code === 'CYCLE')).toBe(true);
  });

  it('parses numstat while ignoring binary changes', () => {
    const stat = parseNumstat('__COMMIT__abc\n3\t2\tsrc/a.js\n-\t-\timg.png\n__COMMIT__def\n1\t0\tsrc/a.js\n');
    expect(stat.get('src/a.js')).toMatchObject({ commits:2, added:4, deleted:2 });
    expect(stat.has('img.png')).toBe(false);
  });

  it('matches issue paths first and otherwise heuristically', () => {
    expect(matchIssueToFiles({ title:'Bug in src/app.js', body:'' }, ['src/app.js','src/other.ts'])).toEqual(['src/app.js']);
  });
});
