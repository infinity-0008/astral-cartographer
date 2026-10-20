import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Braces, Check, Clipboard, Code2, FileCode2, GitBranch, Package, ShieldAlert } from 'lucide-react';

const extLabel = ext => (ext || 'file').replace('.', '').toUpperCase();
const short = (value, max = 38) => value?.length > max ? `${value.slice(0, max - 1)}…` : value;

export default function CodePanel({ fileData, graph, selectedId, loading, onSelectPath }) {
  const [tab, setTab] = useState('overview');
  const [copied, setCopied] = useState(false);
  const file = fileData?.file;
  const source = fileData?.source;
  const metrics = file?.metrics || {};
  const importedBy = (graph?.edges || []).map(edge => edge.data || edge).filter(edge => edge.target === file?.id && edge.type !== 'call').map(edge => edge.source).filter((value, index, values) => values.indexOf(value) === index);
  const codeLines = useMemo(() => (source || '').split('\n'), [source]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(source || selectedId || ''); setCopied(true); setTimeout(() => setCopied(false), 1400); } catch { setCopied(false); }
  };

  if (!selectedId) return <aside className="details-panel details-empty"><div className="empty-crosshair"><Code2 size={24}/></div><h3>Select a node to inspect</h3><p>Pick any file in the dependency atlas to explore its source, imports, complexity and impact radius.</p><div className="empty-tip"><span>TIP</span> Double-click a node to focus its neighborhood.</div></aside>;
  if (loading) return <aside className="details-panel details-loading"><div className="skeleton skeleton-title"/><div className="skeleton skeleton-line"/><div className="skeleton skeleton-line short"/><div className="skeleton skeleton-card"/><div className="skeleton skeleton-card"/></aside>;
  if (!file) return <aside className="details-panel details-empty"><AlertTriangle size={20}/><h3>File details unavailable</h3><p>The selected node may belong to a folder view. Switch to file view or choose another node.</p></aside>;

  return <aside className="details-panel">
    <div className="detail-title-row"><span className="file-type-icon"><FileCode2 size={17}/></span><div className="detail-title-text"><small>{file.folder || 'root'} /</small><h3 title={file.id}>{file.id.split('/').at(-1)}</h3></div><span className="ext-tag">{extLabel(file.ext)}</span></div>
    <div className="detail-path" title={file.id}>{file.id}</div>
    <div className="detail-metric-row"><div><span>HEALTH</span><b className={metrics.health >= 75 ? 'health-good' : metrics.health >= 50 ? 'health-mid' : 'health-bad'}>{metrics.health ?? 0}<small>/100</small></b></div><div><span>COMPLEXITY</span><b>{metrics.complexity ?? '—'}</b></div><div><span>LOC</span><b>{file.loc ?? '—'}</b></div></div>
    <div className="detail-tabs"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button><button className={tab === 'source' ? 'active' : ''} onClick={() => setTab('source')}>Source</button><button className={tab === 'functions' ? 'active' : ''} onClick={() => setTab('functions')}>Functions <span>{fileData.functions?.length || 0}</span></button></div>
    <div className="detail-scroll">
      {tab === 'overview' && <>
        <div className="detail-block"><div className="detail-block-head"><span><GitBranch size={14}/> Dependency metrics</span><span className="mono-muted">FILE</span></div><div className="metric-grid"><div><span>Fan-in</span><b>{metrics.fanIn ?? 0}</b><small>Files importing this</small></div><div><span>Fan-out</span><b>{metrics.fanOut ?? 0}</b><small>Imports made</small></div><div><span>Blast radius</span><b>{metrics.blastRadius ?? 0}</b><small>Transitive dependents</small></div><div><span>Max function</span><b>{metrics.maxFnComplexity ?? 1}</b><small>Complexity score</small></div></div></div>
        <div className="detail-block"><div className="detail-block-head"><span><ShieldAlert size={14}/> Architectural signals</span><span className="mono-muted">{metrics.flags?.length || 0} FLAGS</span></div>{metrics.approximate && <div className="approx-banner">Git history unavailable. Health score is structural and approximate.</div>}{metrics.flags?.length ? <div className="flag-list">{metrics.flags.map((flag,i)=><div className={`flag-item flag-${flag.code?.toLowerCase()}`} key={`${flag.code}-${i}`}><AlertTriangle size={13}/><div><b>{flag.code?.replaceAll('_',' ')}</b><p>{flag.reason}</p></div></div>)}</div> : <div className="clean-state"><Check size={14}/> No active risk flags for this file.</div>}</div>
        <div className="detail-block"><div className="detail-block-head"><span><ArrowUpRight size={14}/> Imports ({file.imports?.length || 0})</span></div>{file.imports?.length ? <div className="path-list">{file.imports.map((imp,i)=><button key={`${imp.spec}-${i}`} disabled={!imp.resolvedTo} onClick={() => imp.resolvedTo && onSelectPath?.(imp.resolvedTo)}><span className={imp.resolvedTo ? 'resolved-dot' : 'unresolved-dot'}/><span className="path-list-name">{short(imp.spec,32)}</span><small>{imp.resolvedTo ? 'resolved' : 'external / unresolved'}</small></button>)}</div> : <p className="muted-copy">No import statements detected.</p>}</div>
        <div className="detail-block"><div className="detail-block-head"><span><ArrowDownLeft size={14}/> Imported by ({importedBy.length})</span></div>{importedBy.length ? <div className="path-list">{importedBy.slice(0,30).map(importer=><button key={importer} onClick={() => onSelectPath?.(importer)}><span className="resolved-dot"/><span className="path-list-name">{short(importer,36)}</span><small>open file</small></button>)}</div> : <p className="muted-copy">No incoming imports detected in the current graph.</p>}</div>
        {file.unresolved?.length > 0 && <div className="detail-block"><div className="detail-block-head"><span><AlertTriangle size={14}/> Unresolved imports</span></div><div className="chip-wrap">{file.unresolved.map((item,i)=><span className="warning-chip" key={`${item}-${i}`}>{item}</span>)}</div></div>}
        {file.externals?.length > 0 && <div className="detail-block"><div className="detail-block-head"><span><Package size={14}/> External packages</span></div><div className="chip-wrap">{file.externals.slice(0,16).map(x=><span className="quiet-chip" key={x}>{x}</span>)}</div></div>}
        <div className="detail-block"><div className="detail-block-head"><span><ArrowDownLeft size={14}/> Exports</span></div><div className="chip-wrap">{file.exports?.length ? file.exports.map(x=><span className="code-chip" key={x}>{x}</span>) : <span className="muted-copy">No exports detected.</span>}</div></div>
      </>}
      {tab === 'source' && <div className="source-view"><div className="source-header"><span><Code2 size={13}/> READ ONLY</span><button onClick={copy}><Clipboard size={13}/>{copied ? 'Copied' : 'Copy'}</button></div>{source === null || source === undefined ? <div className="source-empty">Source snapshot is unavailable.</div> : <pre>{codeLines.map((line,i)=><div className="source-line" key={i}><span>{i+1}</span><code>{line || ' '}</code></div>)}</pre>}</div>}
      {tab === 'functions' && <>
        {fileData.functions?.length ? <>
          <div className="call-resolution-summary"><span>Static call resolution</span><b>{fileData.functions.reduce((n,fn)=>n+(fn.calls?.length||0),0)} resolved</b><b>{fileData.functions.reduce((n,fn)=>n+(fn.unresolvedCalls||0),0)} unresolved</b></div>
          <div className="function-list">{fileData.functions.map(fn=><div className="function-card" key={fn.id}><div className="function-card-top"><Braces size={13}/><b>{fn.name}</b><span className="complexity-pill">CC {fn.complexity}</span></div><div className="function-meta">Lines {fn.startLine}–{fn.endLine} · {fn.kind}{fn.exported ? ' · exported' : ''}</div>{fn.calls?.length > 0 && <div className="function-call-list"><span>CALLS</span>{fn.calls.slice(0,8).map(callId=>{const hashAt=callId.lastIndexOf('#');const targetFile=hashAt >= 0 ? callId.slice(0,hashAt) : callId;const targetFn=(hashAt >= 0 ? callId.slice(hashAt+1) : callId).split('@')[0];return <button key={callId} onClick={()=>onSelectPath?.(targetFile)} title={callId}><b>{targetFn}</b><small>{targetFile}</small></button>;})}</div>}<div className="function-foot"><span>{fn.calls?.length || 0} resolved calls</span><span>{fn.unresolvedCalls || 0} unresolved</span></div></div>)}</div>
        </> : <div className="source-empty">No functions discovered in this file.</div>}
      </>}
    </div>
  </aside>;
}
