import { IWorkflow, IWorkflowStep, WorkflowModel } from '../../models/workflow.model';
import { WorkflowExecutionModel, IWorkflowExecution } from '../../models/workflow-execution.model';
import { ExecutionLogModel } from '../../models/execution-log.model';
import { toolRegistry } from '../../tools/tool-registry';
import { resolveTemplates, evaluateCondition, getPath } from './template';
import { compact } from '../../utils/async-handler';
import { audit } from '../audit/audit.service';
import { logger } from '../../utils/logger';
import { nowParts, toLocalString } from '../../utils/date-parse';

export interface RunOptions {
  userId: string;
  userEmail?: string;
  userName?: string;
  /** user approved external actions for this run (manual runs from the UI) */
  confirmed?: boolean;
  triggerType?: string;
}

const MAX_FOR_EACH = 10;

export class WorkflowEngine {
  private static instance: WorkflowEngine;
  public static getInstance(): WorkflowEngine {
    if (!WorkflowEngine.instance) WorkflowEngine.instance = new WorkflowEngine();
    return WorkflowEngine.instance;
  }

  /** Lists steps that would change external systems — shown to the user before a manual run. */
  public externalActions(workflow: Pick<IWorkflow, 'steps'>) {
    return [...workflow.steps]
      .sort((a, b) => a.order - b.order)
      .filter((s) => toolRegistry.get(s.tool)?.requiresConfirmation)
      .map((s) => ({ stepId: s.id, name: s.name, tool: s.tool, provider: s.provider }));
  }

  public async executeWorkflow(
    workflowOrId: string | IWorkflow,
    triggerData: Record<string, any> = {},
    opts: RunOptions | string = { userId: 'system' }
  ): Promise<{ execution: IWorkflowExecution; logs: any[] }> {
    const o: RunOptions = typeof opts === 'string' ? { userId: opts } : opts;
    const workflow = typeof workflowOrId === 'string' ? await WorkflowModel.findById(workflowOrId) : workflowOrId;
    if (!workflow) throw Object.assign(new Error(`Workflow not found: ${workflowOrId}`), { statusCode: 404 });

    const sample = workflow.trigger?.config?.sampleData;
    const trigger = { ...(Object.keys(triggerData || {}).length ? {} : sample || {}), ...(workflow.trigger?.config || {}), ...(triggerData || {}) };
    delete (trigger as any).sampleData;

    const startTime = new Date();
    const execution = new WorkflowExecutionModel({
      workflowId: workflow._id,
      workflowTitle: workflow.title,
      userId: o.userId,
      status: 'running',
      triggerType: o.triggerType || workflow.trigger?.type || 'manual',
      triggerData: compact(trigger, 3000),
      startTime,
      stats: { itemsProcessed: 0, itemsSucceeded: 0, itemsFailed: 0 },
    });
    await execution.save();

    const n = nowParts();
    const ctx: any = {
      trigger,
      steps: {},
      emails: Array.isArray(trigger.emails) ? trigger.emails : trigger.email ? [trigger.email] : [],
      user: { id: o.userId, email: o.userEmail, name: o.userName },
      now: toLocalString(n).replace('T', ' ').slice(0, 16),
      today: toLocalString(n).slice(0, 10),
    };
    const approved = Boolean(o.confirmed || workflow.autoApproveExternalActions);
    const logs: any[] = [];
    let succeeded = 0, failed = 0, skipped = 0;

    const steps = [...workflow.steps].sort((a, b) => a.order - b.order);
    logger.info(`▶ Workflow "${workflow.title}" (${steps.length} steps, approved=${approved})`);

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const t0 = Date.now();
        const log = new ExecutionLogModel({
          executionId: execution._id,
          stepIndex: i + 1,
          stepId: step.id,
          stepName: step.name,
          provider: step.provider,
          tool: step.tool,
          status: 'running',
          level: 'info',
          message: `Running ${step.name}…`,
          timestamp: new Date(),
        });

        const finish = async (status: 'completed' | 'failed' | 'skipped', level: 'success' | 'error' | 'warn', message: string, input?: any, output?: any) => {
          log.status = status;
          log.level = level;
          log.message = message;
          log.inputPayload = compact(input, 4000);
          log.outputPayload = compact(output, 8000);
          log.durationMs = Date.now() - t0;
          await log.save();
          logs.push(typeof log.toObject === 'function' ? log.toObject() : log);
        };

        const tool = toolRegistry.get(step.tool);
        if (!tool) {
          failed++;
          await finish('failed', 'error', `Unknown tool "${step.tool}"`);
          if (step.continueOnError) continue;
          throw new Error(`Unknown tool "${step.tool}" in step "${step.name}"`);
        }

        if (!evaluateCondition(step.condition, ctx)) {
          skipped++;
          await finish('skipped', 'warn', `Skipped — condition ${step.condition?.path} ${step.condition?.operator} ${step.condition?.value ?? ''} not met`);
          continue;
        }

        if (tool.requiresConfirmation && !approved) {
          skipped++;
          await finish('skipped', 'warn', `Skipped — "${tool.displayName}" changes an external system and this run was not approved. Run manually or enable auto-approve.`);
          continue;
        }

        try {
          let output: any;
          let input: any;
          if (step.forEach) {
            const items = getPath(ctx, step.forEach);
            const list = Array.isArray(items) ? items.slice(0, MAX_FOR_EACH) : [];
            const results: any[] = [];
            input = { forEach: step.forEach, count: list.length };
            for (const item of list) {
              const params = resolveTemplates(step.config || {}, { ...ctx, item });
              try {
                results.push(await toolRegistry.execute(step.tool, params, { userId: o.userId, confirmed: approved, workflow: { ...ctx, item }, source: 'workflow' }));
              } catch (err: any) {
                results.push({ error: err.message });
              }
            }
            const errors = results.filter((r) => r?.error).length;
            output = { count: results.length - errors, errors, results, first: results.find((r) => !r?.error) || null };
            if (list.length && errors === list.length && !step.continueOnError) throw new Error(results[0].error);
          } else {
            input = resolveTemplates(step.config || {}, ctx);
            output = await toolRegistry.execute(step.tool, input, { userId: o.userId, confirmed: approved, workflow: ctx, source: 'workflow' });
          }

          ctx.steps[step.id] = output;
          if (Array.isArray(output) && (output.length === 0 || output[0]?.subject !== undefined)) ctx.emails = output;
          else if (Array.isArray(output?.emails)) ctx.emails = output.emails;

          succeeded++;
          const msg = (step.forEach ? `${output.count} item(s) processed${output.errors ? `, ${output.errors} failed` : ''}` : '') || output?.message || (Array.isArray(output) ? `${output.length} item(s)` : 'Completed');
          await finish('completed', 'success', `${output?.simulated || output?.first?.simulated ? '[simulated] ' : ''}${msg}`, input, output);
        } catch (err: any) {
          failed++;
          ctx.steps[step.id] = { error: err.message };
          await finish('failed', 'error', `Failed: ${err.message}`);
          if (!step.continueOnError) throw err;
        }
      }

      const endTime = new Date();
      execution.status = 'completed';
      execution.endTime = endTime;
      execution.durationMs = endTime.getTime() - startTime.getTime();
      execution.stats = { itemsProcessed: ctx.emails.length || steps.length, itemsSucceeded: succeeded, itemsFailed: failed };
      execution.summary = `${succeeded} step(s) completed${skipped ? `, ${skipped} skipped` : ''}${failed ? `, ${failed} failed (continued)` : ''} in ${execution.durationMs}ms.`;
      execution.outputResults = compact(ctx.steps, 20000);
      await execution.save();
    } catch (err: any) {
      const endTime = new Date();
      execution.status = 'failed';
      execution.endTime = endTime;
      execution.durationMs = endTime.getTime() - startTime.getTime();
      execution.error = err.message;
      execution.stats = { itemsProcessed: ctx.emails.length, itemsSucceeded: succeeded, itemsFailed: failed };
      execution.summary = `Stopped: ${err.message}`;
      execution.outputResults = compact(ctx.steps, 20000);
      await execution.save();
      logger.error(`Workflow "${workflow.title}" failed`, { error: err.message });
    }

    if (typeof (workflow as any).save === 'function' && workflow._id) {
      await WorkflowModel.updateOne({ _id: workflow._id }, { lastRunAt: new Date() }).catch(() => null);
    }
    audit({ userId: o.userId, action: 'workflow.run', resource: String(workflow._id), status: execution.status === 'completed' ? 'success' : 'failure', details: { title: workflow.title, trigger: execution.triggerType, summary: execution.summary } });
    return { execution, logs };
  }

  /** Runs a single step definition in isolation (used by the builder's "test step" button). */
  public async testStep(step: IWorkflowStep, sampleContext: any, userId: string) {
    const params = resolveTemplates(step.config || {}, sampleContext || {});
    return toolRegistry.execute(step.tool, params, { userId, confirmed: false, workflow: sampleContext, source: 'workflow' });
  }
}

export const workflowEngine = WorkflowEngine.getInstance();
