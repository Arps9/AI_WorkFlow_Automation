import mongoose, { Document, Schema } from 'mongoose';

export interface IStepCondition {
  path: string; // context path, e.g. "steps.step-2.urgentCount"
  operator: 'exists' | 'not_exists' | 'gt' | 'lt' | 'eq' | 'neq' | 'contains';
  value?: any;
}

export interface IWorkflowStep {
  id: string;
  name: string;
  type: 'action' | 'ai' | 'condition' | 'notification' | 'storage';
  provider: string; // gmail, gemini, slack, jira, github, notion, drive, calendar, system
  tool: string; // tool name from the Tool Registry
  config: Record<string, any>; // tool parameters; strings support {{context.path}} templates
  forEach?: string; // optional context path to an array; runs the tool once per item ({{item.*}})
  condition?: IStepCondition; // optional guard; step is skipped if false
  continueOnError?: boolean;
  order: number;
}

export type TriggerType = 'manual' | 'schedule' | 'webhook' | 'email_received' | 'github_pr_merged';

export interface IWorkflowTrigger {
  type: TriggerType;
  provider: string;
  config: Record<string, any>; // schedule: { intervalMinutes }, email_received: { query }, github_pr_merged: { repo }
}

export interface IWorkflow extends Document {
  title: string;
  description: string;
  category: 'email_intelligence' | 'customer_support' | 'task_automation' | 'meeting_assistant' | 'devops' | 'custom';
  trigger: IWorkflowTrigger;
  steps: IWorkflowStep[];
  isActive: boolean;
  isTemplate: boolean;
  autoApproveExternalActions: boolean; // allow scheduled/webhook runs to perform external writes
  webhookToken?: string;
  lastRunAt?: Date;
  state?: Record<string, any>; // e.g. processed email ids for email_received triggers
  createdBy: string; // userId or "system"
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowStepSchema = new Schema<IWorkflowStep>(
  {
    id: { type: String, required: true },
    name: { type: String, required: true },
    type: { type: String, required: true, enum: ['action', 'ai', 'condition', 'notification', 'storage'] },
    provider: { type: String, required: true },
    tool: { type: String, required: true },
    config: { type: Schema.Types.Mixed, default: {} },
    forEach: { type: String },
    condition: { type: Schema.Types.Mixed },
    continueOnError: { type: Boolean, default: false },
    order: { type: Number, required: true },
  },
  { _id: false }
);

const WorkflowTriggerSchema = new Schema<IWorkflowTrigger>(
  {
    type: {
      type: String,
      required: true,
      enum: ['manual', 'schedule', 'webhook', 'email_received', 'github_pr_merged'],
      default: 'manual',
    },
    provider: { type: String, required: true, default: 'system' },
    config: { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

const WorkflowSchema = new Schema<IWorkflow>(
  {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    category: {
      type: String,
      required: true,
      enum: ['email_intelligence', 'customer_support', 'task_automation', 'meeting_assistant', 'devops', 'custom'],
      default: 'custom',
    },
    trigger: { type: WorkflowTriggerSchema, required: true },
    steps: [WorkflowStepSchema],
    isActive: { type: Boolean, default: true },
    isTemplate: { type: Boolean, default: false },
    autoApproveExternalActions: { type: Boolean, default: false },
    webhookToken: { type: String, select: false },
    lastRunAt: { type: Date },
    state: { type: Schema.Types.Mixed, default: {} },
    createdBy: { type: String, default: 'system', index: true },
  },
  { timestamps: true }
);

export const WorkflowModel =
  (mongoose.models.Workflow as mongoose.Model<IWorkflow>) || mongoose.model<IWorkflow>('Workflow', WorkflowSchema);
