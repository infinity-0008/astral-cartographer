import mongoose from 'mongoose';

const AnalysisSchema = new mongoose.Schema({
  cacheKey: { type: String, index: true },
  source: {
    type: { type: String, enum: ['github', 'zip'], required: true },
    url: String,
    filename: String,
    owner: String,
    repo: String
  },
  commitSha: String,
  status: {
    type: String,
    enum: ['queued', 'cloning', 'scanning', 'parsing', 'resolving', 'analyzing', 'scoring', 'onboarding', 'persisting', 'done', 'failed'],
    default: 'queued',
    index: true
  },
  progress: {
    stage: { type: String, default: 'queued' },
    done: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    message: { type: String, default: 'Waiting to start' }
  },
  stats: {
    files: { type: Number, default: 0 },
    loc: { type: Number, default: 0 },
    edges: { type: Number, default: 0 },
    cycles: { type: Number, default: 0 },
    parseMs: { type: Number, default: 0 },
    totalMs: { type: Number, default: 0 }
  },
  hasHistory: { type: Boolean, default: false },
  resultPath: String,
  snapshotPath: String,
  error: String,
  cached: { type: Boolean, default: false }
}, { timestamps: true, minimize: false });

AnalysisSchema.index({ cacheKey: 1, status: 1 });
export const Analysis = mongoose.models.Analysis || mongoose.model('Analysis', AnalysisSchema);
