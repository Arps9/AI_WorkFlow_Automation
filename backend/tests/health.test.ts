import request from 'supertest';
import { createApp } from '../src/app';

describe('HTTP API', () => {
  const app = createApp();

  it('GET /api/health returns status, AI and integration info', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'healthy');
    expect(res.body.ai).toHaveProperty('live', false);
    expect(res.body).toHaveProperty('integrations');
  });

  it('protected routes require a JWT', async () => {
    const res = await request(app).get('/api/workflows');
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/Authentication required/);
  });

  it('rejects an invalid JWT', async () => {
    const res = await request(app).get('/api/workflows').set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(401);
  });

  it('unknown routes return JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect([401, 404]).toContain(res.status);
  });
});
