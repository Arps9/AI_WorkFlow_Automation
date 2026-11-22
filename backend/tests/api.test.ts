import request from 'supertest';
import { createApp } from '../src/app';
import { UserModel } from '../src/models/user.model';
import { signToken } from '../src/middleware/auth.middleware';

/** End-to-end HTTP tests for routes that work without a database (demo data paths). */
describe('Authenticated API (demo mode, no DB)', () => {
  const app = createApp();
  const user = { id: '64b000000000000000000001', email: 'demo@autoflow.ai', name: 'Demo', role: 'admin' as const };
  const token = signToken(user);
  const asUser = (u: typeof user | { id: string; email: string; name: string; role: 'user' }) =>
    jest.spyOn(UserModel, 'findById').mockReturnValue({ lean: () => ({ catch: () => Promise.resolve({ _id: u.id, ...u, isActive: true }) }) } as any);

  beforeEach(() => asUser(user));
  afterEach(() => jest.restoreAllMocks());

  it('lists the demo inbox merged with curated analysis', async () => {
    const res = await request(app).get('/api/gmail/messages').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('demo');
    expect(res.body.messages.length).toBeGreaterThan(3);
    expect(res.body.messages[0]).toHaveProperty('category');
  });

  it('assistant chat: summarize + propose Jira tickets (agent loop)', async () => {
    const res = await request(app).post('/api/assistant/chat').set('Authorization', `Bearer ${token}`).send({ message: "Summarize today's emails and create Jira tasks for bugs" });
    expect(res.status).toBe(200);
    const calls = res.body.message.toolCalls;
    expect(calls.find((c: any) => c.toolName === 'gmail_fetch_unread')?.status).toBe('executed');
    expect(calls.some((c: any) => c.toolName === 'jira_create_issue' && c.status === 'pending_confirmation')).toBe(true);
    expect(res.body.message.content).toMatch(/emails/);
  });

  it('assistant chat: schedule + notify returns two pending actions', async () => {
    const res = await request(app).post('/api/assistant/chat').set('Authorization', `Bearer ${token}`).send({ message: "Schedule tomorrow's sprint planning at 11 AM and notify everyone on Slack" });
    expect(res.body.message.toolCalls.map((c: any) => c.toolName)).toEqual(['calendar_create_event', 'slack_send_message']);
  });

  it('confirms an action by tool name', async () => {
    const res = await request(app).post('/api/assistant/confirm-action').set('Authorization', `Bearer ${token}`).send({ toolName: 'jira_create_issue', parameters: { summary: 'Login 401', priority: 'High' } });
    expect(res.status).toBe(200);
    expect(res.body.result.key).toMatch(/^AUTO-/);
  });

  it('smart search spans multiple sources', async () => {
    const res = await request(app).get('/api/search').set('Authorization', `Bearer ${token}`).query({ q: 'Project Alpha', sources: 'drive,notion,jira,github' });
    expect(res.status).toBe(200);
    expect(res.body.counts.drive).toBeGreaterThan(0);
    expect(res.body.summary).toBeTruthy();
  });

  it('integrations list includes all seven services with credential forms', async () => {
    const res = await request(app).get('/api/integrations').set('Authorization', `Bearer ${token}`);
    expect(res.body.integrations.map((i: any) => i.id).sort()).toEqual(['calendar', 'drive', 'github', 'gmail', 'jira', 'notion', 'slack']);
    expect(res.body.integrations.find((i: any) => i.id === 'jira').credentialFields.length).toBe(4);
  });

  it('tool execution endpoint enforces confirmation for writes', async () => {
    const pending = await request(app).post('/api/tools/slack_send_message/execute').set('Authorization', `Bearer ${token}`).send({ parameters: { message: 'hi' } });
    expect(pending.body.result.status).toBe('pending_confirmation');
    const read = await request(app).post('/api/tools/github_repo_analytics/execute').set('Authorization', `Bearer ${token}`).send({ parameters: {} });
    expect(read.body.result.commitsLast30Days).toBeGreaterThan(0);
  });

  it('google auth url explains missing configuration', async () => {
    const res = await request(app).get('/api/auth/google/url').set('Authorization', `Bearer ${token}`);
    expect(res.body.configured).toBe(false);
  });

  it('RBAC: non-admin cannot list users', async () => {
    jest.restoreAllMocks();
    const u = { ...user, role: 'user' as const };
    asUser(u);
    const res = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${signToken(u)}`);
    expect(res.status).toBe(403);
  });
});
