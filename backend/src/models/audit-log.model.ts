import mongoose, { Document, Schema } from 'mongoose';

export interface IAuditLog extends Document {
  userId?: string;
  userEmail?: string;
  action: string; // e.g. auth.login, tool.execute, integration.connect, workflow.run
  resource?: string; // e.g. tool name / workflow id
  provider?: string;
  status: 'success' | 'failure' | 'pending' | 'simulated';
  details?: Record<string, any>;
  ip?: string;
  createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    userId: { type: String, index: true },
    userEmail: { type: String },
    action: { type: String, required: true, index: true },
    resource: { type: String },
    provider: { type: String, index: true },
    status: { type: String, enum: ['success', 'failure', 'pending', 'simulated'], default: 'success' },
    details: { type: Schema.Types.Mixed },
    ip: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

AuditLogSchema.index({ createdAt: -1 });

export const AuditLogModel =
  (mongoose.models.AuditLog as mongoose.Model<IAuditLog>) || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
