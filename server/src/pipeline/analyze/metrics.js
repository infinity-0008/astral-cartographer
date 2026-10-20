export function blastRadius(id, inn) {
  const seen = new Set();
  const queue = [...(inn.get(id) || [])];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    if (seen.has(current) || current === id) continue;
    seen.add(current);
    for (const parent of (inn.get(current) || [])) if (!seen.has(parent)) queue.push(parent);
  }
  return seen;
}

export function testsAffected(blastSet, files) {
  return [...blastSet].filter(id => files[id]?.isTest).sort();
}

export function computeFanMetrics(files, out, inn, cycles = []) {
  const cycleFiles = new Set(cycles.flatMap(cycle => cycle.files));
  const metrics = {};
  const ids = Object.keys(files);
  for (const id of ids) {
    const fanIn = (inn.get(id) || []).length;
    const fanOut = (out.get(id) || []).length;
    const instability = fanIn + fanOut ? fanOut / (fanIn + fanOut) : 0;
    const blast = blastRadius(id, inn);
    metrics[id] = {
      fanIn, fanOut, instability, blastRadius: blast.size,
      testsAffected: testsAffected(blast, files), inCycle: cycleFiles.has(id)
    };
  }
  return metrics;
}

export function condense(components, out, inn) {
  const componentByNode = new Map();
  components.forEach((component, i) => component.forEach(node => componentByNode.set(node, i)));
  const dagOut = new Map(components.map((_, i) => [i, new Set()]));
  const dagIn = new Map(components.map((_, i) => [i, new Set()]));
  for (const [source, targets] of out) {
    const a = componentByNode.get(source);
    for (const target of targets) {
      const b = componentByNode.get(target);
      if (a === undefined || b === undefined || a === b) continue;
      dagOut.get(a).add(b);
      dagIn.get(b).add(a);
    }
  }
  // Edges point from an importer to its dependencies. Dependency leaves receive level 0.
  const remainingDependencies = new Map([...dagOut].map(([id, targets]) => [id, targets.size]));
  const levelByComponent = new Map(components.map((_, i) => [i, 0]));
  const queue = [...remainingDependencies].filter(([, count]) => count === 0).map(([id]) => id);
  for (let head = 0; head < queue.length; head++) {
    const dependency = queue[head];
    for (const importer of dagIn.get(dependency) || []) {
      levelByComponent.set(importer, Math.max(levelByComponent.get(importer), levelByComponent.get(dependency) + 1));
      remainingDependencies.set(importer, remainingDependencies.get(importer) - 1);
      if (remainingDependencies.get(importer) === 0) queue.push(importer);
    }
  }
  const learningLevels = [];
  const nodes = [...componentByNode.keys()];
  const maxLevel = Math.max(0, ...nodes.map(node => levelByComponent.get(componentByNode.get(node)) || 0));
  for (let level = 0; level <= maxLevel; level++) {
    learningLevels.push(nodes.filter(node => levelByComponent.get(componentByNode.get(node)) === level).sort());
  }
  return { dagOut, dagIn, componentByNode, levelByComponent, learningLevels };
}
