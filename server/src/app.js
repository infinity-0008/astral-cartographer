import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import routes from './api/routes.js';
import { config } from './config.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  const configuredOrigins = (config.clientOrigin || '')
    .split(',')
    .map(o => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const cleanOrigin = origin.replace(/\/+$/, '');
      if (
        configuredOrigins.includes('*') ||
        configuredOrigins.includes(cleanOrigin) ||
        configuredOrigins.some(o => o.includes('.vercel.app') && cleanOrigin.endsWith('.vercel.app'))
      ) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: false
  }));
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(express.urlencoded({ extended: false, limit: '16kb' }));
  app.get('/', (req, res) => res.json({ name: 'Astral Cartographer API', version: '1.0.0', docs: '/api/health' }));
  app.use('/api', routes);
  app.use((req, res) => res.status(404).json({ error: 'Route not found.', code: 'ROUTE_NOT_FOUND' }));
  return app;
}
