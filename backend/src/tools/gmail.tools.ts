import { ToolDefinition, ToolContext } from './tool.interface';
import { gmailService, ParsedEmailMessage } from '../services/gmail/gmail.service';
import { aiService } from '../services/ai/ai.service';
import { EmailAnalysisModel } from '../models/email-analysis.model';
import { DEMO_EMAILS } from '../utils/demo-data';
import mongoose from 'mongoose';

/** Returns stored AI analysis for each message, analysing new ones (max 3 concurrent Gemini calls). */
export async function enrichEmails(messages: ParsedEmailMessage[], userId: string) {
  const out: any[] = new Array(messages.length);
  let idx = 0;
  const worker = async () => {
    while (idx < messages.length) {
      const i = idx++;
      const msg = messages[i];
      let existing: any = null;
      if (mongoose.connection.readyState === 1) existing = await EmailAnalysisModel.findOne({ userId, messageId: msg.id }).lean();
      if (!existing && msg.isDemoData) {
        // demo emails ship with curated analysis — reuse it to save AI calls
        const demo = DEMO_EMAILS.find((d) => d.messageId === msg.id);
        if (demo?.summary) existing = { ...demo, userId, isRead: msg.isRead };
      }
      out[i] = existing ? { ...existing, isRead: msg.isRead } : await aiService.analyzeAndSaveEmail(msg, userId).then((d: any) => (d?.toObject ? d.toObject() : d));
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out.map((e) => ({
    messageId: e.messageId,
    threadId: e.threadId,
    subject: e.subject,
    sender: e.sender,
    senderName: e.senderName,
    receivedAt: e.receivedAt,
    snippet: e.snippet,
    summary: e.summary,
    category: e.category,
    priority: e.priority,
    keyPoints: e.keyPoints,
    recommendedAction: e.recommendedAction,
    suggestedActions: e.suggestedActions,
    attachments: e.attachments,
    bodyText: e.bodyText?.slice(0, 1500),
    isRead: e.isRead,
    isDemoData: e.isDemoData,
  }));
}

export const gmailUnreadTool: ToolDefinition = {
  name: 'gmail_fetch_unread',
  displayName: 'Fetch Unread Emails',
  description: 'Gets unread inbox emails with AI summary, category and priority for each',
  provider: 'gmail',
  requiresConfirmation: false,
  parameters: { maxResults: { type: 'number', description: 'Max emails (default 10)', default: 10 } },
  async execute(p: { maxResults?: number }, ctx: ToolContext) {
    const msgs = await gmailService.getUnreadMessages(ctx.userId, Math.min(p.maxResults || 10, 25));
    return enrichEmails(msgs, ctx.userId);
  },
};

export const gmailSearchTool: ToolDefinition = {
  name: 'gmail_search',
  displayName: 'Search Gmail',
  description: 'Searches emails with Gmail query syntax (e.g. "invoice newer_than:7d", "from:client.com", "is:important") and returns AI-analysed results',
  provider: 'gmail',
  requiresConfirmation: false,
  parameters: {
    query: { type: 'string', description: 'Gmail search query', required: true },
    maxResults: { type: 'number', description: 'Max emails (default 10)', default: 10 },
  },
  async execute(p: { query: string; maxResults?: number }, ctx: ToolContext) {
    const msgs = await gmailService.searchMessages(p.query, ctx.userId, Math.min(p.maxResults || 10, 25));
    return enrichEmails(msgs, ctx.userId);
  },
};

export const gmailReadTool: ToolDefinition = {
  name: 'gmail_read_message',
  displayName: 'Read Email',
  description: 'Reads one email by messageId including full body, attachments and AI analysis',
  provider: 'gmail',
  requiresConfirmation: false,
  parameters: { messageId: { type: 'string', description: 'Gmail message id', required: true } },
  async execute(p: { messageId: string }, ctx: ToolContext) {
    const msg = await gmailService.getMessage(p.messageId, ctx.userId);
    if (!msg) throw new Error(`Email not found: ${p.messageId}`);
    const [e] = await enrichEmails([msg], ctx.userId);
    return { ...e, bodyText: msg.bodyText.slice(0, 6000), attachments: msg.attachments };
  },
};

export const gmailSendTool: ToolDefinition = {
  name: 'gmail_send_message',
  displayName: 'Send Email',
  description: 'Sends an email or reply via Gmail',
  provider: 'gmail',
  requiresConfirmation: true,
  actionType: 'send_email',
  parameters: {
    to: { type: 'string', description: 'Recipient email', required: true },
    subject: { type: 'string', description: 'Subject', required: true },
    body: { type: 'string', description: 'Plain-text body', required: true },
    cc: { type: 'string', description: 'Optional CC' },
    threadId: { type: 'string', description: 'Optional thread id when replying' },
  },
  async execute(p: any, ctx: ToolContext) {
    const recipients = Array.isArray(p.to) ? p.to.join(', ') : p.to;
    const r = await gmailService.sendMessage({ ...p, to: recipients }, ctx.userId);
    return { status: 'sent', messageId: r.id, recipient: recipients, simulated: r.simulated, message: `${r.simulated ? 'Simulated email' : 'Email'} sent to ${recipients}` };
  },
};

export const gmailAttachmentsTool: ToolDefinition = {
  name: 'gmail_list_attachments',
  displayName: 'List Email Attachments',
  description: 'Lists attachments (filename, type, size, attachmentId) of an email',
  provider: 'gmail',
  requiresConfirmation: false,
  parameters: { messageId: { type: 'string', description: 'Gmail message id', required: true } },
  async execute(p: { messageId: string }, ctx: ToolContext) {
    const msg = await gmailService.getMessage(p.messageId, ctx.userId);
    if (!msg) throw new Error(`Email not found: ${p.messageId}`);
    return { messageId: msg.id, subject: msg.subject, attachments: msg.attachments };
  },
};

export const gmailMarkReadTool: ToolDefinition = {
  name: 'gmail_mark_read',
  displayName: 'Mark Email Read',
  description: 'Marks an email as read',
  provider: 'gmail',
  requiresConfirmation: false,
  parameters: { messageId: { type: 'string', description: 'Gmail message id', required: true } },
  async execute(p: { messageId: string }, ctx: ToolContext) {
    await gmailService.markAsRead(p.messageId, ctx.userId);
    if (mongoose.connection.readyState === 1) await EmailAnalysisModel.updateOne({ userId: ctx.userId, messageId: p.messageId }, { isRead: true });
    return { status: 'updated', messageId: p.messageId };
  },
};

export const gmailTools = [gmailUnreadTool, gmailSearchTool, gmailReadTool, gmailSendTool, gmailAttachmentsTool, gmailMarkReadTool];
