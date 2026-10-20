import { useRef, useState } from 'react';
import {
  ArrowRight, ArrowUpRight, Box, Braces, ChevronDown, CircleHelp, Command, FileCode2,
  GitBranch, Github, Layers3, Network, Search, ShieldCheck, Sparkles, Upload, Zap
} from 'lucide-react';
import { getStoredAnalyses } from '../lib/api.js';

const faqs = [
  { q: 'What languages can Astral analyze?', a: 'The current analyzer focuses on JavaScript and TypeScript source files: .js, .jsx, .ts, .tsx, .mjs and .cjs. It maps imports without executing the repository.' },
  { q: 'Can I analyze a private repository?', a: 'The current build accepts public GitHub repository URLs and ZIP uploads. Private GitHub access is not enabled by default; do not paste secrets or credentials into the URL.' },
  { q: 'How reliable is the call graph?', a: 'Import relationships are resolved statically where possible. Call relationships are a best-effort approximation: dynamic dispatch, callbacks and arbitrary object methods may not resolve.' },
  { q: 'What does the health score mean?', a: 'It combines structure signals such as complexity, file size, coupling and circular dependencies. When Git history is unavailable, scoring is marked approximate because churn cannot be measured.' },
  { q: 'Does the analyzer run code from my repository?', a: 'No. It reads source code as text and parses it into syntax trees. It does not execute scripts, install the repository dependencies or run build commands.' },
];

function MiniAtlas() {
  const nodes = [
    [96, 110, 25, 'core'], [180, 62, 16, 'auth'], [224, 146, 20, 'api'], [302, 80, 13, 'route'],
    [336, 180, 17, 'data'], [130, 212, 16, 'util'], [252, 246, 12, 'test'], [402, 125, 22, 'ui'],
    [430, 220, 12, 'hooks'], [45, 195, 10, 'cfg'], [330, 38, 10, 'lib']
  ];
  const edges = [[0,1],[0,2],[0,5],[1,3],[2,3],[2,4],[3,7],[4,7],[5,6],[6,4],[7,8],[10,3],[10,7]];
  return <svg className="mini-atlas" viewBox="0 0 480 295" role="img" aria-label="Illustration of a connected code dependency graph">
    <defs>
      <radialGradient id="atlasGlow"><stop stopColor="#14323b" stopOpacity=".7"/><stop offset="1" stopColor="#0b1119" stopOpacity="0"/></radialGradient>
      <filter id="softGlow"><feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <circle cx="245" cy="150" r="210" fill="url(#atlasGlow)" />
    {Array.from({ length: 8 }, (_, i) => <circle key={`orbit-${i}`} cx="245" cy="150" r={38 + i * 23} fill="none" stroke="#243442" strokeWidth=".65" strokeDasharray={i % 2 ? '2 9' : '1 7'} opacity=".52" />)}
    {edges.map(([a,b], i) => <g key={i}><line x1={nodes[a][0]} y1={nodes[a][1]} x2={nodes[b][0]} y2={nodes[b][1]} stroke="#3d6874" strokeWidth={i % 3 === 0 ? 1.6 : 1} opacity=".72" /><circle cx={(nodes[a][0]*.55 + nodes[b][0]*.45)} cy={(nodes[a][1]*.55 + nodes[b][1]*.45)} r="2" fill="#67cabe" /></g>)}
    {nodes.map(([x,y,r,name], i) => <g key={name} filter={i === 0 || i === 7 ? 'url(#softGlow)' : undefined}>
      <circle cx={x} cy={y} r={r + 4} fill={i === 0 ? '#4dd5bf' : i % 4 === 0 ? '#b4a3ff' : '#5bb9c9'} opacity=".07" />
      <circle cx={x} cy={y} r={r} fill={i === 0 ? '#1c5d5c' : i % 4 === 0 ? '#3b355e' : '#183442'} stroke={i === 0 ? '#71e5ce' : i % 4 === 0 ? '#a698ff' : '#55b7c5'} strokeWidth={i === 0 ? 1.5 : 1} />
      <circle cx={x} cy={y} r="3" fill={i === 0 ? '#aaffeb' : '#9ce8ed'} />
      <text x={x} y={y + r + 14} fontSize="9" textAnchor="middle" fill="#92a5b5" fontFamily="DM Mono, monospace">{name}</text>
    </g>)}
    <text x="22" y="24" fontSize="8" letterSpacing="2" fill="#5c7788" fontFamily="DM Mono, monospace">DEPENDENCY FIELD / 01</text>
    <text x="362" y="280" fontSize="8" letterSpacing="1.5" fill="#587a85" fontFamily="DM Mono, monospace">LIVE TOPOLOGY</text>
  </svg>;
}

export default function LaunchPage({ onAnalyze, onResume, apiOnline }) {
  const [url, setUrl] = useState('');
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [openFaq, setOpenFaq] = useState(0);
  const fileInput = useRef(null);
  const recent = getStoredAnalyses();

  const pickFile = candidate => {
    setError('');
    if (!candidate) return;
    if (!candidate.name.toLowerCase().endsWith('.zip')) { setError('Choose a .zip archive.'); return; }
    if (candidate.size > 25 * 1024 * 1024) { setError('ZIP uploads are capped at 25 MB.'); return; }
    setFile(candidate); setUrl('');
  };

  const submit = async () => {
    setError('');
    if (!file && !url.trim()) { setError('Paste a public GitHub URL or choose a ZIP archive to continue.'); return; }
    if (!file && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?\/?$/.test(url.trim())) {
      setError('Enter a repository URL in the form https://github.com/owner/repository'); return;
    }
    setBusy(true);
    try { await onAnalyze({ url: file ? null : url.trim(), file }); }
    catch (e) { setError(e.message || 'Could not start analysis.'); }
    finally { setBusy(false); }
  };

  return <div className="launch-page">
    <header className="launch-nav">
      <button className="brand-lockup" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Astral Cartographer home">
        <span className="brand-mark"><Network size={19} strokeWidth={1.8} /></span>
        <span className="brand-copy"><b>astral<span>.</span></b><small>CARTOGRAPHER</small></span>
      </button>
      <nav className="nav-links"><a href="#capabilities">Capabilities</a><a href="#workflow">Workflow</a><a href="#faq">FAQ</a></nav>
      <div className="nav-actions">
        <span className={`api-status ${apiOnline ? 'online' : 'offline'}`}><i />{apiOnline ? 'API connected' : 'API offline'}</span>
        <a href="#launch" className="nav-cta">Open atlas <ArrowUpRight size={15} /></a>
      </div>
    </header>

    <main>
      <section className="hero-shell" id="launch">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-spark"><Sparkles size={12}/></span> CODEBASE INTELLIGENCE, MAPPED <span className="eyebrow-line" /></div>
          <h1>Know your code.<br/><span>See the whole</span><br/>universe.</h1>
          <p className="hero-lede">Turn any JavaScript or TypeScript repository into a navigable map of dependencies, architectural risk and contributor pathways.</p>
          <div className="hero-proof"><span><GitBranch size={14}/> Dependency mapping</span><span><ShieldCheck size={14}/> Read-only analysis</span><span><Zap size={14}/> Built for speed</span></div>
        </div>
        <div className="hero-visual"><div className="hero-grid"/><div className="atlas-frame"><div className="atlas-frame-top"><span><i/> TOPOLOGY PREVIEW</span><span>FIG 001 — DEPENDENCY FIELD</span></div><MiniAtlas/><div className="atlas-frame-bottom"><span><b className="mini-status"/> 1,482 NODES DISCOVERED</span><span>IMPORT GRAPH <b>↗</b></span></div></div><div className="visual-orbit orbit-a"/><div className="visual-orbit orbit-b"/></div>
      </section>

      <section className="launch-section" aria-labelledby="start-heading">
        <div className="section-kicker"><span>01 / START AN ANALYSIS</span><span className="section-rule"/></div>
        <div className="launch-card">
          <div className="launch-card-heading"><div><h2 id="start-heading">Bring your repository into view.</h2><p>Start with a public GitHub repository or upload a source ZIP.</p></div><div className="supported-badges"><span>.JS</span><span>.TS</span><span>.JSX</span><span>.TSX</span></div></div>
          <div className="source-switch"><button type="button" className={!file ? 'switch-active' : ''} aria-pressed={!file} onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; }}><Github size={15}/> GitHub URL</button><button type="button" className={file ? 'switch-active' : ''} aria-pressed={Boolean(file)} onClick={() => fileInput.current?.click()}><Upload size={15}/> ZIP archive</button></div>
          <div className="input-row"><div className="repo-input-wrap"><Github size={17}/><input aria-label="Public GitHub repository URL" placeholder="https://github.com/owner/repository" value={url} disabled={Boolean(file) || busy} onChange={e => { setUrl(e.target.value); setError(''); }} onKeyDown={e => e.key === 'Enter' && submit()}/><span className="input-shortcut"><Command size={10}/> ↵</span></div><button className="analyze-btn" disabled={busy} onClick={submit}>{busy ? <span className="spinner"/> : <><span>Analyze repository</span><ArrowRight size={16}/></>}</button></div>
          <div className={`drop-zone ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files?.[0]); }}>
            {file ? <><FileCode2 size={18}/><div><b>{file.name}</b><small>{(file.size / 1024 / 1024).toFixed(2)} MB · ZIP archive selected</small></div><button className="text-button" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ''; }}>Remove</button></> : <><Upload size={17}/><span>or drop a <b>.zip</b> file here</span><button className="browse-link" onClick={() => fileInput.current?.click()}>Browse files <ArrowUpRight size={13}/></button></>}
            <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={e => pickFile(e.target.files?.[0])}/>
          </div>
          {error && <div className="inline-error"><CircleHelp size={15}/>{error}</div>}
          <div className="launch-footnote"><ShieldCheck size={13}/> Repositories are parsed as source text. Your code is never executed. <span>25 MB ZIP limit</span></div>
        </div>
        {recent.length > 0 && <div className="recent-list"><div className="recent-heading"><span>RECENT ANALYSES</span><span>Stored in this browser</span></div>{recent.slice(0, 4).map(item => <button key={item.id} className="recent-row" onClick={() => onResume(item)}><span className="recent-icon"><GitBranch size={15}/></span><span className="recent-repo"><b>{item.name || item.url || 'Uploaded repository'}</b><small>{item.when || 'Previous analysis'} · {item.files ? `${item.files.toLocaleString()} files` : 'Open analysis'}</small></span><span className="recent-state"><i className={item.status === 'done' ? 'state-done' : item.status === 'failed' ? 'state-failed' : ''}/>{item.status || 'saved'}</span><ArrowRight size={15}/></button>)}</div>}
      </section>

      <section className="capabilities-section" id="capabilities">
        <div className="section-kicker"><span>02 / WHAT YOU CAN DISCOVER</span><span className="section-rule"/></div>
        <div className="capabilities-intro"><h2>Not just a file tree.<br/><span>A map of how it works.</span></h2><p>Move from a bird's-eye view into the individual files, paths and decisions that shape the system.</p></div>
        <div className="capability-grid">
          <article className="capability-card capability-wide"><div className="cap-icon teal"><Network size={18}/></div><div className="cap-card-copy"><div className="cap-label">01 / STRUCTURE</div><h3>Explore every dependency.</h3><p>Trace import relationships, cluster files by folder and expose circular dependencies before they become architectural debt.</p></div><div className="mini-graph-art"><div className="art-line l1"/><div className="art-line l2"/><div className="art-line l3"/><i className="art-node n1"/><i className="art-node n2"/><i className="art-node n3"/><i className="art-node n4"/><i className="art-node n5"/></div></article>
          <article className="capability-card"><div className="cap-icon violet"><Braces size={18}/></div><div className="cap-label">02 / COMPLEXITY</div><h3>Find the risky parts.</h3><p>Inspect cyclomatic complexity, coupling, churn and architectural health flags.</p><div className="bar-stack"><i style={{width:'42%'}}/><i style={{width:'78%'}}/><i style={{width:'56%'}}/><i style={{width:'91%'}}/></div></article>
          <article className="capability-card"><div className="cap-icon amber"><Layers3 size={18}/></div><div className="cap-label">03 / CONTRIBUTION</div><h3>Find your starting point.</h3><p>Follow a dependency-first learning path and discover lower-risk files that make good first contributions.</p><div className="pathway-art"><span>base</span><b/><span>utils</span><b/><span>feature</span></div></article>
        </div>
      </section>

      <section className="workflow-section" id="workflow"><div className="section-kicker"><span>03 / HOW IT WORKS</span><span className="section-rule"/></div><div className="workflow-head"><h2>From source to signal.</h2><p>A transparent pipeline, with progress and failure details at every stage.</p></div><div className="workflow-steps">{[
        ['01','Ingest','Clone a public repo or validate a ZIP archive.'],['02','Parse','Build ASTs in parallel; extract functions, imports and complexity.'],['03','Resolve','Map imports across aliases, extension fallbacks and workspaces.'],['04','Analyze','Detect cycles, compute blast radius and score architectural health.'],['05','Explore','Search files, inspect hotspots and plan a safer onboarding path.']
      ].map(([n,title,desc],i)=><div className="workflow-step" key={n}><div className="step-top"><span>{n}</span>{i < 4 && <div/>}</div><h3>{title}</h3><p>{desc}</p></div>)}</div></section>

      <section className="faq-section" id="faq"><div className="faq-heading"><div className="section-kicker"><span>04 / FAQ</span><span className="section-rule"/></div><h2>Good questions.<br/><span>Clear answers.</span></h2><p>Know what goes into an analysis before you connect a repository.</p></div><div className="faq-list">{faqs.map((faq,i)=><div className={`faq-item ${openFaq === i ? 'faq-open' : ''}`} key={faq.q}><button onClick={() => setOpenFaq(openFaq === i ? -1 : i)} aria-expanded={openFaq === i}><span>{faq.q}</span><ChevronDown size={16}/></button>{openFaq === i && <p>{faq.a}</p>}</div>)}</div></section>
    </main>
    <footer className="launch-footer"><div className="brand-lockup"><span className="brand-mark"><Network size={17}/></span><span className="brand-copy"><b>astral<span>.</span></b><small>CARTOGRAPHER</small></span></div><span>Built to make unfamiliar code feel navigable.</span><span className="footer-meta">M3 / CODEBASE INTELLIGENCE <i/></span></footer>
  </div>;
}
