import mongoose, { Document, Schema } from 'mongoose';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface IExecutionLog extends Document {
  executionId: mongoose.Types.ObjectId | string;
  stepIndex: number;
  stepId: string;
  stepName: string;
  provider: string;
  tool: string;
  status: StepStatus;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  inputPayload?: any;
  outputPayload?: any;
  durationMs?: number;
  timestamp: Date;
}

const ExecutionLogSchema = new Schema<IExecutionLog>(
  {
    executionId: { type: Schema.Types.Mixed, required: true, index: true },
    stepIndex: { type: Number, required: true },
    stepId: { type: String, required: true },
    stepName: { type: String, required: true },
    provider: { type: String, required: true },
    tool: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed', 'skipped'],
      default: 'pending',
    },
    level: {
      type: String,
      enum: ['info', 'warn', 'error', 'success'],
      default: 'info',
    },
    message: { type: String, required: true },
    inputPayload: { type: Schema.Types.Mixed },
    outputPayload: { type: Schema.Types.Mixed },
    durationMs: { type: Number, default: 0 },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ExecutionLogSchema.index({ executionId: 1, stepIndex: 1 });

export const ExecutionLogModel =
  (mongoose.models.ExecutionLog as mongoose.Model<IExecutionLog>) ||
  mongoose.model<IExecutionLog>('ExecutionLog', ExecutionLogSchema);
