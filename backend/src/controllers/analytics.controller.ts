import { Request, Response } from 'express';
import { EmailAnalysisModel } from '../models/email-analysis.model';
import { WorkflowModel } from '../models/workflow.model';
import { WorkflowExecutionModel } from '../models/workflow-execution.model';
import { AuditLogModel } from '../models/audit-log.model';
import { MeetingModel } from '../models/meeting.model';
import { KnowledgeDocumentModel } from '../models/knowledge.model';
import { UserModel } from '../models/user.model';
import { integrationsService } from '../services/integrations/integrations.service';
import { aiService } from '../services/ai/ai.service';

const toMap = (rows: Array<{ _id: string; count: number }>) => Object.fromEntries(rows.map((r) => [r._id || 'Unknown', r.count]));

export class AnalyticsController {
  /** Real numbers for the dashboard — every metric is computed from stored records. */
  static async overview(req: Request, res: Response) {
    const userId = req.user!.id;
    const since = new Date(Date.now() - 6 * 86400000);
    since.setHours(0, 0, 0, 0);

    const [emailsAnalyzed, byCategory, byPriority, workflows, execTotals, execDaily, actionsByProvider, writeActions, meetings, documents, integrations] = await Promise.all([
      EmailAnalysisModel.countDocuments({ userId }),
      EmailAnalysisModel.aggregate([{ $match: { userId } }, { $group: { _id: '$category', count: { $sum: 1 } } }]),
      EmailAnalysisModel.aggregate([{ $match: { userId } }, { $group: { _id: '$priority', count: { $sum: 1 } } }]),
      WorkflowModel.countDocuments({ $or: [{ isTemplate: true }, { createdBy: userId }], isActive: true }),
      WorkflowExecutionModel.aggregate([{ $match: { userId } }, { $group: { _id: '$status', count: { $sum: 1 }, avgMs: { $avg: '$durationMs' } } }]),
      WorkflowExecutionModel.aggregate([
        { $match: { userId, startTime: { $gte: since } } },
        { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$startTime' } }, total: { $sum: 1 }, failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } } } },
        { $sort: { _id: 1 } },
      ]),
      AuditLogModel.aggregate([{ $match: { userId, action: { $in: ['tool.read', 'tool.write'] } } }, { $group: { _id: '$provider', count: { $sum: 1 } } }]),
      AuditLogModel.countDocuments({ userId, action: 'tool.write' }),
      MeetingModel.countDocuments({ userId }),
      KnowledgeDocumentModel.countDocuments({ userId }),
      integrationsService.getAllIntegrations(userId),
    ]);

    const totals = Object.fromEntries(execTotals.map((r: any) => [r._id, r.count]));
    const runs = Object.values(totals).reduce((a: number, b: any) => a + Number(b), 0);
    const days: Array<{ date: string; total: number; failed: number }> = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(since.getTime() + i * 86400000).toISOString().slice(0, 10);
      const row: any = execDaily.find((x: any) => x._id === d);
      days.push({ date: d, total: row?.total || 0, failed: row?.failed || 0 });
    }

    res.json({
      success: true,
      overview: {
        emailsAnalyzed,
        emailsByCategory: toMap(byCategory),
        emailsByPriority: toMap(byPriority),
        activeWorkflows: workflows,
        workflowRuns: runs,
        workflowSuccessRate: runs ? Math.round(((totals.completed || 0) / runs) * 100) : null,
        avgRunMs: Math.round(execTotals.reduce((a: number, r: any) => a + (r.avgMs || 0) * r.count, 0) / (runs || 1)),
        runsLast7Days: days,
        toolActionsByProvider: toMap(actionsByProvider),
        automatedWriteActions: writeActions,
        meetings,
        knowledgeDocuments: documents,
        integrationsConnected: integrations.filter((i) => i.status === 'connected').length,
        integrationsTotal: integrations.length,
        ai: aiService.getStatus(),
      },
    });
  }
}

export class AdminController {
  static async listUsers(_req: Request, res: Response) {
    res.json({ success: true, users: await UserModel.find().sort({ createdAt: 1 }) });
  }

  static async updateUser(req: Request, res: Response) {
    const { role, isActive } = req.body;
    if (req.params.id === req.user!.id && (role && role !== 'admin' || isActive === false)) {
      return res.status(400).json({ success: false, error: { message: 'You cannot demote or disable yourself', statusCode: 400 } });
    }
    const update: any = {};
    if (role && ['admin', 'manager', 'user'].includes(role)) update.role = role;
    if (typeof isActive === 'boolean') update.isActive = isActive;
    const user = await UserModel.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!user) return res.status(404).json({ success: false, error: { message: 'User not found', statusCode: 404 } });
    res.json({ success: true, user });
  }

  static async auditLogs(req: Request, res: Response) {
    const filter: any = req.user!.role === 'admin' && req.query.all === 'true' ? {} : { userId: req.user!.id };
    if (req.query.action) filter.action = req.query.action;
    if (req.query.provider) filter.provider = req.query.provider;
    const logs = await AuditLogModel.find(filter).sort({ createdAt: -1 }).limit(Math.min(Number(req.query.limit || 100), 500));
    res.json({ success: true, count: logs.length, logs });
  }
}
