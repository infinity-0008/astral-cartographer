import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('HTTP API guardrails', () => {
  it('exposes a health endpoint without requiring a database query', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('rejects non-GitHub URLs before creating a database record', async () => {
    const res = await request(app).post('/api/analyses').send({ url: 'http://127.0.0.1:8080' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_GITHUB_URL');
  });

  it('returns a JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/not-a-real-route');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ROUTE_NOT_FOUND');
  });
});
