import mongoose from 'mongoose';
import { WorkflowModel } from '../../models/workflow.model';
import { UserModel } from '../../models/user.model';
import { workflowEngine } from './workflow.engine';
import { gmailService } from '../gmail/gmail.service';
import { googleAuthService } from '../google/google-auth.service';
import { logger } from '../../utils/logger';

/**
 * Lightweight in-process scheduler (checks every minute).
 * - trigger.type "schedule":        runs every trigger.config.intervalMinutes
 * - trigger.type "email_received":  polls Gmail every trigger.config.pollMinutes (default 5) for new
 *                                   unread mail matching trigger.config.query and runs once per new email
 * Only user-owned workflows run automatically (templates must be copied first).
 * For production scale this would move to a queue (BullMQ/Redis) — see README.
 */
class SchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  public start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((e) => logger.warn('Scheduler tick failed', { error: e.message })), 60_000);
    logger.info('Workflow scheduler started (60s tick)');
  }

  public stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick() {
    if (this.running || mongoose.connection.readyState !== 1) return;
    this.running = true;
    try {
      const workflows = await WorkflowModel.find({ isActive: true, isTemplate: false, 'trigger.type': { $in: ['schedule', 'email_received'] } });
      for (const wf of workflows) {
        const owner = await UserModel.findById(wf.createdBy).catch(() => null);
        if (!owner) continue;
        const last = wf.lastRunAt ? wf.lastRunAt.getTime() : 0;
        const opts = { userId: String(owner._id), userEmail: owner.email, userName: owner.name, triggerType: wf.trigger.type };

        if (wf.trigger.type === 'schedule') {
          const every = Math.max(5, Number(wf.trigger.config?.intervalMinutes || 60));
          if (Date.now() - last >= every * 60_000) {
            logger.info(`⏰ Scheduled run: ${wf.title}`);
            await WorkflowModel.updateOne({ _id: wf._id }, { lastRunAt: new Date() });
            await workflowEngine.executeWorkflow(wf, {}, opts);
          }
        } else {
          const every = Math.max(1, Number(wf.trigger.config?.pollMinutes || 5));
          if (Date.now() - last < every * 60_000) continue;
          await WorkflowModel.updateOne({ _id: wf._id }, { lastRunAt: new Date() });
          if (!(await googleAuthService.getClient(opts.userId, 'gmail'))) continue; // only poll real inboxes
          const query = `${wf.trigger.config?.query || ''} is:unread newer_than:1d`.trim();
          const msgs = await gmailService.searchMessages(query, opts.userId, 5);
          const processed: string[] = wf.state?.processedIds || [];
          const fresh = msgs.filter((m) => !processed.includes(m.id)).slice(0, 3);
          for (const m of fresh) {
            logger.info(`📨 New email trigger for "${wf.title}": ${m.subject}`);
            await workflowEngine.executeWorkflow(wf, { email: m, emails: [m] }, opts);
          }
          if (fresh.length) {
            await WorkflowModel.updateOne({ _id: wf._id }, { 'state.processedIds': [...fresh.map((m) => m.id), ...processed].slice(0, 300) });
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const schedulerService = new SchedulerService();
