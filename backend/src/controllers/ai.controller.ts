import { Request, Response } from 'express';
import { aiService } from '../services/ai/ai.service';
import { gmailService } from '../services/gmail/gmail.service';
import { EmailAnalysisModel } from '../models/email-analysis.model';

const text = (req: Request) => ({ subject: String(req.body.subject || ''), body: String(req.body.body || ''), sender: String(req.body.sender || 'unknown') });

export class AIController {
  static async status(_req: Request, res: Response) {
    res.json({ success: true, ai: aiService.getStatus() });
  }

  static async summarizeEmail(req: Request, res: Response) {
    const { subject, body, sender } = text(req);
    if (!subject && !body) return res.status(400).json({ success: false, error: { message: 'subject or body is required', statusCode: 400 } });
    res.json({ success: true, result: await aiService.summarizeEmail(subject, body, sender) });
  }

  static async classifyEmail(req: Request, res: Response) {
    const { subject, body, sender } = text(req);
    res.json({ success: true, result: await aiService.classifyEmail(subject, body, sender) });
  }

  static async extractActions(req: Request, res: Response) {
    const { subject, body, sender } = text(req);
    res.json({ success: true, result: await aiService.extractActions(subject, body, sender) });
  }

  static async generateReply(req: Request, res: Response) {
    const { subject, body, sender } = text(req);
    res.json({ success: true, result: await aiService.generateReply(subject, body, sender, req.body.userInstruction) });
  }

  static async extractBug(req: Request, res: Response) {
    const { subject, body } = text(req);
    res.json({ success: true, result: await aiService.extractBugDetails(subject, body) });
  }

  static async analyzeEmail(req: Request, res: Response) {
    const userId = req.user!.id;
    const { messageId } = req.body;
    if (!messageId) return res.status(400).json({ success: false, error: { message: 'messageId is required', statusCode: 400 } });
    const email = await gmailService.getMessage(messageId, userId);
    if (!email) return res.status(404).json({ success: false, error: { message: 'Email not found', statusCode: 404 } });
    const analysis = await aiService.analyzeAndSaveEmail(email, userId);
    res.json({ success: true, analysis });
  }

  /** Analyses up to 10 not-yet-analysed inbox emails (sequential to respect free-tier limits). */
  static async analyzeBatch(req: Request, res: Response) {
    const userId = req.user!.id;
    const limit = Math.min(Number(req.body.limit || 10), 15);
    const msgs = await gmailService.listMessages(userId, { query: req.body.query || 'in:inbox', maxResults: 30 });
    const done = new Set((await EmailAnalysisModel.find({ userId, messageId: { $in: msgs.map((m) => m.id) } }).select('messageId').lean()).map((a: any) => a.messageId));
    const todo = msgs.filter((m) => !done.has(m.id)).slice(0, limit);
    const results = [];
    for (const m of todo) results.push(await aiService.analyzeAndSaveEmail(m, userId));
    res.json({ success: true, analyzed: results.length, remaining: msgs.filter((m) => !done.has(m.id)).length - results.length });
  }

  static async digest(req: Request, res: Response) {
    const userId = req.user!.id;
    const emails = await EmailAnalysisModel.find({ userId }).sort({ receivedAt: -1 }).limit(Number(req.query.limit || 25)).lean();
    res.json({ success: true, digest: await aiService.generateDigest(emails as any[]) });
  }
}
