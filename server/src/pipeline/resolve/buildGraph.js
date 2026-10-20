import { resolveImport } from './buildResolver.js';

export function buildAdjacency(nodes, edges) {
  const out = new Map(nodes.map(id => [id, []]));
  const inn = new Map(nodes.map(id => [id, []]));
  for (const edge of edges) {
    if (!out.has(edge.source) || !inn.has(edge.target)) continue;
    if (!out.get(edge.source).includes(edge.target)) out.get(edge.source).push(edge.target);
    if (!inn.get(edge.target).includes(edge.source)) inn.get(edge.target).push(edge.source);
  }
  return { out, inn };
}

export function buildGraph(parsedFiles, resolver) {
  const files = Object.fromEntries(parsedFiles.map(file => [file.id, {
    id: file.id, folder: file.id.includes('/') ? file.id.slice(0, file.id.lastIndexOf('/')) : '.',
    ext: file.id.slice(file.id.lastIndexOf('.')).toLowerCase(), loc: file.loc, tokens: file.tokens,
    sizeBytes: file.sizeBytes, contentHash: file.contentHash, imports: file.imports, exports: file.exports,
    externals: [], unresolved: [], functionIds: file.functions.map(fn => fn.id), isTest: file.isTest,
    parseError: file.parseError, metrics: { complexity: file.fileComplexity, maxFnComplexity: file.functions.length ? Math.max(...file.functions.map(fn => fn.complexity)) : 1 }
  }]));
  const functions = Object.fromEntries(parsedFiles.flatMap(file => file.functions.map(fn => [fn.id, fn])));
  const edges = [];
  for (const parsed of parsedFiles) {
    const file = files[parsed.id];
    for (const imp of file.imports) {
      const target = resolveImport(parsed.id, imp.spec, resolver);
      if (target === 'external') {
        file.externals.push(imp.spec);
        imp.resolvedTo = null;
      } else if (target && files[target]) {
        imp.resolvedTo = target;
        edges.push({ source: parsed.id, target, type: 'import', inCycle: false });
      } else {
        imp.resolvedTo = null;
        if (imp.spec.startsWith('.') || resolver.aliases.some(alias => imp.spec === alias.exact || (alias.prefix && imp.spec.startsWith(alias.prefix)))) file.unresolved.push(imp.spec);
      }
    }
    file.externals = [...new Set(file.externals)];
    file.unresolved = [...new Set(file.unresolved)];
  }
  const uniqueEdges = new Map();
  for (const edge of edges) uniqueEdges.set(`${edge.type}\0${edge.source}\0${edge.target}`, edge);
  return { files, functions, edges: [...uniqueEdges.values()], parsedFiles };
}

export function resolveCalls(graph) {
  const byFileAndName = new Map();
  const exportedByFile = new Map();
  for (const [id, fn] of Object.entries(graph.functions)) {
    const key = `${fn.file}::${fn.name}`;
    if (!byFileAndName.has(key)) byFileAndName.set(key, []);
    byFileAndName.get(key).push(id);
    if (fn.exported) {
      if (!exportedByFile.has(fn.file)) exportedByFile.set(fn.file, new Map());
      exportedByFile.get(fn.file).set(fn.name, id);
      if (fn.defaultExport) exportedByFile.get(fn.file).set('default', id);
    }
  }
  for (const parsed of graph.parsedFiles) {
    for (const raw of parsed.rawCalls || []) {
      let targetId = raw.sameFileTarget || null;
      if (!targetId && raw.viaImport) {
        const imp = graph.files[parsed.id]?.imports.find(item => item.spec === raw.viaImport.spec && item.resolvedTo);
        if (imp) {
          const exportMap = exportedByFile.get(imp.resolvedTo);
          targetId = exportMap?.get(raw.viaImport.importedName) || null;
          if (!targetId && raw.viaImport.importedName === '*') targetId = null;
        }
      }
      if (!targetId) {
        const same = byFileAndName.get(`${parsed.id}::${raw.calleeName}`) || [];
        if (same.length === 1) targetId = same[0];
      }
      const caller = graph.functions[raw.fromFnId];
      if (!targetId || !graph.functions[targetId] || !caller) {
        if (caller) caller.unresolvedCalls++;
        continue;
      }
      if (!caller.calls.includes(targetId)) caller.calls.push(targetId);
      graph.edges.push({ source: raw.fromFnId, target: targetId, type: 'call', inCycle: false });
    }
  }
  // The module pseudo-node is intentionally omitted from the user-facing call graph.
  graph.edges = graph.edges.filter(edge => edge.type !== 'call' || (graph.functions[edge.source] && graph.functions[edge.target]));
  const unique = new Map();
  for (const edge of graph.edges) unique.set(`${edge.type}\0${edge.source}\0${edge.target}`, edge);
  graph.edges = [...unique.values()];
  return graph;
}
