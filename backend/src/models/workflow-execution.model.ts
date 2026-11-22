import mongoose, { Document, Schema } from 'mongoose';

export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface IWorkflowExecution extends Document {
  workflowId: mongoose.Types.ObjectId | string;
  workflowTitle: string;
  userId: string;
  status: ExecutionStatus;
  triggerType: string;
  triggerData?: Record<string, any>;
  summary?: string;
  stats?: {
    itemsProcessed?: number;
    itemsSucceeded?: number;
    itemsFailed?: number;
  };
  outputResults?: any;
  error?: string;
  startTime: Date;
  endTime?: Date;
  durationMs?: number;
  createdAt: Date;
  updatedAt: Date;
}

const WorkflowExecutionSchema = new Schema<IWorkflowExecution>(
  {
    workflowId: { type: Schema.Types.Mixed, required: true, index: true },
    workflowTitle: { type: String, required: true },
    userId: { type: String, default: 'system', index: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    triggerType: { type: String, default: 'manual' },
    triggerData: { type: Schema.Types.Mixed, default: {} },
    summary: { type: String },
    stats: {
      itemsProcessed: { type: Number, default: 0 },
      itemsSucceeded: { type: Number, default: 0 },
      itemsFailed: { type: Number, default: 0 },
    },
    outputResults: { type: Schema.Types.Mixed },
    error: { type: String },
    startTime: { type: Date, default: Date.now },
    endTime: { type: Date },
    durationMs: { type: Number },
  },
  { timestamps: true }
);

export const WorkflowExecutionModel =
  (mongoose.models.WorkflowExecution as mongoose.Model<IWorkflowExecution>) ||
  mongoose.model<IWorkflowExecution>('WorkflowExecution', WorkflowExecutionSchema);
