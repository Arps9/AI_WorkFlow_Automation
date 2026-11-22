import { ToolDefinition, ToolContext } from './tool.interface';
import { aiService } from '../services/ai/ai.service';
import { gmailService } from '../services/gmail/gmail.service';
import { enrichEmails } from './gmail.tools';
import { searchService, SearchSource } from '../services/search/search.service';
import { knowledgeService } from '../services/knowledge/knowledge.service';

/** AI tools read their input from params first, then from the running workflow's context. */
async function emailsFrom(p: any, ctx: ToolContext): Promise<any[]> {
  if (Array.isArray(p.emails)) return p.emails;
  if (Array.isArray(ctx.workflow?.emails)) return ctx.workflow!.emails;
  const msgs = await gmailService.getUnreadMessages(ctx.userId, 10);
  return enrichEmails(msgs, ctx.userId);
}

const summarizeEmails: ToolDefinition = {
  name: 'ai_summarize_emails',
  displayName: 'AI Inbox Digest',
  description: 'Executive digest of emails: headline counts (urgent, meetings, client requests) and top priorities',
  provider: 'gemini',
  requiresConfirmation: false,
  parameters: { emails: { type: 'array', description: 'Emails (defaults to unread inbox / workflow context)' } },
  async execute(p, ctx) {
    const emails = await emailsFrom(p, ctx);
    const d = await aiService.generateDigest(emails);
    const lines = emails.slice(0, 10).map((e: any) => `• [${e.priority || '—'}] ${e.subject} — ${e.senderName || e.sender}`);
    return { ...d, emailCount: emails.length, digestText: `${d.headline}\n\n${d.summary}\n\n${lines.join('\n')}`, emails };
  },
};

const classifyEmails: ToolDefinition = {
  name: 'ai_classify_emails',
  displayName: 'AI Classify Emails',
  description: 'Returns category & priority for each email',
  provider: 'gemini',
  requiresConfirmation: false,
  workflowOnly: true,
  parameters: { emails: { type: 'array', description: 'Emails' } },
  async execute(p, ctx) {
    const emails = await emailsFrom(p, ctx);
    const classified = emails.map((e: any) => ({ messageId: e.messageId, subject: e.subject, category: e.category || 'Normal', priority: e.priority || 'Medium' }));
    const byCategory = classified.reduce<Record<string, number>>((a, c) => ((a[c.category] = (a[c.category] || 0) + 1), a), {});
    return { classified, byCategory, emails, message: `Classified ${classified.length} emails` };
  },
};

const detectUrgent: ToolDefinition = {
  name: 'ai_detect_urgent',
  displayName: 'AI Urgency Filter',
  description: 'Filters emails that are urgent, high priority or bug reports',
  provider: 'gemini',
  requiresConfirmation: false,
  workflowOnly: true,
  parameters: { emails: { type: 'array', description: 'Emails' }, includeBugs: { type: 'boolean', description: 'Include Bug/Issue category', default: true } },
  async execute(p, ctx) {
    const emails = await emailsFrom(p, ctx);
    const urgent = emails.filter((e: any) => e.priority === 'High' || e.category === 'Urgent' || (p.includeBugs !== false && e.category === 'Bug/Issue'));
    return { urgentCount: urgent.length, urgentEmails: urgent, firstUrgent: urgent[0] || null, message: `${urgent.length} of ${emails.length} emails need attention` };
  },
};

const extractBugs: ToolDefinition = {
  name: 'ai_extract_bug_details',
  displayName: 'AI Bug Report Extraction',
  description: 'Turns bug-report emails into structured tickets (title, severity, component, repro steps)',
  provider: 'gemini',
  requiresConfirmation: false,
  parameters: { emails: { type: 'array', description: 'Emails' }, subject: { type: 'string', description: 'Single email subject' }, body: { type: 'string', description: 'Single email body' } },
  async execute(p, ctx) {
    const list = p.subject ? [{ subject: p.subject, bodyText: p.body || '', sender: '' }] : (await emailsFrom(p, ctx)).filter((e: any) => ['Bug/Issue', 'Urgent'].includes(e.category) || /bug|error|fail|outage|incident/i.test(e.subject));
    const bugs = [];
    for (const e of list.slice(0, 5)) {
      const d = await aiService.extractBugDetails(e.subject, e.bodyText || e.snippet || e.summary || '');
      bugs.push({
        ...d,
        messageId: e.messageId,
        reporter: e.sender,
        description: `*Reported by:* ${e.senderName || e.sender || 'unknown'}\n*Severity:* ${d.severity}\n*Component:* ${d.component}\n*Environment:* ${d.environment}\n\nActual: ${d.actualBehavior}\nExpected: ${d.expectedBehavior}\n\nSteps to reproduce:\n${d.stepsToReproduce.map((s, i) => `${i + 1}. ${s}`).join('\n') || 'n/a'}\n\nSummary: ${e.summary || ''}`,
        jiraPriority: d.severity === 'Critical' ? 'Highest' : d.severity === 'High' ? 'High' : 'Medium',
      });
    }
    return { bugCount: bugs.length, bugs, firstBug: bugs[0] || null, message: `Extracted ${bugs.length} bug report(s)` };
  },
};

const draftReply: ToolDefinition = {
  name: 'ai_draft_reply',
  displayName: 'AI Draft Reply',
  description: 'Drafts a reply to an email (does not send it)',
  provider: 'gemini',
  requiresConfirmation: false,
  parameters: {
    subject: { type: 'string', description: 'Original subject', required: true },
    body: { type: 'string', description: 'Original body', required: true },
    sender: { type: 'string', description: 'Original sender' },
    instruction: { type: 'string', description: 'How to reply' },
  },
  execute: (p) => aiService.generateReply(p.subject, p.body, p.sender || '', p.instruction),
};

const analyzeMeeting: ToolDefinition = {
  name: 'ai_analyze_meeting',
  displayName: 'AI Meeting Notes',
  description: 'From meeting notes/transcript: summary, decisions, action items with owners & due dates, attendance',
  provider: 'gemini',
  requiresConfirmation: false,
  parameters: {
    title: { type: 'string', description: 'Meeting title', required: true },
    transcript: { type: 'string', description: 'Notes or transcript', required: true },
    attendees: { type: 'array', description: 'Invited people' },
  },
  async execute(p) {
    const a = await aiService.analyzeMeeting(p.title, p.attendees || [], p.transcript);
    const markdown = [
      `# ${p.title}`,
      '## Summary',
      a.summary,
      '## Decisions',
      ...(a.decisions.length ? a.decisions.map((d) => `- ${d}`) : ['- none recorded']),
      '## Action items',
      ...(a.actionItems.length ? a.actionItems.map((x) => `- [ ] ${x.task}${x.owner ? ` — ${x.owner}` : ''}${x.dueDate ? ` (due ${x.dueDate})` : ''}`) : ['- none']),
      '## Deadlines',
      ...(a.deadlines.length ? a.deadlines.map((d) => `- ${d}`) : ['- none']),
      '## Attendance',
      `- ${a.attendance.join(', ') || 'n/a'}`,
    ].join('\n');
    return { ...a, markdown, actionItemsWithDates: a.actionItems.filter((x) => x.dueDate) };
  },
};

const agenda: ToolDefinition = {
  name: 'ai_generate_agenda',
  displayName: 'AI Meeting Agenda',
  description: 'Generates a time-boxed agenda for a meeting',
  provider: 'gemini',
  requiresConfirmation: false,
  parameters: { title: { type: 'string', description: 'Meeting title', required: true }, attendees: { type: 'array', description: 'Attendees' }, context: { type: 'string', description: 'Background' } },
  async execute(p) {
    const r = await aiService.generateAgenda(p.title, p.attendees || [], p.context || '');
    return { ...r, agendaText: r.agenda.map((a) => `• ${a}`).join('\n') };
  },
};

const smartSearch: ToolDefinition = {
  name: 'smart_search',
  displayName: 'Smart Search',
  description: 'Natural-language search across Gmail, Drive, Jira, GitHub, Notion and the knowledge base at once',
  provider: 'system',
  requiresConfirmation: false,
  parameters: { query: { type: 'string', description: 'What to find', required: true }, sources: { type: 'array', description: 'Subset: gmail, drive, jira, github, notion, knowledge' } },
  execute: (p, ctx) => searchService.search(ctx.userId, p.query, { sources: p.sources as SearchSource[] }),
};

const knowledgeAsk: ToolDefinition = {
  name: 'knowledge_ask',
  displayName: 'Ask Knowledge Base (RAG)',
  description: 'Answers a question from indexed documents (Drive/Notion/uploads) with citations',
  provider: 'system',
  requiresConfirmation: false,
  parameters: { question: { type: 'string', description: 'Question', required: true } },
  execute: (p, ctx) => knowledgeService.ask(ctx.userId, p.question),
};

const saveDigest: ToolDefinition = {
  name: 'system_save_digest',
  displayName: 'Save Results',
  description: 'Persists workflow results in the execution record',
  provider: 'system',
  requiresConfirmation: false,
  workflowOnly: true,
  parameters: { note: { type: 'string', description: 'Optional note' } },
  async execute(p) {
    return { status: 'saved', savedAt: new Date().toISOString(), note: p.note, message: 'Results stored in the execution audit log' };
  },
};

const composeText: ToolDefinition = {
  name: 'system_compose_text',
  displayName: 'Compose Text',
  description: 'Builds a text value from a template using previous step outputs',
  provider: 'system',
  requiresConfirmation: false,
  workflowOnly: true,
  parameters: { text: { type: 'string', description: 'Template text with {{placeholders}}', required: true } },
  async execute(p) {
    return { text: p.text };
  },
};

// Aliases so workflows created with the original tool names keep working
const alias = (name: string, target: ToolDefinition): ToolDefinition => ({ ...target, name, workflowOnly: true });

export const aiTools = [
  summarizeEmails, classifyEmails, detectUrgent, extractBugs, draftReply, analyzeMeeting, agenda, smartSearch, knowledgeAsk, saveDigest, composeText,
  alias('gemini_classify', classifyEmails),
  alias('gemini_detect_urgency', detectUrgent),
  alias('gemini_summarize_executive', summarizeEmails),
  alias('gemini_extract_bug_details', extractBugs),
  alias('gemini_analyze_email', classifyEmails),
];
