import { create } from 'zustand';

export const useAtlasStore = create((set) => ({
  analysisId: null,
  status: null,
  progress: null,
  stats: null,
  graph: { nodes: [], edges: [] },
  selectedId: null,
  selectedFile: null,
  query: '',
  searchMatches: [],
  filters: { ext: 'all', minRisk: 0, showCyclesOnly: false },
  colorBy: 'health',
  viewMode: 'file',
  tab: 'atlas',
  analysisMeta: null,
  set: (patch) => set(patch),
  setFilters: (patch) => set(state => ({ filters: { ...state.filters, ...patch } })),
  reset: () => set({ analysisId: null, status: null, progress: null, stats: null, graph: { nodes: [], edges: [] }, selectedId: null, selectedFile: null, query: '', searchMatches: [], filters: { ext: 'all', minRisk: 0, showCyclesOnly: false }, colorBy: 'health', viewMode: 'file', tab: 'atlas', analysisMeta: null })
}));
