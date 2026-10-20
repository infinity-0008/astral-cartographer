import { CheckCircle2, Circle, LoaderCircle, AlertTriangle } from 'lucide-react';

const stages = [
  ['queued', 'Queue job'], ['cloning', 'Ingest source'], ['scanning', 'Scan project'], ['parsing', 'Parse AST'], ['resolving', 'Resolve imports'], ['analyzing', 'Analyze graph'], ['scoring', 'Score architecture'], ['onboarding', 'Build learning path'], ['persisting', 'Cache results'], ['done', 'Analysis complete']
];

export default function ProgressPanel({ status, progress, error, onBack }) {
  const current = status || 'queued';
  const currentIndex = stages.findIndex(([stage]) => stage === current);
  const failed = current === 'failed';
  const pct = current === 'done' ? 100 : failed ? 0 : Math.max(3, Math.min(96, currentIndex < 0 ? 8 : currentIndex / (stages.length - 1) * 100));
  return <div className="progress-screen"><div className="progress-card"><div className="progress-orbit"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-core">{failed ? <AlertTriangle size={25}/> : <LoaderCircle size={28} className="spin"/>}</div><i className="orbit-node one"/><i className="orbit-node two"/><i className="orbit-node three"/></div><span className="progress-eyebrow">ANALYSIS PIPELINE / {failed ? 'FAILED' : current === 'done' ? 'COMPLETE' : 'IN PROGRESS'}</span><h2>{failed ? 'This analysis hit a blocker.' : current === 'done' ? 'Your atlas is ready.' : 'Mapping your code universe.'}</h2><p>{error || progress?.message || 'Preparing the repository for analysis…'}</p><div className="progress-track"><i style={{width:`${pct}%`}}/></div><div className="progress-meta"><span>{failed ? 'NEEDS ATTENTION' : progress?.stage?.toUpperCase() || current.toUpperCase()}</span><b>{Math.round(pct)}%</b></div><div className="pipeline-list">{stages.slice(0,9).map(([stage,label],i)=>{ const done = stage === current ? false : (current === 'done' || i < currentIndex); const active = stage === current && !failed; return <div className={`pipeline-row ${done ? 'done' : active ? 'active' : ''}`} key={stage}>{done ? <CheckCircle2 size={15}/> : active ? <LoaderCircle size={15} className="spin"/> : <Circle size={15}/>}<span>{label}</span>{active && <small>WORKING</small>}</div>})}</div>{failed && <button className="button-secondary progress-back" onClick={onBack}>Back to repository launch</button>}{current === 'done' && <button className="button-primary progress-back" onClick={onBack}>Open atlas</button>}</div></div>;
}
