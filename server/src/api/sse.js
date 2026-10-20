import { Analysis } from '../models/Analysis.js';
import { asyncRoute } from '../utils/errors.js';
import { subscribeToJob } from '../jobs/jobManager.js';

function writeEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export const streamAnalysisEvents = asyncRoute(async (req, res) => {
  const initial = await Analysis.findById(req.params.id).lean();
  if (!initial) return res.status(404).json({ error: 'Analysis not found.', code: 'ANALYSIS_NOT_FOUND' });
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  let closed = false;
  let heartbeat;
  let unsubscribe = () => {};
  const cleanup = () => {
    if (closed) return;
    closed = true;
    unsubscribe();
    if (heartbeat) clearInterval(heartbeat);
  };
  unsubscribe = subscribeToJob(req.params.id, event => {
    if (closed) return;
    writeEvent(res, 'progress', event);
    if (['done', 'failed'].includes(event.status)) { cleanup(); res.end(); }
  });
  // Re-read after subscribing so an event cannot be lost between the first read and subscription.
  const current = await Analysis.findById(req.params.id).lean();
  if (!current) { cleanup(); res.end(); return; }
  writeEvent(res, 'progress', {
    id: String(current._id), status: current.status, progress: current.progress, stats: current.stats,
    error: current.error, cached: current.cached
  });
  if (['done', 'failed'].includes(current.status)) { cleanup(); res.end(); return; }
  heartbeat = setInterval(() => { if (!closed) res.write(': heartbeat\n\n'); }, 20000);
  heartbeat.unref?.();
  req.on('close', cleanup);
});
