import { google } from 'googleapis';
import { googleAuthService } from '../google/google-auth.service';
import { DEMO_EMAILS } from '../../utils/demo-data';
import { env } from '../../config/env.config';
import { logger } from '../../utils/logger';
import { NotConnectedError } from '../integrations/http';

export interface EmailAttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

export interface ParsedEmailMessage {
  id: string;
  threadId: string;
  sender: string;
  senderName?: string;
  recipient?: string;
  subject: string;
  date: Date;
  snippet: string;
  bodyText: string;
  labels: string[];
  attachments: EmailAttachmentMeta[];
  isRead: boolean;
  isStarred: boolean;
  isDemoData: boolean;
  rfcMessageId?: string;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  inReplyTo?: string;
  threadId?: string;
}

// demo read-state is tracked per user so one user's actions don't leak into another's view
const demoReadState = new Map<string, Set<string>>();

function demoToParsed(e: any, userId: string): ParsedEmailMessage {
  const read = demoReadState.get(userId)?.has(e.messageId) ?? false;
  return {
    id: e.messageId,
    threadId: e.threadId || e.messageId,
    sender: e.sender || '',
    senderName: e.senderName,
    recipient: e.recipient,
    subject: e.subject || '',
    date: e.receivedAt || new Date(),
    snippet: e.snippet || '',
    bodyText: e.bodyText || '',
    labels: e.labels || ['INBOX'],
    attachments: e.attachments || [],
    isRead: Boolean(e.isRead) || read,
    isStarred: Boolean(e.isStarred),
    isDemoData: true,
  };
}

function decodeB64(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8');
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/** Walks nested multipart payloads (mixed → alternative → text/plain). */
function walkParts(payload: any, out: { plain: string[]; html: string[]; attachments: EmailAttachmentMeta[] }) {
  if (!payload) return;
  const mime = payload.mimeType || '';
  if (payload.filename && payload.body?.attachmentId) {
    out.attachments.push({ filename: payload.filename, mimeType: mime, size: payload.body.size || 0, attachmentId: payload.body.attachmentId });
  } else if (mime === 'text/plain' && payload.body?.data) {
    out.plain.push(decodeB64(payload.body.data));
  } else if (mime === 'text/html' && payload.body?.data) {
    out.html.push(decodeB64(payload.body.data));
  }
  (payload.parts || []).forEach((p: any) => walkParts(p, out));
}

export class GmailService {
  private static instance: GmailService;
  public static getInstance(): GmailService {
    if (!GmailService.instance) GmailService.instance = new GmailService();
    return GmailService.instance;
  }

  private async client(userId: string) {
    const auth = await googleAuthService.getClient(userId, 'gmail');
    if (!auth) {
      if (!env.DEMO_MODE) throw new NotConnectedError('gmail');
      return null;
    }
    return google.gmail({ version: 'v1', auth });
  }

  public async isConnected(userId: string) {
    return Boolean(await googleAuthService.getClient(userId, 'gmail'));
  }

  public async getProfile(userId: string) {
    const gmail = await this.client(userId);
    if (!gmail) return { emailAddress: 'demo.executive@enterprise-ai.internal', messagesTotal: DEMO_EMAILS.length, threadsTotal: DEMO_EMAILS.length, isConnected: false, isDemoData: true };
    const res = await gmail.users.getProfile({ userId: 'me' });
    return { emailAddress: res.data.emailAddress, messagesTotal: res.data.messagesTotal, threadsTotal: res.data.threadsTotal, historyId: res.data.historyId, isConnected: true, isDemoData: false };
  }

  public async listMessages(userId: string, options: { query?: string; maxResults?: number; labelIds?: string[] } = {}): Promise<ParsedEmailMessage[]> {
    const gmail = await this.client(userId);
    if (!gmail) {
      let emails = DEMO_EMAILS.map((e) => demoToParsed(e, userId));
      const q = (options.query || '').toLowerCase();
      if (q.includes('is:unread')) emails = emails.filter((e) => !e.isRead);
      if (q.includes('is:important')) {
        emails = emails.filter((e) => e.isStarred || e.labels.includes('IMPORTANT') || DEMO_EMAILS.find((d) => d.messageId === e.id)?.priority === 'High');
      }
      const terms = q
        .replace(/is:\w+|newer_than:\w+|older_than:\w+|in:\w+|label:\w+/g, '')
        .replace(/subject:\(([^)]*)\)/g, '$1')
        .split(/\s+or\s+|\s+/)
        .map((t) => t.replace(/[()"]/g, '').trim())
        .filter((t) => t && t !== 'or' && t !== 'and');
      if (terms.length) {
        emails = emails.filter((e) => terms.some((t) => `${e.subject} ${e.snippet} ${e.bodyText} ${e.sender}`.toLowerCase().includes(t)));
      }
      return emails.slice(0, options.maxResults || 20);
    }

    const listRes = await gmail.users.messages.list({ userId: 'me', q: options.query, maxResults: options.maxResults || 15, labelIds: options.labelIds });
    const ids = (listRes.data.messages || []).map((m) => m.id).filter(Boolean) as string[];
    const results = await Promise.all(
      ids.map((id) =>
        this.getMessage(id, userId).catch((err) => {
          logger.warn(`Failed to fetch Gmail message ${id}`, { error: err.message });
          return null;
        })
      )
    );
    return results.filter(Boolean) as ParsedEmailMessage[];
  }

  public async getMessage(messageId: string, userId: string): Promise<ParsedEmailMessage | null> {
    const gmail = await this.client(userId);
    if (!gmail) {
      const found = DEMO_EMAILS.find((e) => e.messageId === messageId);
      return found ? demoToParsed(found, userId) : null;
    }
    const res = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' });
    const msg = res.data;
    const headers = msg.payload?.headers || [];
    const getHeader = (name: string) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const from = getHeader('From');
    let senderEmail = from;
    let senderName = '';
    const match = from.match(/(.*?)\s*<(.+?)>/);
    if (match) {
      senderName = match[1].replace(/["']/g, '').trim();
      senderEmail = match[2].trim();
    }

    const parts = { plain: [] as string[], html: [] as string[], attachments: [] as EmailAttachmentMeta[] };
    walkParts(msg.payload, parts);
    const bodyText = (parts.plain.join('\n').trim() || stripHtml(parts.html.join('\n'))).slice(0, 20000);
    const labels = msg.labelIds || [];

    return {
      id: msg.id || messageId,
      threadId: msg.threadId || '',
      sender: senderEmail,
      senderName: senderName || senderEmail,
      recipient: getHeader('To'),
      subject: getHeader('Subject') || '(No Subject)',
      date: new Date(parseInt(msg.internalDate || `${Date.now()}`, 10)),
      snippet: msg.snippet || '',
      bodyText: bodyText || msg.snippet || '',
      labels,
      attachments: parts.attachments,
      isRead: !labels.includes('UNREAD'),
      isStarred: labels.includes('STARRED'),
      isDemoData: false,
      rfcMessageId: getHeader('Message-ID') || undefined,
    };
  }

  public searchMessages(query: string, userId: string, maxResults = 10) {
    return this.listMessages(userId, { query, maxResults });
  }

  public getUnreadMessages(userId: string, maxResults = 10) {
    return this.listMessages(userId, { query: 'is:unread in:inbox', maxResults });
  }

  public async markAsRead(messageId: string, userId: string): Promise<boolean> {
    const gmail = await this.client(userId);
    if (!gmail) {
      if (!demoReadState.has(userId)) demoReadState.set(userId, new Set());
      demoReadState.get(userId)!.add(messageId);
      return true;
    }
    await gmail.users.messages.modify({ userId: 'me', id: messageId, requestBody: { removeLabelIds: ['UNREAD'] } });
    return true;
  }

  public async getAttachment(userId: string, messageId: string, attachmentId: string): Promise<Buffer> {
    const gmail = await this.client(userId);
    if (!gmail) {
      return Buffer.from(`Demo attachment ${attachmentId} for message ${messageId}\nInvoice INV-2026-118 — Amount due: INR 48,500 — Due: 30 Nov 2026`);
    }
    const res = await gmail.users.messages.attachments.get({ userId: 'me', messageId, id: attachmentId });
    return Buffer.from((res.data.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  }

  public async sendMessage(params: SendEmailParams, userId: string): Promise<{ id: string; success: boolean; simulated?: boolean }> {
    const gmail = await this.client(userId);
    if (!gmail) {
      logger.info('Simulated email send (demo mode)', { to: params.to, subject: params.subject });
      return { id: `demo-sent-${Date.now()}`, success: true, simulated: true };
    }
    if (/[\r\n]/.test(params.to + params.subject + (params.cc || ''))) throw new Error('Invalid header characters');
    const utf8Subject = `=?utf-8?B?${Buffer.from(params.subject).toString('base64')}?=`;
    const lines = [
      `To: ${params.to}`,
      ...(params.cc ? [`Cc: ${params.cc}`] : []),
      'Content-Type: text/plain; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      ...(params.inReplyTo ? [`In-Reply-To: ${params.inReplyTo}`, `References: ${params.inReplyTo}`] : []),
      '',
      params.body,
    ];
    const raw = Buffer.from(lines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const res = await gmail.users.messages.send({ userId: 'me', requestBody: { raw, threadId: params.threadId } });
    return { id: res.data.id || `sent-${Date.now()}`, success: true };
  }
}

export const gmailService = GmailService.getInstance();
