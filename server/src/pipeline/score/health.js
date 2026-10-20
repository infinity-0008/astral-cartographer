function makePercentile(values) {
  const finite = values.filter(Number.isFinite).sort((a, b) => a - b);
  return (value) => {
    if (!finite.length || !Number.isFinite(value)) return 0;
    if (finite.length === 1 || finite[0] === finite.at(-1)) return 0.5;
    let lower = 0, equal = 0;
    for (const item of finite) { if (item < value) lower++; else if (item === value) equal++; }
    const midRank = lower + Math.max(0, equal - 1) / 2;
    return Math.max(0, Math.min(1, midRank / (finite.length - 1)));
  };
}

export function percentileRank(values) {
  return makePercentile(values);
}

function clamp01(value) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }

export function scoreHealth(files, churnStats = null, functions = {}) {
  const rows = Object.values(files);
  const pLoc = makePercentile(rows.map(f => f.loc));
  const pComplexity = makePercentile(rows.map(f => f.metrics?.complexity ?? 0));
  const pCoupling = makePercentile(rows.map(f => (f.metrics?.fanIn || 0) + (f.metrics?.fanOut || 0)));
  const pFunctions = makePercentile(rows.map(f => f.functionIds?.length || 0));
  const pChurn = makePercentile(rows.map(f => {
    const c = churnStats?.get(f.id);
    return c ? c.added + c.deleted : 0;
  }));
  const pFanIn = makePercentile(rows.map(f => f.metrics?.fanIn || 0));
  for (const file of rows) {
    const locRank = pLoc(file.loc);
    const complexityRank = pComplexity(file.metrics?.complexity ?? 0);
    const couplingRank = pCoupling((file.metrics?.fanIn || 0) + (file.metrics?.fanOut || 0));
    const functionRank = pFunctions(file.functionIds?.length || 0);
    const churn = churnStats?.get(file.id) || null;
    const churnRank = churn ? pChurn(churn.added + churn.deleted) : 0;
    const hotspot = churnStats ? clamp01(churnRank * complexityRank) : 0;
    const godScore = clamp01(0.30 * locRank + 0.25 * complexityRank + 0.25 * couplingRank + 0.20 * functionRank);
    const instability = clamp01(file.metrics?.instability || 0);
    const highFanIn = pFanIn(file.metrics?.fanIn || 0);
    const instabilityPenalty = clamp01(Math.max(0, (highFanIn - 0.65) / 0.35) * instability);
    let risk;
    if (churnStats) {
      risk = 0.40 * hotspot + 0.30 * godScore + 0.20 * (file.metrics?.inCycle ? 1 : 0) + 0.10 * instabilityPenalty;
    } else {
      // No usable Git history: structural-only approximation; weights are re-normalized.
      risk = 0.60 * godScore + 0.25 * (file.metrics?.inCycle ? 1 : 0) + 0.15 * instabilityPenalty;
    }
    file.metrics = {
      ...file.metrics,
      complexity: file.metrics?.complexity ?? 1,
      maxFnComplexity: file.functionIds?.length
        ? Math.max(1, ...file.functionIds.map(id => functions[id]?.complexity || 1)) : 1,
      churn: churn ? { ...churn } : undefined,
      hotspot, godScore, risk: clamp01(risk), health: Math.round(100 * (1 - clamp01(risk))),
      approximate: !churnStats,
      flags: []
    };
  }
  const riskRank = makePercentile(rows.map(f => f.metrics.risk));
  const complexityRank = makePercentile(rows.map(f => f.metrics.complexity));
  const churnRank = makePercentile(rows.map(f => (f.metrics.churn?.added || 0) + (f.metrics.churn?.deleted || 0)));
  const fanInRank = makePercentile(rows.map(f => f.metrics.fanIn));
  for (const file of rows) {
    const flags = [];
    const complexityP = Math.round(complexityRank(file.metrics.complexity) * 100);
    const churnP = Math.round(churnRank((file.metrics.churn?.added || 0) + (file.metrics.churn?.deleted || 0)) * 100);
    const fanInP = Math.round(fanInRank(file.metrics.fanIn) * 100);
    if (riskRank(file.metrics.risk) >= 0.8 && file.loc >= 10) flags.push({ code: 'GOD_FILE', reason: `High structural risk (${Math.round(file.metrics.risk * 100)}th percentile across this repository).` });
    if (file.metrics.hotspot >= 0.65 && file.metrics.churn) flags.push({ code: 'HOTSPOT', reason: `High change activity combined with complexity (churn percentile ${churnP}, complexity percentile ${complexityP}).` });
    if (file.metrics.inCycle) flags.push({ code: 'CYCLE', reason: 'This file participates in a circular import dependency.' });
    if (file.metrics.fanIn >= 5 && file.metrics.instability >= 0.65) flags.push({ code: 'UNSTABLE_CORE', reason: `Highly depended on (fan-in percentile ${fanInP}) and structurally unstable.` });
    file.metrics.flags = flags;
  }
  return files;
}
