const API_BASE = (import.meta.env.VITE_API_BASE || import.meta.env.VITE_API || 'http://localhost:4000').replace(/\/+$/, '');

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, options);
  } catch (error) {
    const friendly = new Error(`Could not reach the Astral API at ${API_BASE}. Start the backend and MongoDB, then retry.`);
    friendly.cause = error;
    throw friendly;
  }
  const type = response.headers.get('content-type') || '';
  const data = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(data?.error || data?.message || `Request failed (${response.status}).`);
    error.status = response.status;
    error.code = data?.code;
    throw error;
  }
  return data;
}

export const api = {
  base: API_BASE,
  health: () => request('/api/health'),
  createFromUrl: (url) => request('/api/analyses', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url })
  }),
  createFromZip: (file) => {
    const form = new FormData(); form.append('zip', file, file.name);
    return request('/api/analyses', { method: 'POST', body: form });
  },
  status: (id) => request(`/api/analyses/${encodeURIComponent(id)}`),
  graph: (id, view = 'file') => request(`/api/analyses/${encodeURIComponent(id)}/graph?view=${view}`),
  file: (id, filePath) => {
    const safePath = filePath.split('/').map(encodeURIComponent).join('/');
    return request(`/api/analyses/${encodeURIComponent(id)}/files/${safePath}`);
  },
  search: (id, q) => request(`/api/analyses/${encodeURIComponent(id)}/search?q=${encodeURIComponent(q)}`),
  cycles: (id) => request(`/api/analyses/${encodeURIComponent(id)}/cycles`),
  hotspots: (id) => request(`/api/analyses/${encodeURIComponent(id)}/hotspots?limit=30`),
  onboarding: (id) => request(`/api/analyses/${encodeURIComponent(id)}/onboarding`),
  impact: (id, files) => request(`/api/analyses/${encodeURIComponent(id)}/impact`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files })
  }),
  issues: (id) => request(`/api/analyses/${encodeURIComponent(id)}/issues`),
};

export function streamProgress(id, onProgress, onError) {
  const source = new EventSource(`${API_BASE}/api/analyses/${encodeURIComponent(id)}/events`);
  source.addEventListener('progress', (event) => {
    try { onProgress(JSON.parse(event.data)); } catch { /* ignore malformed event */ }
  });
  source.onerror = () => { onError?.(); };
  return source;
}

export function getStoredAnalyses() {
  try { return JSON.parse(localStorage.getItem('astral-recent-analyses') || '[]'); }
  catch { return []; }
}
export function storeAnalysis(item) {
  const previous = getStoredAnalyses().filter(entry => entry.id !== item.id);
  const next = [item, ...previous].slice(0, 8);
  localStorage.setItem('astral-recent-analyses', JSON.stringify(next));
  return next;
}
