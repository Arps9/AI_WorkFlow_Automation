import { Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { WorkflowModel } from '../models/workflow.model';
import { UserModel } from '../models/user.model';
import { WorkflowExecutionModel } from '../models/workflow-execution.model';
import { ExecutionLogModel } from '../models/execution-log.model';
import { workflowEngine } from '../services/workflows/workflow.engine';
import { toolRegistry } from '../tools/tool-registry';
import { randomToken } from '../utils/crypto';
import { env } from '../config/env.config';
import { audit } from '../services/audit/audit.service';

const StepSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(['action', 'ai', 'condition', 'notification', 'storage']).default('action'),
  provider: z.string().optional(),
  tool: z.string().min(1),
  config: z.record(z.any()).default({}),
  forEach: z.string().optional().nullable(),
  condition: z.object({ path: z.string(), operator: z.enum(['exists', 'not_exists', 'gt', 'lt', 'eq', 'neq', 'contains']), value: z.any().optional() }).optional().nullable(),
  continueOnError: z.boolean().optional(),
  order: z.number().optional(),
});

const WorkflowSchema = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().max(1000).default(''),
  category: z.enum(['email_intelligence', 'customer_support', 'task_automation', 'meeting_assistant', 'devops', 'custom']).default('custom'),
  trigger: z.object({ type: z.enum(['manual', 'schedule', 'webhook', 'email_received', 'github_pr_merged']).default('manual'), provider: z.string().default('system'), config: z.record(z.any()).default({}) }).default({ type: 'manual', provider: 'system', config: {} }),
  steps: z.array(StepSchema).min(1, 'At least one step is required').max(25),
  isActive: z.boolean().default(true),
  autoApproveExternalActions: z.boolean().default(false),
});

function normalizeSteps(steps: z.infer<typeof StepSchema>[]) {
  return steps.map((s, i) => {
    const tool = toolRegistry.get(s.tool);
    if (!tool) throw Object.assign(new Error(`Unknown tool "${s.tool}" in step "${s.name}"`), { statusCode: 400 });
    return { ...s, provider: s.provider || tool.provider, order: i + 1, forEach: s.forEach || undefined, condition: s.condition || undefined };
  });
}

const visibleTo = (userId: string) => ({ $or: [{ isTemplate: true }, { createdBy: userId }] });

function webhookUrl(id: string, token?: string) {
  return token ? `${env.BACKEND_URL}/api/webhooks/workflows/${id}/${token}` : undefined;
}

export class WorkflowsController {
  static async listWorkflows(req: Request, res: Response) {
    const workflows = await WorkflowModel.find(visibleTo(req.user!.id)).select('+webhookToken').sort({ isTemplate: -1, createdAt: 1 });
    res.json({
      success: true,
      count: workflows.length,
      workflows: workflows.map((w) => {
        const o: any = w.toObject();
        o.isOwner = w.createdBy === req.user!.id;
        o.webhookUrl = o.isOwner ? webhookUrl(String(w._id), w.webhookToken) : undefined;
        delete o.webhookToken;
        o.externalActions = workflowEngine.externalActions(w);
        return o;
      }),
    });
  }

  static async getWorkflow(req: Request, res: Response) {
    const wf = await WorkflowModel.findOne({ _id: req.params.id, ...visibleTo(req.user!.id) });
    if (!wf) return res.status(404).json({ success: false, error: { message: 'Workflow not found', statusCode: 404 } });
    res.json({ success: true, workflow: wf, externalActions: workflowEngine.externalActions(wf) });
  }

  static async createWorkflow(req: Request, res: Response) {
    const data = WorkflowSchema.parse(req.body);
    const wf = await WorkflowModel.create({ ...data, steps: normalizeSteps(data.steps), isTemplate: false, createdBy: req.user!.id, webhookToken: data.trigger.type === 'webhook' ? randomToken() : undefined });
    audit({ userId: req.user!.id, action: 'workflow.create', resource: String(wf._id), status: 'success', details: { title: wf.title } });
    res.status(201).json({ success: true, workflow: wf });
  }

  static async updateWorkflow(req: Request, res: Response) {
    const wf = await WorkflowModel.findOne({ _id: req.params.id }).select('+webhookToken');
    if (!wf) return res.status(404).json({ success: false, error: { message: 'Workflow not found', statusCode: 404 } });
    if (wf.isTemplate && req.user!.role !== 'admin') return res.status(403).json({ success: false, error: { message: 'Templates are read-only — duplicate it first', statusCode: 403 } });
    if (!wf.isTemplate && wf.createdBy !== req.user!.id && req.user!.role !== 'admin') return res.status(403).json({ success: false, error: { message: 'Not your workflow', statusCode: 403 } });
    const data = WorkflowSchema.partial().parse(req.body);
    if (data.steps) (data as any).steps = normalizeSteps(data.steps);
    Object.assign(wf, data);
    if (wf.trigger.type === 'webhook' && !wf.webhookToken) wf.webhookToken = randomToken();
    await wf.save();
    res.json({ success: true, workflow: wf });
  }

  static async deleteWorkflow(req: Request, res: Response) {
    const wf = await WorkflowModel.findById(req.params.id);
    if (!wf) return res.status(404).json({ success: false, error: { message: 'Workflow not found', statusCode: 404 } });
    if (wf.isTemplate ? req.user!.role !== 'admin' : wf.createdBy !== req.user!.id && req.user!.role !== 'admin') {
      return res.status(403).json({ success: false, error: { message: 'Not allowed', statusCode: 403 } });
    }
    await wf.deleteOne();
    audit({ userId: req.user!.id, action: 'workflow.delete', resource: req.params.id, status: 'success', details: { title: wf.title } });
    res.json({ success: true });
  }

  static async duplicateWorkflow(req: Request, res: Response) {
    const src = await WorkflowModel.findOne({ _id: req.params.id, ...visibleTo(req.user!.id) });
    if (!src) return res.status(404).json({ success: false, error: { message: 'Workflow not found', statusCode: 404 } });
    const o: any = src.toObject();
    delete o._id;
    delete o.createdAt;
    delete o.updatedAt;
    const copy = await WorkflowModel.create({ ...o, title: `${src.title} (copy)`, isTemplate: false, createdBy: req.user!.id, lastRunAt: undefined, state: {}, webhookToken: o.trigger?.type === 'webhook' ? randomToken() : undefined });
    res.status(201).json({ success: true, workflow: copy });
  }

  static async regenerateWebhook(req: Request, res: Response) {
    const wf = await WorkflowModel.findOne({ _id: req.params.id, createdBy: req.user!.id });
    if (!wf) return res.status(404).json({ success: false, error: { message: 'Workflow not found', statusCode: 404 } });
    wf.webhookToken = randomToken();
    await wf.save();
    res.json({ success: true, webhookUrl: webhookUrl(String(wf._id), wf.webhookToken) });
  }

  static async executeWorkflow(req: Request, res: Response) {
    const wf = await WorkflowModel.findOne({ _id: req.params.id, ...visibleTo(req.user!.id) });
    if (!wf) return res.status(404).json({ success: false, error: { message: 'Workflow not found', statusCode: 404 } });
    const external = workflowEngine.externalActions(wf);
    if (external.length && req.body.confirmed === undefined) {
      return res.json({ success: false, requiresConfirmation: true, externalActions: external, message: `This workflow performs ${external.length} external action(s). Re-send with confirmed: true to approve, or confirmed: false to run read-only steps only.` });
    }
    const result = await workflowEngine.executeWorkflow(wf, req.body.triggerData || {}, { userId: req.user!.id, userEmail: req.user!.email, userName: req.user!.name, confirmed: req.body.confirmed === true, triggerType: 'manual' });
    res.json({ success: true, execution: result.execution, logs: result.logs });
  }

  static async listExecutions(req: Request, res: Response) {
    const limit = Math.min(parseInt((req.query.limit as string) || '25', 10), 100);
    const filter: any = { userId: req.user!.id };
    if (req.query.workflowId) filter.workflowId = req.query.workflowId;
    const executions = await WorkflowExecutionModel.find(filter).select('-outputResults').sort({ startTime: -1 }).limit(limit);
    res.json({ success: true, count: executions.length, executions });
  }

  static async getExecutionById(req: Request, res: Response) {
    const execution = await WorkflowExecutionModel.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!execution) return res.status(404).json({ success: false, error: { message: 'Execution not found', statusCode: 404 } });
    const logs = await ExecutionLogModel.find({ executionId: execution._id }).sort({ stepIndex: 1 });
    res.json({ success: true, execution, logs });
  }

  static async getExecutionLogs(req: Request, res: Response) {
    const execution = await WorkflowExecutionModel.findOne({ _id: req.params.id, userId: req.user!.id }).select('_id');
    if (!execution) return res.status(404).json({ success: false, error: { message: 'Execution not found', statusCode: 404 } });
    const logs = await ExecutionLogModel.find({ executionId: execution._id }).sort({ stepIndex: 1 });
    res.json({ success: true, count: logs.length, logs });
  }
}

// ------------------------------------------------------------------ webhooks (no JWT — authenticated by token/signature)
export class WebhooksController {
  static async workflowWebhook(req: Request, res: Response) {
    const wf = await WorkflowModel.findById(req.params.id).select('+webhookToken');
    const valid = wf?.webhookToken && req.params.token.length === wf.webhookToken.length && crypto.timingSafeEqual(Buffer.from(req.params.token), Buffer.from(wf.webhookToken));
    if (!wf || !valid || !wf.isActive) return res.status(404).json({ success: false, error: { message: 'Unknown webhook', statusCode: 404 } });
    const owner = await UserModel.findById(wf.createdBy);
    if (!owner) return res.status(404).json({ success: false, error: { message: 'Workflow owner missing', statusCode: 404 } });
    const result = await workflowEngine.executeWorkflow(wf, req.body || {}, { userId: String(owner._id), userEmail: owner.email, userName: owner.name, triggerType: 'webhook' });
    res.json({ success: true, executionId: result.execution._id, status: result.execution.status, summary: result.execution.summary });
  }

  /** GitHub "pull_request" webhook → runs workflows whose trigger is github_pr_merged. */
  static async github(req: Request, res: Response) {
    if (env.GITHUB_WEBHOOK_SECRET) {
      const sig = String(req.headers['x-hub-signature-256'] || '');
      const expected = 'sha256=' + crypto.createHmac('sha256', env.GITHUB_WEBHOOK_SECRET).update(req.rawBody || Buffer.from('')).digest('hex');
      if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return res.status(401).json({ success: false, error: { message: 'Invalid signature', statusCode: 401 } });
      }
    }
    const event = req.headers['x-github-event'];
    if (event === 'ping') return res.json({ success: true, pong: true });
    const pr = req.body?.pull_request;
    if (event !== 'pull_request' || req.body?.action !== 'closed' || !pr?.merged) return res.json({ success: true, ignored: true });

    const repo = req.body.repository?.full_name;
    const workflows = await WorkflowModel.find({ isActive: true, isTemplate: false, 'trigger.type': 'github_pr_merged' });
    const runs = [];
    for (const wf of workflows) {
      if (wf.trigger.config?.repo && wf.trigger.config.repo !== repo) continue;
      const owner = await UserModel.findById(wf.createdBy);
      if (!owner) continue;
      const r = await workflowEngine.executeWorkflow(
        wf,
        { repo, number: pr.number, title: pr.title, author: pr.user?.login, url: pr.html_url, mergedBy: pr.merged_by?.login },
        { userId: String(owner._id), userEmail: owner.email, userName: owner.name, triggerType: 'github_pr_merged' }
      );
      runs.push({ workflow: wf.title, status: r.execution.status });
    }
    res.json({ success: true, triggered: runs.length, runs });
  }
}
