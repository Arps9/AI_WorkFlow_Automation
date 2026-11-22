import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { gmailService } from '../services/gmail/gmail.service';
import { EmailAnalysisModel } from '../models/email-analysis.model';
import { DEMO_EMAILS } from '../utils/demo-data';
import { audit } from '../services/audit/audit.service';

function merge(msg: any, analysis: any) {
  const demo = msg.isDemoData ? DEMO_EMAILS.find((d) => d.messageId === msg.id) : null;
  const a = analysis || demo;
  return {
    messageId: msg.id,
    threadId: msg.threadId,
    sender: msg.sender,
    senderName: msg.senderName,
    recipient: msg.recipient,
    subject: msg.subject,
    receivedAt: msg.date,
    snippet: msg.snippet,
    bodyText: msg.bodyText,
    attachments: msg.attachments,
    labels: msg.labels,
    isRead: msg.isRead,
    isStarred: msg.isStarred,
    isDemoData: msg.isDemoData,
    analyzed: Boolean(a?.summary),
    summary: a?.summary,
    category: a?.category || 'Normal',
    priority: a?.priority || 'Medium',
    keyPoints: a?.keyPoints || [],
    recommendedAction: a?.recommendedAction,
    suggestedReply: a?.suggestedReply,
    suggestedActions: a?.suggestedActions || [],
    isSimulatedAnalysis: analysis?.isSimulatedAnalysis ?? Boolean(demo),
  };
}

export class GmailController {
  static async getProfile(req: Request, res: Response) {
    res.json({ success: true, profile: await gmailService.getProfile(req.user!.id) });
  }

  /** Lists live Gmail messages (or demo inbox) merged with stored AI analysis. */
  static async getMessages(req: Request, res: Response) {
    const userId = req.user!.id;
    const q = (req.query.q as string) || '';
    const category = req.query.category as string | undefined;
    const maxResults = Math.min(parseInt((req.query.maxResults as string) || '25', 10), 50);

    const msgs = await gmailService.listMessages(userId, { query: q || 'in:inbox', maxResults });
    const analyses = mongoose.connection.readyState === 1 ? await EmailAnalysisModel.find({ userId, messageId: { $in: msgs.map((m) => m.id) } }).lean() : [];
    const byId = new Map(analyses.map((a: any) => [a.messageId, a]));
    let messages = msgs.map((m) => merge(m, byId.get(m.id)));
    if (category && category !== 'All') messages = messages.filter((m) => m.analyzed && m.category === category);

    res.json({ success: true, count: messages.length, unanalyzed: messages.filter((m) => !m.analyzed).length, source: msgs[0]?.isDemoData ? 'demo' : 'gmail_api', messages });
  }

  static async getMessageById(req: Request, res: Response) {
    const userId = req.user!.id;
    const msg = await gmailService.getMessage(req.params.id, userId);
    if (!msg) return res.status(404).json({ success: false, error: { message: 'Email not found', statusCode: 404 } });
    const analysis = mongoose.connection.readyState === 1 ? await EmailAnalysisModel.findOne({ userId, messageId: msg.id }).lean() : null;
    res.json({ success: true, message: merge(msg, analysis) });
  }

  static async markAsRead(req: Request, res: Response) {
    const userId = req.user!.id;
    await gmailService.markAsRead(req.params.id, userId);
    await EmailAnalysisModel.updateOne({ userId, messageId: req.params.id }, { isRead: true }).catch(() => null);
    res.json({ success: true, message: 'Marked as read' });
  }

  static async downloadAttachment(req: Request, res: Response) {
    const { id, attachmentId } = req.params;
    const msg = await gmailService.getMessage(id, req.user!.id);
    const meta = msg?.attachments.find((a) => a.attachmentId === attachmentId);
    const data = await gmailService.getAttachment(req.user!.id, id, attachmentId);
    res.setHeader('Content-Type', meta?.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${(meta?.filename || 'attachment').replace(/"/g, '')}"`);
    res.send(data);
  }

  static async sendMessage(req: Request, res: Response) {
    const userId = req.user!.id;
    const { to, subject, body, cc, threadId, confirmed } = req.body;
    if (!to || !subject || !body) return res.status(400).json({ success: false, error: { message: 'to, subject and body are required', statusCode: 400 } });
    if (!confirmed) {
      return res.json({ success: false, requiresConfirmation: true, confirmationDetails: { actionType: 'send_email', description: `Send email to ${to} with subject "${subject}"`, targetResource: to, preview: { to, subject, body } } });
    }
    const result = await gmailService.sendMessage({ to, subject, body, cc, threadId }, userId);
    audit({ userId, action: 'tool.write', resource: 'gmail_send_message', provider: 'gmail', status: result.simulated ? 'simulated' : 'success', details: { to, subject } });
    res.json({ success: true, result });
  }
}
