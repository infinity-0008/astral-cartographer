export function tarjanSCC(nodes, out) {
  let nextIndex = 0;
  const index = new Map();
  const lowlink = new Map();
  const onStack = new Set();
  const componentStack = [];
  const components = [];

  for (const root of nodes) {
    if (index.has(root)) continue;
    const frames = [{ node: root, parent: null, next: 0, entered: false }];
    while (frames.length) {
      const frame = frames[frames.length - 1];
      const v = frame.node;
      if (!frame.entered) {
        frame.entered = true;
        index.set(v, nextIndex);
        lowlink.set(v, nextIndex);
        nextIndex++;
        componentStack.push(v);
        onStack.add(v);
      }
      const neighbors = out.get(v) || [];
      if (frame.next < neighbors.length) {
        const w = neighbors[frame.next++];
        if (!index.has(w)) {
          frames.push({ node: w, parent: v, next: 0, entered: false });
        } else if (onStack.has(w)) {
          lowlink.set(v, Math.min(lowlink.get(v), index.get(w)));
        }
        continue;
      }
      frames.pop();
      if (frame.parent !== null) lowlink.set(frame.parent, Math.min(lowlink.get(frame.parent), lowlink.get(v)));
      if (lowlink.get(v) === index.get(v)) {
        const component = [];
        let w;
        do {
          w = componentStack.pop();
          onStack.delete(w);
          component.push(w);
        } while (w !== v);
        component.sort();
        components.push(component);
      }
    }
  }
  return components;
}

function shortestCycleForComponent(component, out) {
  const allowed = new Set(component);
  const start = [...component].sort()[0];
  if ((out.get(start) || []).includes(start)) return [start, start];
  let best = null;
  for (const first of (out.get(start) || []).filter(n => allowed.has(n)).sort()) {
    const queue = [[first]];
    const seenDepth = new Map([[first, 1]]);
    while (queue.length) {
      const path = queue.shift();
      const node = path[path.length - 1];
      if (node === start) {
        const candidate = [start, ...path];
        if (!best || candidate.length < best.length) best = candidate;
        break;
      }
      if (best && path.length + 1 >= best.length) continue;
      for (const next of (out.get(node) || []).filter(n => allowed.has(n)).sort()) {
        const depth = path.length + 1;
        if (seenDepth.has(next) && seenDepth.get(next) <= depth) continue;
        seenDepth.set(next, depth);
        queue.push([...path, next]);
      }
    }
  }
  return best || [...component, start];
}

export function findCycles(components, out) {
  const cycles = [];
  for (const component of components) {
    const selfLoop = component.length === 1 && (out.get(component[0]) || []).includes(component[0]);
    if (component.length <= 1 && !selfLoop) continue;
    const path = shortestCycleForComponent(component, out);
    cycles.push({ id: cycles.length + 1, files: component, path, length: path.length - 1 });
  }
  return cycles;
}
