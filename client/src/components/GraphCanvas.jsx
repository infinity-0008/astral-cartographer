import { useEffect, useMemo, useRef } from 'react';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';

cytoscape.use(fcose);

const palette = {
  health: (d) => d.health >= 80 ? '#56d6b5' : d.health >= 60 ? '#b7df79' : d.health >= 40 ? '#ffc66d' : '#ff7e87',
  complexity: (d) => d.complexity >= 15 ? '#ff7e87' : d.complexity >= 8 ? '#ffc66d' : d.complexity >= 4 ? '#9b92ff' : '#63b9db',
  churn: (d) => d.churn >= 30 ? '#ff7e87' : d.churn >= 10 ? '#ffc66d' : '#62c9bd',
  folder: (d) => {
    const colors = ['#65c9ce', '#a798ff', '#e4ae72', '#70c6a2', '#d58acb', '#90a9ed', '#c6ce72'];
    let hash = 0; for (const c of String(d.folder || d.id || 'root')) hash = (hash * 31 + c.charCodeAt(0)) | 0;
    return colors[Math.abs(hash) % colors.length];
  }
};

export default function GraphCanvas({ graph, colorBy, selectedId, query, showCyclesOnly, minRisk, onSelect, onFps }) {
  const containerRef = useRef(null);
  const cyRef = useRef(null);
  const callbacksRef = useRef({ onSelect, onFps });
  callbacksRef.current = { onSelect, onFps };
  const needle = String(query || '').trim().toLowerCase();

  const elements = useMemo(() => {
    const rawNodes = graph?.nodes || [];
    const visibleNodes = rawNodes.filter(node => {
      const d = node.data || node;
      if (showCyclesOnly && !d.inCycle) return false;
      if (Number(d.risk || 0) < minRisk / 100) return false;
      return true;
    });
    const visibleIds = new Set(visibleNodes.map(n => String((n.data || n).id)));
    const nodes = visibleNodes.map(item => {
      const data = item.data || item;
      const normalized = { ...data };
      normalized.fill = palette.health({ ...data, churn: Number(data.churn ?? data.churnAdded ?? 0) });
      normalized.label = data.label || data.path || data.id;
      normalized.isSelected = false;
      normalized.isMatch = false;
      return { data: normalized };
    });
    const edges = (graph?.edges || []).filter(item => {
      const d = item.data || item;
      return visibleIds.has(String(d.source)) && visibleIds.has(String(d.target));
    }).map(item => ({ data: item.data || item }));
    return [...nodes, ...edges];
  }, [graph, showCyclesOnly, minRisk]);

  useEffect(() => {
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      elements,
      pixelRatio: 'auto',
      hideEdgesOnViewport: true,
      textureOnViewport: true,
      wheelSensitivity: 0.18,
      minZoom: 0.08,
      maxZoom: 3.5,
      style: [
        { selector: 'node', style: {
          'background-color': 'data(fill)', 'label': 'data(label)', 'color': '#cbd4df',
          'font-family': 'DM Mono, monospace', 'font-size': 10, 'font-weight': 500,
          'text-wrap': 'ellipsis', 'text-max-width': 110, 'text-valign': 'bottom', 'text-margin-y': 8,
          'width': 'mapData(loc, 1, 500, 14, 36)', 'height': 'mapData(loc, 1, 500, 14, 36)',
          'border-width': ele => ele.data('inCycle') ? 3 : ele.data('parseError') ? 2 : 1,
          'border-color': ele => ele.data('inCycle') ? '#ff788d' : ele.data('isSelected') ? '#edf4ff' : ele.data('parseError') ? '#ffc66d' : '#263548',
          'background-opacity': ele => ele.data('isMatch') ? 1 : 0.88,
          'text-opacity': 0.94, 'overlay-opacity': 0, 'transition-property': 'border-width, background-color', 'transition-duration': 150
        }},
        { selector: 'node[isFolder]', style: { 'shape': 'round-rectangle', 'padding': 10, 'text-valign': 'center', 'font-size': 12, 'width': 'mapData(fileCount, 1, 100, 50, 88)', 'height': 'mapData(fileCount, 1, 100, 30, 55)', 'background-opacity': 0.65, 'border-width': 1.5, 'border-color': '#40566e' } },
        { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#f3f7ff', 'shadow-blur': 14, 'shadow-color': '#54d7cc', 'shadow-opacity': 0.4, 'shadow-offset-x': 0, 'shadow-offset-y': 0 } },
        { selector: 'node.search-match', style: { 'border-width': 3, 'border-color': '#f7d783', 'shadow-blur': 12, 'shadow-color': '#f7d783', 'shadow-opacity': 0.42 } },
        { selector: 'node.zoom-label-hidden', style: { 'label': '' } },
        { selector: 'node[inCycle]', style: { 'border-width': 3, 'border-color': '#ff7188' } },
        { selector: 'node[parseError]', style: { 'border-style': 'dashed', 'border-color': '#ffc66d' } },
        { selector: 'edge', style: {
          'width': 'mapData(weight, 1, 6, 1, 3)', 'line-color': '#34485d', 'target-arrow-color': '#59758c',
          'target-arrow-shape': 'triangle', 'arrow-scale': 0.8, 'curve-style': 'bezier', 'opacity': 0.55,
          'line-cap': 'round', 'label': 'data(label)', 'font-size': 8, 'color': '#8092a8', 'text-rotation': 'autorotate', 'text-background-opacity': 0.8, 'text-background-color': '#0e151f', 'text-background-padding': 2
        }},
        { selector: 'edge[inCycle]', style: { 'line-color': '#ff7188', 'target-arrow-color': '#ff7188', 'width': 2.4, 'opacity': 0.88 } },
        { selector: ':selected', style: { 'overlay-color': '#58d8d1', 'overlay-opacity': 0.1 } }
      ],
      layout: { name: 'fcose', animate: false, fit: true, padding: 44, randomize: true, quality: 'default', nodeRepulsion: 9200, idealEdgeLength: 95, edgeElasticity: 0.35, gravity: 0.22, numIter: 500, tile: true }
    });
    cyRef.current = cy;
    cy.on('tap', 'node', event => callbacksRef.current.onSelect?.(event.target.id()));
    cy.on('dbltap', 'node', () => cy.fit(cy.$('node'), 56));
    let labelsHidden = false;
    const updateLabelDensity = () => {
      const shouldHide = cy.zoom() < 0.42;
      if (shouldHide === labelsHidden) return;
      labelsHidden = shouldHide;
      cy.batch(() => cy.nodes().toggleClass('zoom-label-hidden', labelsHidden));
    };
    cy.on('zoom', updateLabelDensity);
    updateLabelDensity();
    let frames = 0; let last = performance.now(); let raf;
    const meter = now => {
      frames++;
      if (now - last >= 1200) { callbacksRef.current.onFps?.(Math.round(frames * 1000 / (now - last))); frames = 0; last = now; }
      raf = requestAnimationFrame(meter);
    };
    raf = requestAnimationFrame(meter);
    return () => { cancelAnimationFrame(raf); cy.destroy(); cyRef.current = null; };
  }, [elements]);


  useEffect(() => {
    if (!cyRef.current) return;
    const colorFn = palette[colorBy] || palette.health;
    cyRef.current.batch(() => cyRef.current.nodes().forEach(node => {
      const data = node.data();
      node.data('fill', colorFn({ ...data, churn: Number(data.churn ?? data.churnAdded ?? 0) }));
    }));
  }, [colorBy, elements]);

  useEffect(() => {
    if (!cyRef.current) return;
    const cy = cyRef.current;
    cy.nodes().unselect();
    if (selectedId && cy.getElementById(selectedId).length) cy.getElementById(selectedId).select();
  }, [selectedId, elements]);

  useEffect(() => {
    if (!cyRef.current) return;
    cyRef.current.batch(() => {
      cyRef.current.nodes().removeClass('search-match');
      if (!needle) return;
      cyRef.current.nodes().forEach(node => {
        const d = node.data();
        if (`${d.label || ''} ${d.path || ''} ${d.id || ''}`.toLowerCase().includes(needle)) node.addClass('search-match');
      });
    });
  }, [query, elements]);

  return <div className="graph-canvas-wrap">
    <div className="graph-watermark"><span className="watermark-dot" /> ASTRAL / TOPOLOGY ENGINE</div>
    <div className="graph-canvas" ref={containerRef} aria-label="Interactive repository dependency graph" />
    <div className="graph-compass"><span>N</span><div className="compass-cross">✣</div></div>
    <div className="graph-hint"><span>Click a node to inspect</span><i /> <span>Double-click to focus</span></div>
  </div>;
}
