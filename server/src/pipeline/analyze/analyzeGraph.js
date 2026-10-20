import { tarjanSCC, findCycles } from './tarjan.js';
import { buildAdjacency } from '../resolve/buildGraph.js';
import { computeFanMetrics, condense } from './metrics.js';

export function analyzeGraph(graph) {
  const fileIds = Object.keys(graph.files);
  const importEdges = graph.edges.filter(edge => edge.type === 'import');
  const { out, inn } = buildAdjacency(fileIds, importEdges);
  const components = tarjanSCC(fileIds, out);
  const cycles = findCycles(components, out);
  const metrics = computeFanMetrics(graph.files, out, inn, cycles);
  const condensed = condense(components, out, inn);
  for (const [id, file] of Object.entries(graph.files)) file.metrics = { ...file.metrics, ...metrics[id] };
  const cycleEdgeSet = new Set();
  for (const cycle of cycles) for (let i = 0; i < cycle.path.length - 1; i++) cycleEdgeSet.add(`${cycle.path[i]}\0${cycle.path[i + 1]}`);
  for (const edge of graph.edges) {
    if (edge.type === 'import') edge.inCycle = cycleEdgeSet.has(`${edge.source}\0${edge.target}`) || (metrics[edge.source]?.inCycle && metrics[edge.target]?.inCycle);
  }
  return { ...graph, cycles, adjacency: { out, inn }, components, condensed, learningLevels: condensed.learningLevels };
}
