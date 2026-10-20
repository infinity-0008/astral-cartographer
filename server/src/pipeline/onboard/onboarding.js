import { blastRadius, testsAffected } from '../analyze/metrics.js';

const GENERATED = /(^|\/)(generated|dist|build|coverage|vendor|\.next)(\/|$)|\.generated\./i;

export function rankStarterFiles(files, inn, churnStats = null) {
  const all = Object.values(files);
  const norm = (key) => {
    const values = all.map(file => Number(file.metrics?.[key] ?? 0)).sort((a, b) => a - b);
    const p = value => {
      if (values.length < 2 || values[0] === values.at(-1)) return 0.5;
      let lower = 0, eq = 0;
      for (const item of values) { if (item < value) lower++; else if (item === value) eq++; }
      return (lower + Math.max(0, eq - 1) / 2) / (values.length - 1);
    };
    return p;
  };
  const maxRisk = norm('risk');
  const maxComplexity = norm('complexity');
  const maxBlast = norm('blastRadius');
  const maxLoc = (value) => {
    const vals = all.map(f => f.loc).sort((a,b) => a-b);
    if (vals.length < 2 || vals[0] === vals.at(-1)) return 0.5;
    let lower=0, eq=0; for (const x of vals) { if (x<value) lower++; else if(x===value) eq++; }
    return (lower + Math.max(0, eq - 1) / 2) / (vals.length - 1);
  };
  const churnValues = all.map(file => {
    const c = churnStats?.get(file.id);
    return c ? c.added + c.deleted : 0;
  }).sort((a,b)=>a-b);
  const churnP = value => {
    if (churnValues.length < 2 || churnValues[0] === churnValues.at(-1)) return 0.5;
    let lower=0, eq=0; for (const x of churnValues) { if (x<value) lower++; else if(x===value) eq++; }
    return (lower + Math.max(0,eq-1)/2)/(churnValues.length-1);
  };
  const candidates = [];
  for (const file of all) {
    if (file.loc < 10 || file.isTest || GENERATED.test(file.id) || maxRisk(file.metrics?.risk || 0) >= 0.8) continue;
    const pBlast = maxBlast(file.metrics?.blastRadius || 0);
    const pComplexity = maxComplexity(file.metrics?.complexity || 1);
    const c = churnStats?.get(file.id);
    const pChurn = c ? churnP(c.added + c.deleted) : 0;
    const pLoc = maxLoc(file.loc);
    const hasTest = (file.metrics?.testsAffected || []).length > 0;
    const score = Math.max(0, Math.min(1, 1 - (0.35 * pBlast + 0.25 * pComplexity + 0.20 * pChurn + 0.10 * pLoc) + (hasTest ? 0.10 : 0)));
    const reasons = [];
    if ((file.metrics?.blastRadius || 0) <= 3) reasons.push(`Changes have a small impact radius (${file.metrics.blastRadius} dependent files).`);
    if (pComplexity < 0.5) reasons.push('Lower-than-median complexity for this repository.');
    if (hasTest) reasons.push('Related tests are discoverable in the dependency graph.');
    if (!file.metrics?.inCycle) reasons.push('Not part of a circular import dependency.');
    if (!reasons.length) reasons.push('A comparatively lower-risk starting point based on repository metrics.');
    candidates.push({ file: file.id, score: Number(score.toFixed(3)), reasons, blastRadius: file.metrics?.blastRadius || 0, tests: file.metrics?.testsAffected || [] });
  }
  return candidates.sort((a,b) => b.score - a.score || a.file.localeCompare(b.file)).slice(0, 20);
}

export function buildLearningPath(learningLevels) {
  return learningLevels.map((files, level) => ({ level, files, description: level === 0 ? 'Start here: foundational files with no internal dependencies.' : `Level ${level + 1}: files built on earlier dependency levels.` }));
}

export function prImpact(changedFiles, files, inn, cycles = []) {
  const changed = [...new Set((changedFiles || []).map(String))].filter(id => files[id]);
  const affected = new Set();
  const testSet = new Set();
  for (const id of changed) {
    for (const dependent of blastRadius(id, inn)) affected.add(dependent);
    for (const test of files[id]?.metrics?.testsAffected || []) testSet.add(test);
  }
  const total = Math.max(1, Object.keys(files).length);
  let riskLabel = affected.size / total < 0.02 ? 'low' : affected.size / total < 0.10 ? 'medium' : 'high';
  const topRisk = [...Object.values(files)].sort((a,b)=>(b.metrics?.risk || 0)-(a.metrics?.risk || 0)).slice(0, Math.max(1, Math.ceil(total * 0.1)));
  const highImpact = new Set(topRisk.map(file => file.id));
  if (changed.some(id => files[id]?.metrics?.inCycle || highImpact.has(id))) {
    riskLabel = riskLabel === 'low' ? 'medium' : 'high';
  }
  return {
    changedFiles: changed,
    affectedFiles: [...affected].sort(),
    testsToRun: [...new Set([...testSet, ...[...affected].filter(id => files[id]?.isTest)])].sort(),
    affectedCount: affected.size,
    totalFiles: total,
    affectedPercent: Number((affected.size / total * 100).toFixed(2)),
    riskLabel,
    warnings: changed.flatMap(id => files[id]?.metrics?.flags || []).filter((flag, i, arr) => arr.findIndex(x => x.code === flag.code && x.reason === flag.reason) === i)
  };
}
