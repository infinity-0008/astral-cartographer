import { useCallback, useEffect, useRef, useState } from 'react';
import { Network } from 'lucide-react';
import LaunchPage from './components/LaunchPage.jsx';
import Workspace from './components/Workspace.jsx';
import ProgressPanel from './components/ProgressPanel.jsx';
import { api, getStoredAnalyses, storeAnalysis, streamProgress } from './lib/api.js';
import { useAtlasStore } from './store/useAtlasStore.js';

function displayName(source) {
  return source?.repo || source?.filename?.replace(/\.zip$/i, '') || 'repository';
}

export default function App() {
  const [screen, setScreen] = useState('launch');
  const [apiOnline, setApiOnline] = useState(false);
  const [error, setError] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [cycles, setCycles] = useState([]);
  const [folderGraph, setFolderGraph] = useState({ nodes: [], edges: [] });
  const [hotspots, setHotspots] = useState(null);
  const [onboarding, setOnboarding] = useState(null);
  const [issues, setIssues] = useState(null);
  const [impact, setImpact] = useState(null);
  const [impactBusy, setImpactBusy] = useState(false);
  const [fps, setFps] = useState(0);
  const [toast, setToast] = useState('');
  const streamRef = useRef(null);
  const pollRef = useRef(null);
  const loadingBundleRef = useRef(null);

  const analysisId = useAtlasStore(s => s.analysisId);
  const status = useAtlasStore(s => s.status);
  const progress = useAtlasStore(s => s.progress);
  const stats = useAtlasStore(s => s.stats);
  const graph = useAtlasStore(s => s.graph);
  const selectedId = useAtlasStore(s => s.selectedId);
  const selectedFile = useAtlasStore(s => s.selectedFile);
  const query = useAtlasStore(s => s.query);
  const searchMatches = useAtlasStore(s => s.searchMatches);
  const colorBy = useAtlasStore(s => s.colorBy);
  const viewMode = useAtlasStore(s => s.viewMode);
  const filters = useAtlasStore(s => s.filters);
  const tab = useAtlasStore(s => s.tab);
  const analysisMeta = useAtlasStore(s => s.analysisMeta);
  const set = useAtlasStore(s => s.set);
  const setFilters = useAtlasStore(s => s.setFilters);

  const flash = useCallback((message) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  }, []);

  useEffect(() => {
    let active = true;
    const check = () => api.health().then(() => { if (active) setApiOnline(true); }).catch(() => { if (active) setApiOnline(false); });
    check(); const timer = window.setInterval(check, 8000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const loadBundle = useCallback(async (id, sourceStatus = null) => {
    if (loadingBundleRef.current === id) return;
    loadingBundleRef.current = id;
    setGraphLoading(true);
    try {
      const currentStore = useAtlasStore.getState();
      const knownStats = sourceStatus?.stats || currentStore.stats;
      // Large repositories open folder-first so we do not force thousands of nodes
      // through the browser renderer before the user chooses to expand the detail view.
      const currentView = knownStats?.files >= 500 ? 'folder' : (currentStore.viewMode || 'file');
      const results = await Promise.allSettled([
        api.graph(id, currentView), api.graph(id, 'folder'), api.cycles(id), api.hotspots(id), api.onboarding(id), api.issues(id)
      ]);
      const graphResult = results[0];
      if (graphResult.status === 'fulfilled') {
        set({ graph: graphResult.value, viewMode: currentView });
        const data = graphResult.value.nodes || [];
        const selectedNow = useAtlasStore.getState().selectedId;
        if (!selectedNow && data.length) {
          const normalized = data.map(item => item.data || item);
          const first = currentView === 'folder'
            ? (normalized.find(item => item.id === '.') || normalized.find(item => item.isFolder) || normalized[0])
            : (normalized.find(item => !item.isFolder) || normalized[0]);
          set({ selectedId: first.id || first.path || null });
        }
      } else {
        throw graphResult.reason;
      }
      if (results[1].status === 'fulfilled') setFolderGraph(results[1].value);
      if (results[2].status === 'fulfilled') setCycles(results[2].value.cycles || []);
      if (results[3].status === 'fulfilled') setHotspots(results[3].value);
      if (results[4].status === 'fulfilled') setOnboarding(results[4].value);
      if (results[5].status === 'fulfilled') setIssues(results[5].value);
      setScreen('workspace'); setError('');
      if (sourceStatus) set({ status: { ...(useAtlasStore.getState().status || {}), ...sourceStatus }, stats: sourceStatus.stats || useAtlasStore.getState().stats });
    } catch (e) {
      setError(e.message || 'Could not load the analysis result.');
      flash(e.message || 'Could not load the analysis result.');
    } finally {
      setGraphLoading(false);
      loadingBundleRef.current = null;
    }
  }, [set, flash]);

  const refreshStatus = useCallback(async (id) => {
    const current = await api.status(id);
    set({ status: current, progress: current.progress, stats: current.stats, analysisMeta: current });
    const latest = getStoredAnalyses().find(item => item.id === id);
    if (latest) storeAnalysis({ ...latest, status: current.status, files: current.stats?.files || latest.files });
    if (current.status === 'done') {
      await loadBundle(id, current);
    } else if (current.status === 'failed') {
      setError(current.error || 'The analysis failed.');
      setScreen('processing');
    } else {
      setScreen('processing');
    }
    return current;
  }, [set, loadBundle]);

  useEffect(() => {
    if (!analysisId) return undefined;
    let alive = true;
    streamRef.current?.close();
    if (pollRef.current) window.clearInterval(pollRef.current);
    const onEvent = async event => {
      if (!alive) return;
      const nextStatus = event.status || 'queued';
      set({ status: { ...(useAtlasStore.getState().status || {}), ...event, status: nextStatus }, progress: event.progress || null, stats: event.stats || useAtlasStore.getState().stats });
      setError(event.error || '');
      const recentItem = getStoredAnalyses().find(item => item.id === analysisId);
      if (recentItem) storeAnalysis({ ...recentItem, status: nextStatus, files: event.stats?.files || recentItem.files });
      if (nextStatus === 'done') {
        setScreen('workspace');
        await loadBundle(analysisId, event);
        streamRef.current?.close();
        if (pollRef.current) window.clearInterval(pollRef.current);
      } else if (nextStatus === 'failed') {
        setScreen('processing'); streamRef.current?.close();
        if (pollRef.current) window.clearInterval(pollRef.current);
      } else setScreen('processing');
    };
    const source = streamProgress(analysisId, onEvent, () => {});
    streamRef.current = source;
    refreshStatus(analysisId).catch(e => { if (alive) { setError(e.message); setScreen('processing'); } });
    pollRef.current = window.setInterval(() => {
      api.status(analysisId).then(current => {
        if (!alive) return;
        set({ status: current, progress: current.progress, stats: current.stats, analysisMeta: current });
        if (current.status === 'done') { window.clearInterval(pollRef.current); loadBundle(analysisId, current); }
        if (current.status === 'failed') { window.clearInterval(pollRef.current); setError(current.error || 'The analysis failed.'); setScreen('processing'); }
      }).catch(() => {});
    }, 2500);
    return () => {
      alive = false; source.close();
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [analysisId, refreshStatus, loadBundle, set]);

  useEffect(() => {
    if (!analysisId || status?.status !== 'done') return;
    let cancelled = false;
    setGraphLoading(true);
    api.graph(analysisId, viewMode).then(data => {
      if (!cancelled) set({ graph: data, viewMode });
    }).catch(e => { if (!cancelled) flash(e.message); }).finally(() => { if (!cancelled) setGraphLoading(false); });
    return () => { cancelled = true; };
  }, [analysisId, viewMode, status?.status, set, flash]);

  useEffect(() => {
    if (!analysisId || status?.status !== 'done' || !selectedId || viewMode !== 'file') {
      if (viewMode === 'folder') set({ selectedFile: null });
      return;
    }
    let cancelled = false;
    setFileLoading(true);
    api.file(analysisId, selectedId).then(result => {
      if (!cancelled) set({ selectedFile: result });
    }).catch(() => { if (!cancelled) set({ selectedFile: null }); }).finally(() => { if (!cancelled) setFileLoading(false); });
    return () => { cancelled = true; };
  }, [analysisId, selectedId, viewMode, status?.status, set]);

  useEffect(() => {
    if (!analysisId || status?.status !== 'done' || !query.trim()) { set({ searchMatches: [] }); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.search(analysisId, query).then(result => { if (!cancelled) set({ searchMatches: result.matches || [] }); }).catch(() => { if (!cancelled) set({ searchMatches: [] }); });
    }, 220);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [analysisId, query, status?.status, set]);

  const startAnalysis = useCallback(async ({ url, file }) => {
    setError(''); set({ analysisId: null, status: null, progress: null, stats: null, graph: { nodes: [], edges: [] }, selectedId: null, selectedFile: null, query: '', searchMatches: [], viewMode: 'file', tab: 'atlas', filters: { ext: 'all', minRisk: 0, showCyclesOnly: false } });
    const result = file ? await api.createFromZip(file) : await api.createFromUrl(url);
    const recent = {
      id: result.id,
      name: file ? file.name.replace(/\.zip$/i, '') : new URL(url).pathname.split('/').filter(Boolean).at(-1)?.replace(/\.git$/i, '') || url,
      url: url || null,
      sourceType: file ? 'zip' : 'github',
      status: result.status || 'queued',
      when: new Date().toLocaleString(),
      files: null
    };
    storeAnalysis(recent);
    set({ analysisId: result.id, analysisMeta: { source: file ? { type: 'zip', filename: file.name } : { type: 'github', url, repo: recent.name }, status: 'queued' }, status: { status: 'queued', source: file ? { type: 'zip', filename: file.name } : { type: 'github', url, repo: recent.name } }, progress: { stage: 'queued', done: 0, total: 0, message: 'Waiting for the analyzer.' }, stats: null });
    setScreen('processing');
    return result;
  }, [set]);

  const resumeAnalysis = useCallback(async item => {
    setError(''); set({ analysisId: item.id, status: { status: item.status || 'queued' }, analysisMeta: { source: { type: item.sourceType || 'github', url: item.url, repo: item.name, filename: item.sourceType === 'zip' ? item.name : undefined } }, progress: null, stats: null, graph: {nodes:[],edges:[]}, selectedId: null, selectedFile: null, query: '', searchMatches: [], viewMode: 'file', tab: 'atlas' });
    setScreen('processing');
    try { await refreshStatus(item.id); }
    catch (e) { setScreen('launch'); flash(`This saved analysis could not be reopened: ${e.message}`); }
  }, [set, refreshStatus, flash]);

  const selectNode = useCallback((id) => {
    if (!id) return;
    const folderIds = new Set((folderGraph?.nodes || []).map(item => (item.data || item).id));
    set({ selectedId: id, tab: 'atlas', viewMode: folderIds.has(id) ? 'folder' : 'file' });
  }, [set, folderGraph]);

  const selectMatch = useCallback(match => {
    const path = match.file || match.id;
    if (path) { set({ selectedId: path, tab: 'atlas', query: '', viewMode: 'file' }); }
  }, [set]);

  const selectPath = useCallback(path => {
    if (path) set({ selectedId: path, tab: 'atlas' });
  }, [set]);

  const selectTab = useCallback(next => {
    if (next === 'folders') {
      const nodes = folderGraph?.nodes || [];
      const currentId = useAtlasStore.getState().selectedId;
      const folderIds = new Set(nodes.map(item => (item.data || item).id));
      set({ tab: next, viewMode: 'folder', selectedId: folderIds.has(currentId) ? currentId : (nodes.map(item => item.data || item).find(item => item.id === '.')?.id || nodes[0]?.data?.id || null), selectedFile: null });
    } else {
      set({ tab: next });
    }
  }, [set, folderGraph]);
  const selectViewMode = useCallback(value => {
    if (value === viewMode) return;
    set({ viewMode: value, selectedId: null, selectedFile: null, ...(value === 'folder' ? { filters: { ...filters, ext: 'all', minRisk: 0, showCyclesOnly: false } } : {}) });
  }, [set, filters, viewMode]);
  const selectFolder = useCallback(id => {
    if (!id) return;
    set({ viewMode: 'folder', selectedId: id, selectedFile: null, filters: { ...filters, ext: 'all', minRisk: 0, showCyclesOnly: false } });
  }, [set, filters]);
  const runImpact = useCallback(async files => {
    if (!analysisId) return;
    setImpactBusy(true); setImpact(null);
    try { setImpact(await api.impact(analysisId, files)); }
    catch (e) { flash(e.message || 'Impact analysis failed.'); }
    finally { setImpactBusy(false); }
  }, [analysisId, flash]);

  const returnHome = useCallback(() => {
    streamRef.current?.close();
    if (pollRef.current) window.clearInterval(pollRef.current);
    setScreen('launch'); setError(''); setCycles([]); setFolderGraph({ nodes: [], edges: [] }); setHotspots(null); setOnboarding(null); setIssues(null); setImpact(null);
    set({ analysisId: null, status: null, progress: null, stats: null, graph: {nodes:[],edges:[]}, selectedId: null, selectedFile: null, query: '', searchMatches: [], viewMode: 'file', tab: 'atlas', analysisMeta: null });
  }, [set]);

  const openGuide = useCallback(() => {
    returnHome();
    window.setTimeout(() => document.getElementById('faq')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }, [returnHome]);

  const refresh = useCallback(async () => {
    if (!analysisId) return;
    setGraphLoading(true);
    try {
      const current = await api.status(analysisId);
      set({ status: current, progress: current.progress, stats: current.stats, analysisMeta: current });
      if (current.status === 'done') {
        const results = await Promise.allSettled([
          api.graph(analysisId, viewMode), api.graph(analysisId, 'folder'), api.cycles(analysisId),
          api.hotspots(analysisId), api.onboarding(analysisId), api.issues(analysisId)
        ]);
        if (results[0].status === 'rejected') throw results[0].reason;
        set({ graph: results[0].value });
        if (results[1].status === 'fulfilled') setFolderGraph(results[1].value);
        if (results[2].status === 'fulfilled') setCycles(results[2].value.cycles || []);
        if (results[3].status === 'fulfilled') setHotspots(results[3].value);
        if (results[4].status === 'fulfilled') setOnboarding(results[4].value);
        if (results[5].status === 'fulfilled') setIssues(results[5].value);
        flash('Analysis data refreshed.');
      } else flash(`Analysis status: ${current.status}`);
    } catch (e) { flash(e.message); }
    finally { setGraphLoading(false); }
  }, [analysisId, viewMode, set, flash]);

  const displayAnalysis = analysisMeta || status || null;
  if (screen === 'launch' || !analysisId) return <><LaunchPage onAnalyze={startAnalysis} onResume={resumeAnalysis} apiOnline={apiOnline}/>{toast && <div className="toast-message">{toast}</div>}</>;
  if (screen === 'processing' || status?.status !== 'done') return <><ProgressScreenWrapper onBack={returnHome} status={status} progress={progress} error={error} apiOnline={apiOnline}/>{toast && <div className="toast-message">{toast}</div>}</>;

  return <><Workspace
    analysis={displayAnalysis}
    status={status || { stats }} progress={progress} error={error} graph={graph} graphLoading={graphLoading}
    selectedId={selectedId} fileData={selectedFile} fileLoading={fileLoading}
    query={query} searchMatches={searchMatches} colorBy={colorBy} viewMode={viewMode} filters={filters} tab={tab}
    cycles={cycles} hotspots={hotspots} onboarding={onboarding} issues={issues} impact={impact} impactBusy={impactBusy}
    fps={fps} apiOnline={apiOnline} onFpsUpdate={setFps} onBack={returnHome} onRefresh={refresh} onTab={selectTab} onQuery={q=>set({query:q})}
    onSelectNode={selectNode} onSelectFolder={selectFolder} onGuide={openGuide} folderGraph={folderGraph} onSelectMatch={selectMatch} onColorBy={value=>set({colorBy:value})}
    onViewMode={selectViewMode} onFilter={setFilters} onRunImpact={runImpact} onSelectPath={selectPath} onOpenFromHistory={resumeAnalysis}
  />{toast && <div className="toast-message">{toast}</div>}</>;
}

function ProgressScreenWrapper({ onBack, status, progress, error, apiOnline }) {
  return <div className="processing-shell"><header className="processing-topbar"><button className="workspace-brand" onClick={onBack}><span className="brand-mark"><Network size={18}/></span><span>astral<span>.</span></span></button><div className="topbar-spacer"/><span className={`api-mini ${apiOnline?'':'offline'}`}><i/>{apiOnline ? 'API connected' : 'API offline'}</span><button className="icon-button" onClick={onBack}>Back to launch</button></header><ProgressPanel status={status?.status || 'queued'} progress={progress || status?.progress} error={error || status?.error} onBack={onBack}/></div>;
}
