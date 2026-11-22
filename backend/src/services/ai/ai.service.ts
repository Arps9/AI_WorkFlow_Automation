import { z } from 'zod';
import { AIProvider, AgentStepResult, BugDetails, EmailClassificationResult, EmailReplyResult, EmailSummaryResult, ActionExtractionResult, FullEmailAnalysis, MeetingAnalysis, SuggestedAction, ToolManifestEntry } from './ai.provider';
import { GeminiProvider } from './gemini.provider';
import * as P from './prompts';
import { EmailAnalysisModel, IEmailAnalysis } from '../../models/email-analysis.model';
import { logger } from '../../utils/logger';
import { env } from '../../config/env.config';
import { nowParts, toLocalString } from '../../utils/date-parse';
import { heuristicAgentStep } from './agent-fallback';

const CATEGORY = z.enum(['Important', 'Urgent', 'Bug/Issue', 'Client Request', 'Meeting', 'Normal', 'Promotional']);
const PRIORITY = z.preprocess((v) => (typeof v === 'string' ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v), z.enum(['High', 'Medium', 'Low']));
const ACTION_TYPE = z.enum(['create_task', 'send_reply', 'schedule_meeting', 'investigate_incident', 'archive', 'none']).catch('none');

const SummarySchema = z.object({ summary: z.string(), keyPoints: z.array(z.string()).default([]), importantInformation: z.string().optional() });
const ClassificationSchema = z.object({ category: CATEGORY, priority: PRIORITY, confidence: z.coerce.number().default(0.8), reasoning: z.string().default('') });
const ReplySchema = z.object({ subject: z.string(), body: z.string(), tone: z.string().default('Professional') });
const SuggestedActionSchema = z.object({ label: z.string(), tool: z.string().optional(), reason: z.string().optional() });
const FullAnalysisSchema = z.object({
  summary: z.string(),
  keyPoints: z.array(z.string()).default([]),
  category: CATEGORY,
  priority: PRIORITY,
  confidence: z.coerce.number().default(0.8),
  reasoning: z.string().default(''),
  recommendedAction: z.string().default(''),
  actionType: ACTION_TYPE,
  suggestedReply: z.string().default(''),
  suggestedActions: z.array(SuggestedActionSchema).default([]),
});
const BugSchema = z.object({
  title: z.string(),
  severity: z.enum(['Critical', 'High', 'Medium', 'Low']).catch('Medium'),
  component: z.string().default('Unknown'),
  stepsToReproduce: z.array(z.string()).default([]),
  expectedBehavior: z.string().default(''),
  actualBehavior: z.string().default(''),
  environment: z.string().default('unknown'),
});
const MeetingSchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()).default([]),
  actionItems: z.array(z.object({ task: z.string(), owner: z.string().optional(), dueDate: z.string().optional() })).default([]),
  deadlines: z.array(z.string()).default([]),
  attendance: z.array(z.string()).default([]),
});
const AgentSchema = z.object({
  intent: z.string().default('general'),
  replyMessage: z.string().default(''),
  toolCalls: z
    .array(z.object({ toolName: z.string(), parameters: z.record(z.any()).default({}), confirmationPrompt: z.string().optional() }))
    .default([]),
});

export interface EmailInput {
  id: string;
  threadId?: string;
  sender: string;
  senderName?: string;
  recipient?: string;
  subject: string;
  date: Date;
  snippet?: string;
  bodyText: string;
  isRead?: boolean;
  isStarred?: boolean;
  labels?: string[];
  attachments?: any[];
  isDemoData?: boolean;
}

export class AIService {
  private static instance: AIService;
  private provider: AIProvider;

  private constructor() {
    this.provider = new GeminiProvider();
  }

  public static getInstance(): AIService {
    if (!AIService.instance) AIService.instance = new AIService();
    return AIService.instance;
  }

  public setProvider(provider: AIProvider): void {
    this.provider = provider;
    logger.info(`Switched AI provider to ${provider.name}`);
  }

  public getProviderName(): string {
    return this.provider.name;
  }

  public isLive(): boolean {
    return this.provider.isLive();
  }

  public getStatus() {
    const p = this.provider as any;
    return {
      provider: this.provider.name,
      live: this.provider.isLive(),
      model: typeof p.getModelName === 'function' ? p.getModelName() : undefined,
      lastError: typeof p.getLastError === 'function' ? p.getLastError() : undefined,
    };
  }

  public embed(texts: string[]) {
    return this.provider.embed(texts);
  }

  // ---------------------------------------------------------------- email
  public async summarizeEmail(subject: string, body: string, sender: string): Promise<EmailSummaryResult> {
    const r = await this.provider.generateJSON(P.emailSummaryPrompt(subject, body, sender), (x) => SummarySchema.parse(x));
    return r ? { ...r, isSimulated: false } : fallbackSummary(subject, body, sender);
  }

  public async classifyEmail(subject: string, body: string, sender: string): Promise<EmailClassificationResult> {
    const r = await this.provider.generateJSON(P.emailClassificationPrompt(subject, body, sender), (x) => ClassificationSchema.parse(x));
    return r ? { ...r, isSimulated: false } : fallbackClassify(subject, body);
  }

  public async extractActions(subject: string, body: string, sender: string): Promise<ActionExtractionResult> {
    const c = await this.classifyEmail(subject, body, sender);
    const map = actionForCategory(c.category);
    return { ...map, priority: c.priority, details: { category: c.category, sender }, isSimulated: c.isSimulated };
  }

  public async generateReply(subject: string, body: string, sender: string, userInstruction?: string): Promise<EmailReplyResult> {
    const r = await this.provider.generateJSON(P.emailReplyPrompt(subject, body, sender, userInstruction), (x) => ReplySchema.parse(x));
    return r ? { ...r, isSimulated: false } : fallbackReply(subject, sender);
  }

  /** One LLM call for everything the inbox UI needs. */
  public async analyzeEmail(subject: string, body: string, sender: string): Promise<FullEmailAnalysis> {
    const r = await this.provider.generateJSON(P.fullEmailAnalysisPrompt(subject, body, sender), (x) => FullAnalysisSchema.parse(x));
    if (r) return { ...r, isSimulated: false };
    const s = fallbackSummary(subject, body, sender);
    const c = fallbackClassify(subject, body);
    const a = actionForCategory(c.category);
    return {
      summary: s.summary,
      keyPoints: s.keyPoints,
      category: c.category,
      priority: c.priority,
      confidence: c.confidence,
      reasoning: c.reasoning,
      recommendedAction: a.recommendedAction,
      actionType: a.actionType,
      suggestedReply: c.category === 'Promotional' ? '' : fallbackReply(subject, sender).body,
      suggestedActions: fallbackSuggestedActions(subject, body, c.category),
      isSimulated: true,
    };
  }

  public async analyzeAndSaveEmail(email: EmailInput, userId: string): Promise<IEmailAnalysis> {
    logger.info(`Analyzing email (${this.provider.name}${this.isLive() ? '' : ' fallback'})`, { subject: email.subject });
    const a = await this.analyzeEmail(email.subject, email.bodyText || email.snippet || '', email.sender);
    const update = {
      userId,
      messageId: email.id,
      threadId: email.threadId,
      sender: email.sender,
      senderName: email.senderName,
      recipient: email.recipient,
      subject: email.subject,
      receivedAt: email.date,
      snippet: email.snippet,
      bodyText: email.bodyText,
      summary: a.summary,
      category: a.category,
      priority: a.priority,
      keyPoints: a.keyPoints,
      recommendedAction: a.recommendedAction,
      suggestedReply: a.suggestedReply,
      suggestedActions: a.suggestedActions,
      attachments: email.attachments || [],
      isSimulatedAnalysis: Boolean(a.isSimulated),
      isRead: Boolean(email.isRead),
      isStarred: Boolean(email.isStarred),
      labels: email.labels || [],
      isDemoData: Boolean(email.isDemoData),
    };
    const doc = await EmailAnalysisModel.findOneAndUpdate({ userId, messageId: email.id }, update, { upsert: true, new: true });
    return (doc || update) as IEmailAnalysis;
  }

  public async extractBugDetails(subject: string, body: string): Promise<BugDetails> {
    const r = await this.provider.generateJSON(P.bugDetailsPrompt(subject, body), (x) => BugSchema.parse(x));
    if (r) return { ...r, isSimulated: false };
    const text = `${subject} ${body}`.toLowerCase();
    const sev: BugDetails['severity'] = /outage|production|locked out|critical|p0/.test(text) ? 'Critical' : /error|fail|timeout|500|401|504/.test(text) ? 'High' : 'Medium';
    const codes = body.match(/\b(4\d{2}|5\d{2})\b/g);
    return {
      title: subject.replace(/^(re:|fwd?:|urgent:|bug report:)\s*/gi, '').slice(0, 120),
      severity: sev,
      component: /auth|login|401/.test(text) ? 'Authentication' : /export|csv/.test(text) ? 'Export service' : /api|webhook/.test(text) ? 'API' : 'General',
      stepsToReproduce: body.split(/[.\n]/).map((s) => s.trim()).filter((s) => /when|whenever|after|click|run|trigger/i.test(s)).slice(0, 4),
      expectedBehavior: 'Feature works without errors',
      actualBehavior: codes ? `Fails with HTTP ${Array.from(new Set(codes)).join(', ')}` : body.slice(0, 160),
      environment: /production|prod/.test(text) ? 'production' : /staging/.test(text) ? 'staging' : 'unknown',
      isSimulated: true,
    };
  }

  public async generateDigest(emails: Array<{ subject: string; sender?: string; category?: string; priority?: string; summary?: string; snippet?: string }>) {
    const stats = emailStats(emails);
    const lines = emails.slice(0, 25).map((e, i) => `${i + 1}. [${e.category || '?'}|${e.priority || '?'}] ${e.subject} — ${e.sender || ''}: ${(e.summary || e.snippet || '').slice(0, 200)}`).join('\n');
    const schema = z.object({ headline: z.string(), summary: z.string(), topPriorities: z.array(z.string()).default([]) });
    const r = emails.length ? await this.provider.generateJSON(P.digestPrompt(lines), (x) => schema.parse(x)) : null;
    if (r) return { ...r, stats, isSimulated: false };
    const top = emails.filter((e) => e.priority === 'High').slice(0, 3).map((e) => e.subject);
    return {
      headline: stats.headline,
      summary: emails.length
        ? `You have ${stats.total} emails in scope. ${stats.byCategory['Urgent'] || 0} urgent and ${stats.byCategory['Bug/Issue'] || 0} bug reports need engineering attention${top.length ? `, led by "${top[0]}"` : ''}.`
        : 'No emails matched.',
      topPriorities: top,
      stats,
      isSimulated: true,
    };
  }

  public async generateReleaseNotes(pr: { title: string; body?: string; number?: number; repo?: string; commits?: string[]; files?: string[] }) {
    const text = `Repo: ${pr.repo || ''}\nPR #${pr.number || ''}: ${pr.title}\nDescription:\n${(pr.body || '').slice(0, 4000)}\nCommits:\n${(pr.commits || []).slice(0, 40).join('\n')}\nFiles:\n${(pr.files || []).slice(0, 60).join('\n')}`;
    const schema = z.object({ title: z.string(), markdown: z.string(), highlights: z.array(z.string()).default([]) });
    const r = await this.provider.generateJSON(P.releaseNotesPrompt(text), (x) => schema.parse(x));
    if (r) return { ...r, isSimulated: false };
    const commits = pr.commits || [];
    const fixes = commits.filter((c) => /fix|bug|patch/i.test(c));
    const feats = commits.filter((c) => !/fix|bug|patch/i.test(c));
    const md = [`## What's new`, `- ${pr.title}`, ...feats.slice(0, 8).map((c) => `- ${c}`), ...(fixes.length ? ['', '## Fixes', ...fixes.slice(0, 8).map((c) => `- ${c}`)] : []), '', `## Notes`, `- Merged via PR #${pr.number || '?'}${pr.repo ? ` in ${pr.repo}` : ''}`].join('\n');
    return { title: `Release: ${pr.title}`, markdown: md, highlights: [pr.title, ...feats.slice(0, 2)], isSimulated: true };
  }

  public async summarizePullRequest(pr: { title: string; body?: string; files?: string[]; additions?: number; deletions?: number }) {
    const text = `Title: ${pr.title}\nDescription: ${(pr.body || '').slice(0, 4000)}\n+${pr.additions || 0}/-${pr.deletions || 0}\nFiles:\n${(pr.files || []).slice(0, 80).join('\n')}`;
    const schema = z.object({ summary: z.string(), keyChanges: z.array(z.string()).default([]), risk: z.enum(['Low', 'Medium', 'High']).catch('Medium'), reviewNotes: z.array(z.string()).default([]) });
    const r = await this.provider.generateJSON(P.prSummaryPrompt(text), (x) => schema.parse(x));
    if (r) return { ...r, isSimulated: false };
    const size = (pr.additions || 0) + (pr.deletions || 0);
    return {
      summary: `${pr.title}. Touches ${pr.files?.length || 0} files (+${pr.additions || 0}/-${pr.deletions || 0}).`,
      keyChanges: (pr.files || []).slice(0, 5),
      risk: size > 800 ? 'High' : size > 200 ? 'Medium' : 'Low',
      reviewNotes: size > 800 ? ['Large change — consider splitting the PR'] : [],
      isSimulated: true,
    };
  }

  // ---------------------------------------------------------------- meetings
  public async analyzeMeeting(title: string, attendees: string[], transcript: string): Promise<MeetingAnalysis> {
    const n = nowParts();
    const today = `${n.year}-${String(n.month).padStart(2, '0')}-${String(n.day).padStart(2, '0')}`;
    const r = await this.provider.generateJSON(P.meetingAnalysisPrompt(title, attendees, transcript, today), (x) => MeetingSchema.parse(x));
    if (r) return { ...r, isSimulated: false };
    const lines = transcript.split(/\n|(?<=[.!?])\s+/).map((l) => l.trim()).filter(Boolean);
    const actionLines = lines.filter((l) => /\b(will|to do|todo|action|needs? to|should|by (mon|tue|wed|thu|fri|sat|sun|tomorrow|next|\d))/i.test(l));
    const speakers = Array.from(new Set(lines.map((l) => l.match(/^([A-Z][a-zA-Z]+)\s*:/)?.[1]).filter(Boolean) as string[]));
    return {
      summary: lines.slice(0, 4).join(' ').slice(0, 600) || 'No notes provided.',
      decisions: lines.filter((l) => /\b(decided|agreed|approved|we will go with)\b/i.test(l)).slice(0, 5),
      actionItems: actionLines.slice(0, 8).map((l) => {
        const owner = l.match(/^([A-Z][a-zA-Z]+)\s*:/)?.[1] || l.match(/^([A-Z][a-z]+) will/)?.[1];
        const due = l.match(/by ([A-Za-z]+day|tomorrow|next week|\d{4}-\d{2}-\d{2})/i)?.[1];
        return { task: l.replace(/^[A-Z][a-zA-Z]+\s*:\s*/, ''), owner, dueDate: due };
      }),
      deadlines: lines.filter((l) => /\b(deadline|due|by (mon|tue|wed|thu|fri)|eod|end of)\b/i.test(l)).slice(0, 5),
      attendance: speakers.length ? speakers : attendees,
      isSimulated: true,
    };
  }

  public async generateAgenda(title: string, attendees: string[], context = ''): Promise<{ agenda: string[]; isSimulated: boolean }> {
    const schema = z.object({ agenda: z.array(z.string()) });
    const r = await this.provider.generateJSON(P.agendaPrompt(title, attendees, context), (x) => schema.parse(x));
    if (r) return { agenda: r.agenda, isSimulated: false };
    return {
      agenda: ['5 min — Welcome & objectives', `15 min — ${title}: current status`, '15 min — Open issues & blockers', '10 min — Decisions needed', '5 min — Action items, owners & deadlines'],
      isSimulated: true,
    };
  }

  public async summarizeConversation(channel: string, messages: Array<{ user?: string; text: string }>) {
    const schema = z.object({ summary: z.string(), keyPoints: z.array(z.string()).default([]), actionItems: z.array(z.string()).default([]) });
    const text = messages.slice(-80).map((m) => `${m.user || 'user'}: ${m.text}`).join('\n');
    const r = messages.length ? await this.provider.generateJSON(P.conversationSummaryPrompt(channel, text), (x) => schema.parse(x)) : null;
    if (r) return { ...r, isSimulated: false };
    return {
      summary: messages.length ? `${messages.length} messages in ${channel}. Latest: "${messages[messages.length - 1].text.slice(0, 140)}"` : `No recent messages in ${channel}.`,
      keyPoints: messages.slice(-3).map((m) => m.text.slice(0, 120)),
      actionItems: messages.filter((m) => /\b(please|todo|can you|need to|will)\b/i.test(m.text)).slice(0, 5).map((m) => m.text.slice(0, 120)),
      isSimulated: true,
    };
  }

  public async detectPriority(text: string): Promise<{ priority: 'Highest' | 'High' | 'Medium' | 'Low'; reason: string; isSimulated: boolean }> {
    const schema = z.object({ priority: z.enum(['Highest', 'High', 'Medium', 'Low']).catch('Medium'), reason: z.string().default('') });
    const r = await this.provider.generateJSON(P.priorityPrompt(text), (x) => schema.parse(x));
    if (r) return { ...r, isSimulated: false };
    const t = text.toLowerCase();
    if (/outage|production down|security|data loss|locked out|p0/.test(t)) return { priority: 'Highest', reason: 'Production impact keywords', isSimulated: true };
    if (/error|fail|bug|broken|timeout|urgent/.test(t)) return { priority: 'High', reason: 'Defect keywords', isSimulated: true };
    if (/improve|feature|request/.test(t)) return { priority: 'Medium', reason: 'Enhancement request', isSimulated: true };
    return { priority: 'Low', reason: 'No urgency signals', isSimulated: true };
  }

  public async answerWithContext(question: string, passages: Array<{ title: string; text: string }>) {
    const ctx = passages.map((p, i) => `[${i + 1}] (${p.title}) ${p.text}`).join('\n\n');
    const schema = z.object({ answer: z.string(), citations: z.array(z.coerce.number()).default([]) });
    const r = passages.length ? await this.provider.generateJSON(P.ragAnswerPrompt(question, ctx), (x) => schema.parse(x)) : null;
    if (r) return { ...r, isSimulated: false };
    if (!passages.length) return { answer: 'I could not find anything relevant in the knowledge base.', citations: [], isSimulated: true };
    return {
      answer: `Most relevant passage [1] from "${passages[0].title}": ${passages[0].text.slice(0, 500)}${passages[0].text.length > 500 ? '…' : ''}`,
      citations: passages.map((_, i) => i + 1).slice(0, 3),
      isSimulated: true,
    };
  }

  public async summarizeSearch(query: string, results: Array<{ source: string; title: string; snippet?: string }>) {
    const schema = z.object({ summary: z.string() });
    const text = results.slice(0, 30).map((r) => `- [${r.source}] ${r.title}: ${(r.snippet || '').slice(0, 160)}`).join('\n');
    const r = results.length ? await this.provider.generateJSON(P.searchSummaryPrompt(query, text), (x) => schema.parse(x)) : null;
    if (r) return { summary: r.summary, isSimulated: false };
    const bySource = results.reduce<Record<string, number>>((acc, x) => ((acc[x.source] = (acc[x.source] || 0) + 1), acc), {});
    return {
      summary: results.length
        ? `Found ${results.length} results for "${query}" — ${Object.entries(bySource).map(([k, v]) => `${v} in ${k}`).join(', ')}. Top match: "${results[0].title}".`
        : `Nothing matched "${query}" in the connected sources.`,
      isSimulated: true,
    };
  }

  // ---------------------------------------------------------------- agent
  public async planAgentStep(input: {
    message: string;
    history: Array<{ role: string; content: string }>;
    tools: ToolManifestEntry[];
    observations: Array<{ toolName: string; parameters: any; result: any }>;
  }): Promise<AgentStepResult> {
    const n = nowParts();
    const toolsText = input.tools
      .map((t) => `- ${t.name}${t.requiresConfirmation ? ' [CONFIRM]' : ''}: ${t.description} | ${JSON.stringify(t.parameters)}`)
      .join('\n');
    const historyText = input.history.slice(-8).map((m) => `${m.role.toUpperCase()}: ${String(m.content).slice(0, 600)}`).join('\n');
    const obsText = input.observations
      .map((o, i) => `#${i + 1} ${o.toolName}(${JSON.stringify(o.parameters)}) => ${JSON.stringify(o.result).slice(0, 3500)}`)
      .join('\n');
    const r = await this.provider.generateJSON(
      P.agentPrompt({ message: input.message, history: historyText, tools: toolsText, observations: obsText, now: toLocalString(n), timezone: env.APP_TIMEZONE }),
      (x) => AgentSchema.parse(x)
    );
    if (r) return { ...r, isSimulated: false };
    return heuristicAgentStep(input.message, input.observations);
  }
}

// ---------------------------------------------------------------- fallbacks & helpers
export function emailStats(emails: Array<{ category?: string; priority?: string }>) {
  const byCategory: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  for (const e of emails) {
    byCategory[e.category || 'Normal'] = (byCategory[e.category || 'Normal'] || 0) + 1;
    byPriority[e.priority || 'Medium'] = (byPriority[e.priority || 'Medium'] || 0) + 1;
  }
  const parts = [`${emails.length} emails`];
  if (byCategory['Urgent']) parts.push(`${byCategory['Urgent']} urgent`);
  if (byCategory['Bug/Issue']) parts.push(`${byCategory['Bug/Issue']} bug reports`);
  if (byCategory['Meeting']) parts.push(`${byCategory['Meeting']} meeting invitations`);
  if (byCategory['Client Request']) parts.push(`${byCategory['Client Request']} client requests`);
  return { total: emails.length, byCategory, byPriority, headline: parts.join(' • ') };
}

function fallbackSummary(subject: string, body: string, sender: string): EmailSummaryResult {
  const sentences = (body || '').replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter((s) => s.length > 20 && !/^(hi|hello|dear|regards|best|thanks)/i.test(s));
  return {
    summary: sentences.slice(0, 2).join(' ').slice(0, 400) || `Email from ${sender} about "${subject}".`,
    keyPoints: sentences.slice(0, 3).map((s) => s.slice(0, 140)).concat(sentences.length ? [] : [`Subject: ${subject}`]),
    importantInformation: (body.match(/[^.]*\b(by|before|deadline|eta|asap|today|friday|monday)\b[^.]*\./i) || [''])[0].trim(),
    isSimulated: true,
  };
}

export function fallbackClassify(subject: string, body: string): EmailClassificationResult {
  const t = `${subject} ${body}`.toLowerCase();
  const r = (category: EmailClassificationResult['category'], priority: EmailClassificationResult['priority'], reasoning: string, confidence = 0.7) => ({ category, priority, confidence, reasoning, isSimulated: true });
  if (/\burgent\b|outage|down\b|locked out|asap|critical/.test(t)) return r('Urgent', 'High', 'Critical/time-sensitive keywords detected (heuristic).');
  if (/\bbug\b|error|exception|timeout|\b50[0-9]\b|\b40[13]\b|crash|fails?\b|failing/.test(t)) return r('Bug/Issue', 'High', 'Error/defect keywords detected (heuristic).');
  if (/meeting|invite|calendar|sync\b|standup|review on|schedule/.test(t)) return r('Meeting', 'Medium', 'Scheduling keywords detected (heuristic).');
  if (/invoice|payment|contract|legal|compliance|audit|soc2/.test(t)) return r('Important', 'High', 'Finance/compliance keywords detected (heuristic).');
  if (/renewal|quote|pricing|proposal|request|could you|sla/.test(t)) return r('Client Request', 'Medium', 'Client request keywords detected (heuristic).');
  if (/unsubscribe|discount|offer|% off|webinar|summit|newsletter/.test(t)) return r('Promotional', 'Low', 'Marketing keywords detected (heuristic).');
  return r('Normal', 'Medium', 'No strong signals (heuristic).', 0.5);
}

function actionForCategory(category: string): { recommendedAction: string; actionType: ActionExtractionResult['actionType'] } {
  switch (category) {
    case 'Urgent':
      return { recommendedAction: 'Open a high-priority incident ticket and alert the on-call channel', actionType: 'investigate_incident' };
    case 'Bug/Issue':
      return { recommendedAction: 'Create a Jira/GitHub bug ticket with reproduction details', actionType: 'create_task' };
    case 'Client Request':
      return { recommendedAction: 'Reply to the client and track the request as a task', actionType: 'send_reply' };
    case 'Meeting':
      return { recommendedAction: 'Check calendar availability and accept or propose a time', actionType: 'schedule_meeting' };
    case 'Important':
      return { recommendedAction: 'Review today and file related documents', actionType: 'create_task' };
    case 'Promotional':
      return { recommendedAction: 'Archive', actionType: 'archive' };
    default:
      return { recommendedAction: 'No immediate action required', actionType: 'none' };
  }
}

function fallbackReply(subject: string, sender: string): EmailReplyResult {
  const name = (sender.split('@')[0] || '').split(/[._]/)[0];
  return {
    subject: `Re: ${subject.replace(/^Re:\s*/i, '')}`,
    body: `Hi ${name ? name.charAt(0).toUpperCase() + name.slice(1) : 'there'},\n\nThank you for your email regarding "${subject}". We have received it and the team is reviewing the details. We will follow up with next steps shortly.\n\nBest regards`,
    tone: 'Professional',
    isSimulated: true,
  };
}

export function fallbackSuggestedActions(subject: string, body: string, category: string): SuggestedAction[] {
  const t = `${subject} ${body}`.toLowerCase();
  const out: SuggestedAction[] = [];
  if (/invoice|receipt|bill\b|payment due/.test(t)) {
    out.push({ label: 'Save invoice to Drive', tool: 'drive_save_attachment', reason: 'Keep financial records organised' });
    out.push({ label: 'Notify finance on Slack', tool: 'slack_send_message', reason: 'Finance needs to process the invoice' });
    out.push({ label: 'Create approval task in Jira', tool: 'jira_create_issue', reason: 'Track approval' });
  }
  if (category === 'Bug/Issue' || category === 'Urgent') {
    out.push({ label: 'Create Jira bug ticket', tool: 'jira_create_issue', reason: 'Track the defect' });
    out.push({ label: 'Alert engineering on Slack', tool: 'slack_send_message', reason: 'Fast response' });
  }
  if (category === 'Meeting') out.push({ label: 'Add to Google Calendar', tool: 'calendar_create_event', reason: 'Meeting request detected' });
  if (category === 'Client Request') out.push({ label: 'Reply with AI draft', tool: 'gmail_send_message', reason: 'Client is waiting' });
  return out.slice(0, 4);
}

export const aiService = AIService.getInstance();
