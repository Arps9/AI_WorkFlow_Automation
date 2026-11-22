import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import { aiService } from '../services/ai/ai.service';
import { toolRegistry } from '../tools/tool-registry';
import { AIConversationModel, IChatMessage, IToolCallRecord } from '../models/ai-conversation.model';
import { compact } from '../utils/async-handler';
import { logger } from '../utils/logger';

const MAX_ITERATIONS = 4;
const MAX_CALLS_PER_STEP = 6;

/** Keeps stored tool results small while preserving what the chat UI renders. */
function slim(result: any): any {
  if (Array.isArray(result) && result.length && result[0]?.subject !== undefined) {
    return result.map((e) => ({ messageId: e.messageId, subject: e.subject, sender: e.sender, senderName: e.senderName, category: e.category, priority: e.priority, summary: e.summary, receivedAt: e.receivedAt, isRead: e.isRead, attachments: e.attachments?.length || 0 }));
  }
  if (result && typeof result === 'object' && Array.isArray(result.emails)) return { ...result, emails: slim(result.emails) };
  if (result && typeof result === 'object' && Array.isArray(result.results)) return { ...result, results: result.results.slice(0, 30) };
  return compact(result, 12000);
}

const dbReady = () => mongoose.connection.readyState === 1;

export class AssistantController {
  static async chat(req: Request, res: Response) {
    const userId = req.user!.id;
    const { message } = req.body;
    const sessionId: string = req.body.sessionId || uuidv4();
    if (!message || typeof message !== 'string') return res.status(400).json({ success: false, error: { message: 'message is required', statusCode: 400 } });

    const convo = dbReady() ? await AIConversationModel.findOne({ sessionId, userId }).lean() : null;
    const history = (convo?.messages || (req.body.history as any[]) || []).slice(-10).map((m: any) => ({ role: m.role, content: m.content }));

    const manifest = toolRegistry.getAssistantToolManifest();
    const observations: Array<{ toolName: string; parameters: any; result: any }> = [];
    const records: IToolCallRecord[] = [];
    let intent = '';
    let reply = '';
    let simulated = false;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const plan = await aiService.planAgentStep({ message, history, tools: manifest, observations });
      simulated = simulated || Boolean(plan.isSimulated);
      intent = intent || plan.intent;
      if (plan.replyMessage) reply = plan.replyMessage;
      if (!plan.toolCalls.length) break;

      let newReads = 0;
      let newPending = 0;
      for (const call of plan.toolCalls.slice(0, MAX_CALLS_PER_STEP)) {
        const tool = toolRegistry.get(call.toolName);
        if (!tool || tool.workflowOnly) {
          observations.push({ toolName: call.toolName, parameters: call.parameters, result: { error: `Unknown tool ${call.toolName}` } });
          continue;
        }
        const params = toolRegistry.prepareParams(tool, call.parameters);
        const key = `${tool.name}:${JSON.stringify(params)}`;
        if (records.some((r) => `${r.toolName}:${JSON.stringify(r.parameters)}` === key)) continue;

        if (tool.requiresConfirmation) {
          newPending++;
          records.push({
            id: uuidv4(),
            toolName: tool.name,
            parameters: params,
            status: 'pending_confirmation',
            confirmationDetails: { actionType: tool.actionType || tool.name, description: call.confirmationPrompt || `${tool.displayName}`, targetResource: params.channel || params.to || params.projectKey || params.repo || params.summary || params.title || tool.provider },
          });
          continue;
        }

        try {
          const result = await toolRegistry.execute(tool.name, params, { userId, confirmed: false, source: 'assistant' });
          observations.push({ toolName: tool.name, parameters: params, result: slim(result) });
          records.push({ id: uuidv4(), toolName: tool.name, parameters: params, result: slim(result), status: 'executed', executedAt: new Date() });
          newReads++;
        } catch (err: any) {
          logger.warn(`Assistant tool ${tool.name} failed`, { error: err.message });
          observations.push({ toolName: tool.name, parameters: params, result: { error: err.message } });
          records.push({ id: uuidv4(), toolName: tool.name, parameters: params, result: { error: err.message }, status: 'failed' });
          newReads++;
        }
      }
      if (newPending > 0 || newReads === 0) break;
    }

    if (!reply) reply = records.length ? 'Here is what I found.' : 'How can I help?';
    const emailRefs = records.flatMap((r) => (Array.isArray(r.result) ? r.result.map((e: any) => e.messageId).filter(Boolean) : []));

    const userMsg: IChatMessage = { id: uuidv4(), role: 'user', content: message, timestamp: new Date() };
    const assistantMsg: IChatMessage = { id: uuidv4(), role: 'assistant', content: reply, timestamp: new Date(), intent, toolCalls: records, emailReferences: emailRefs };

    if (dbReady()) {
      await AIConversationModel.findOneAndUpdate(
        { sessionId, userId },
        { $setOnInsert: { sessionId, userId, title: message.slice(0, 60) }, $push: { messages: { $each: [userMsg, assistantMsg] } } },
        { upsert: true, new: true }
      );
    }

    res.json({ success: true, sessionId, intent, simulated, message: assistantMsg });
  }

  static async confirmAction(req: Request, res: Response) {
    const userId = req.user!.id;
    const { sessionId, toolCallId } = req.body;
    let toolName: string = req.body.toolName;
    let parameters: any = req.body.parameters;

    const convo = sessionId && dbReady() ? await AIConversationModel.findOne({ sessionId, userId }) : null;
    let record: IToolCallRecord | undefined;
    if (convo && toolCallId) {
      for (const m of convo.messages) {
        const found = (m.toolCalls || []).find((t) => t.id === toolCallId);
        if (found) record = found;
      }
      if (!record) return res.status(404).json({ success: false, error: { message: 'Pending action not found', statusCode: 404 } });
      if (record.status !== 'pending_confirmation') return res.status(409).json({ success: false, error: { message: `Action already ${record.status}`, statusCode: 409 } });
      toolName = record.toolName;
      parameters = { ...record.parameters, ...(req.body.parameters || {}) };
    }
    if (!toolName || !toolRegistry.get(toolName)) return res.status(404).json({ success: false, error: { message: `Tool ${toolName} not found`, statusCode: 404 } });

    let result: any;
    let status: IToolCallRecord['status'] = 'executed';
    try {
      result = await toolRegistry.execute(toolName, parameters, { userId, confirmed: true, source: 'assistant' });
    } catch (err: any) {
      result = { error: err.message };
      status = 'failed';
    }

    const text = status === 'failed' ? `⚠️ ${toolRegistry.get(toolName)!.displayName} failed: ${result.error}` : `✅ ${result?.message || `${toolRegistry.get(toolName)!.displayName} completed`}${result?.url && result.url !== '#' ? `\n${result.url}` : ''}`;
    if (convo && record) {
      record.status = status;
      record.result = slim(result);
      record.executedAt = new Date();
      convo.messages.push({ id: uuidv4(), role: 'assistant', content: text, timestamp: new Date() } as IChatMessage);
      convo.markModified('messages');
      await convo.save();
    }
    res.status(status === 'failed' ? 502 : 200).json({ success: status !== 'failed', toolName, status, result, message: text, error: status === 'failed' ? { message: result.error } : undefined });
  }

  static async rejectAction(req: Request, res: Response) {
    const userId = req.user!.id;
    const { sessionId, toolCallId } = req.body;
    const convo = await AIConversationModel.findOne({ sessionId, userId });
    if (!convo) return res.status(404).json({ success: false, error: { message: 'Conversation not found', statusCode: 404 } });
    let changed = false;
    convo.messages.forEach((m) => (m.toolCalls || []).forEach((t) => {
      if (t.id === toolCallId && t.status === 'pending_confirmation') {
        t.status = 'rejected';
        changed = true;
      }
    }));
    if (changed) {
      convo.markModified('messages');
      await convo.save();
    }
    res.json({ success: true, status: 'rejected' });
  }

  static async getHistory(req: Request, res: Response) {
    const conversation = await AIConversationModel.findOne({ sessionId: req.params.sessionId, userId: req.user!.id });
    res.json({ success: true, conversation: conversation || { sessionId: req.params.sessionId, messages: [] } });
  }

  static async listSessions(req: Request, res: Response) {
    const sessions = await AIConversationModel.find({ userId: req.user!.id }).select('sessionId title updatedAt createdAt').sort({ updatedAt: -1 }).limit(30);
    res.json({ success: true, sessions });
  }

  static async deleteSession(req: Request, res: Response) {
    await AIConversationModel.deleteOne({ sessionId: req.params.sessionId, userId: req.user!.id });
    res.json({ success: true });
  }
}
