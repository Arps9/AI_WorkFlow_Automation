import { toolRegistry } from '../src/tools/tool-registry';

describe('Tool registry & safety guard', () => {
  const ctx = { userId: 'test-user' };

  it('registers tools for every integration', () => {
    for (const p of ['gmail', 'slack', 'jira', 'github', 'notion', 'drive', 'calendar']) {
      expect(toolRegistry.getForProvider(p).length).toBeGreaterThan(0);
    }
    expect(toolRegistry.get('gmail_search')?.requiresConfirmation).toBe(false);
    expect(toolRegistry.get('gmail_send_message')?.requiresConfirmation).toBe(true);
    expect(toolRegistry.get('jira_create_issue')?.requiresConfirmation).toBe(true);
  });

  it('hides workflow-only tools from the assistant manifest', () => {
    const names = toolRegistry.getAssistantToolManifest().map((t) => t.name);
    expect(names).toContain('smart_search');
    expect(names).not.toContain('system_save_digest');
    expect(names).not.toContain('gemini_classify');
  });

  it('blocks external writes without confirmation', async () => {
    const r = await toolRegistry.execute('gmail_send_message', { to: 'x@y.com', subject: 'S', body: 'B' }, ctx);
    expect(r).toMatchObject({ status: 'pending_confirmation', actionType: 'send_email' });
  });

  it('validates required parameters', async () => {
    await expect(toolRegistry.execute('jira_create_issue', {}, { ...ctx, confirmed: true })).rejects.toThrow(/summary/);
  });

  it('simulates confirmed actions when a provider is not connected (demo mode)', async () => {
    const r = await toolRegistry.execute('jira_create_issue', { summary: 'Login bug', description: 'Fails', priority: 'High' }, { ...ctx, confirmed: true });
    expect(r.simulated).toBe(true);
    expect(r.key).toMatch(/^AUTO-\d+/);
    const s = await toolRegistry.execute('slack_send_message', { channel: '#eng', message: 'hi' }, { ...ctx, confirmed: true });
    expect(s).toMatchObject({ status: 'sent', simulated: true });
  });

  it('reads demo data from every provider', async () => {
    expect((await toolRegistry.execute('gmail_fetch_unread', {}, ctx)).length).toBeGreaterThan(0);
    expect((await toolRegistry.execute('jira_search_issues', {}, ctx)).issues.length).toBeGreaterThan(0);
    expect((await toolRegistry.execute('github_list_pull_requests', {}, ctx)).pullRequests.length).toBeGreaterThan(0);
    expect((await toolRegistry.execute('calendar_list_events', {}, ctx)).events.length).toBeGreaterThan(0);
    expect((await toolRegistry.execute('drive_search_files', { query: 'alpha' }, ctx)).files.length).toBeGreaterThan(0);
    expect((await toolRegistry.execute('slack_summarize_channel', { channel: '#engineering' }, ctx)).summary).toBeTruthy();
  });

  it('creates calendar events with conflict detection', async () => {
    const r = await toolRegistry.execute('calendar_create_event', { summary: 'Sprint planning', start: 'tomorrow at 2pm' }, { ...ctx, confirmed: true });
    expect(r.status).toBe('created');
    expect(r.event.start).toMatch(/T14:00:00$/);
    expect(Array.isArray(r.conflicts)).toBe(true);
  });
});
