import { EventEmitter } from 'node:events';
import { runPipeline } from './runPipeline.js';
import { logger } from '../utils/logger.js';

const MAX_ACTIVE = 2;
const MAX_QUEUED = 10;
const queue = [];
const channels = new Map();
let active = 0;

function channelFor(id) {
  if (!channels.has(String(id))) channels.set(String(id), new EventEmitter());
  return channels.get(String(id));
}

export function subscribeToJob(id, listener) {
  const emitter = channelFor(id);
  emitter.on('progress', listener);
  return () => {
    emitter.off('progress', listener);
    if (emitter.listenerCount('progress') === 0) channels.delete(String(id));
  };
}

function publish(id, event) {
  channelFor(id).emit('progress', event);
}

export function enqueueAnalysis(id, input) {
  if (queue.length >= MAX_QUEUED) throw new Error('Analysis queue is full. Try again in a minute.');
  queue.push({ id: String(id), input });
  drain();
}

function drain() {
  while (active < MAX_ACTIVE && queue.length) {
    const job = queue.shift();
    active++;
    runPipeline(job.id, job.input, event => publish(job.id, event))
      .catch(error => logger.error('Uncaught job manager error', error.message))
      .finally(() => {
        active--;
        const emitter = channels.get(job.id);
        if (emitter && emitter.listenerCount('progress') === 0) channels.delete(job.id);
        drain();
      });
  }
}

export function getQueueStats() { return { active, queued: queue.length, maxActive: MAX_ACTIVE, maxQueued: MAX_QUEUED }; }
