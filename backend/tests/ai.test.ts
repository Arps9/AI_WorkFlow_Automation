import { aiService } from '../src/services/ai/ai.service';
import { heuristicAgentStep } from '../src/services/ai/agent-fallback';

describe('AI service (offline heuristic fallback)', () => {
  const subject = 'URGENT: Production database query timeout on enterprise node';
  const body = 'Hello team, users are experiencing 504 timeouts on search queries. Needs immediate fix.';
  const sender = 'alex@enterprise-client.com';

  it('summarizes an email', async () => {
    const r = await aiService.summarizeEmail(subject, body, sender);
    expect(r.summary.length).toBeGreaterThan(10);
    expect(Array.isArray(r.keyPoints)).toBe(true);
    expect(r.isSimulated).toBe(true);
  });

  it('classifies urgent production issues as High priority', async () => {
    const r = await aiService.classifyEmail(subject, body, sender);
    expect(['Urgent', 'Bug/Issue']).toContain(r.category);
    expect(r.priority).toBe('High');
  });

  it('recommends an engineering action for incidents', async () => {
    const r = await aiService.extractActions(subject, body, sender);
    expect(['create_task', 'investigate_incident']).toContain(r.actionType);
  });

  it('drafts a reply', async () => {
    const r = await aiService.generateReply(subject, body, sender);
    expect(r.subject).toMatch(/^Re:/);
    expect(r.body.length).toBeGreaterThan(20);
  });

  it('suggests invoice workflow actions', async () => {
    const r = await aiService.analyzeEmail('Invoice INV-77 attached', 'Please find the attached invoice, payment due Friday.', 'billing@vendor.com');
    const tools = r.suggestedActions.map((a) => a.tool);
    expect(tools).toEqual(expect.arrayContaining(['drive_save_attachment', 'slack_send_message', 'jira_create_issue']));
  });

  it('extracts action items from meeting notes', async () => {
    const r = await aiService.analyzeMeeting('Sprint planning', [], 'Rahul: I will fix the OAuth bug by Friday.\nPriya: We decided to ship on Monday.');
    expect(r.actionItems.length).toBeGreaterThan(0);
    expect(r.decisions.length).toBeGreaterThan(0);
  });
});

describe('Agent fallback planner', () => {
  it('plans calendar + slack actions for a scheduling request', () => {
    const r = heuristicAgentStep("Schedule tomorrow's sprint planning at 2 PM and notify everyone on Slack", []);
    expect(r.toolCalls.map((c) => c.toolName)).toEqual(['calendar_create_event', 'slack_send_message']);
    expect(r.toolCalls[0].parameters.summary.toLowerCase()).toContain('sprint planning');
    expect(r.toolCalls[0].parameters.start).toMatch(/T14:00:00$/);
  });

  it('fetches emails first, then proposes Jira tickets for bug emails', () => {
    const msg = "Summarize today's emails and create Jira tasks for bugs";
    const first = heuristicAgentStep(msg, []);
    expect(first.toolCalls[0].toolName).toBe('gmail_fetch_unread');
    const second = heuristicAgentStep(msg, [
      { toolName: 'gmail_fetch_unread', parameters: {}, result: [
        { messageId: '1', subject: 'Login fails with 401', category: 'Bug/Issue', priority: 'High', sender: 'a@b.com' },
        { messageId: '2', subject: 'Lunch?', category: 'Normal', priority: 'Low', sender: 'c@d.com' },
      ] },
    ]);
    expect(second.replyMessage).toMatch(/2 emails/);
    expect(second.toolCalls).toHaveLength(1);
    expect(second.toolCalls[0].toolName).toBe('jira_create_issue');
  });

  it('routes "show pending Jira tasks" to jira search', () => {
    expect(heuristicAgentStep('Show pending Jira tasks', []).toolCalls[0].toolName).toBe('jira_search_issues');
  });

  it('routes document searches to smart search', () => {
    const r = heuristicAgentStep('Find documents related to Project Alpha', []);
    expect(r.toolCalls[0]).toMatchObject({ toolName: 'smart_search', parameters: { query: 'Project Alpha' } });
  });
});
