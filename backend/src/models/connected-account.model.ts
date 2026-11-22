import mongoose, { Document, Schema } from 'mongoose';

export type IntegrationProviderName = 'gmail' | 'slack' | 'jira' | 'github' | 'notion' | 'drive' | 'calendar';

/**
 * One document per (user, provider).
 * - Google (gmail/drive/calendar) share a single OAuth grant stored on the `gmail` record.
 * - Slack/Jira/GitHub/Notion store API tokens AES-256-GCM encrypted in `credentials`.
 */
export interface IConnectedAccount extends Document {
  userId: string;
  provider: IntegrationProviderName;
  accountEmail?: string;
  accountName?: string;
  accessToken?: string;
  refreshToken?: string;
  credentials?: string; // encrypted JSON blob
  expiresAt?: Date;
  scopes: string[];
  status: 'connected' | 'disconnected' | 'expired' | 'error';
  metadata?: Record<string, any>;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
  toSafeObject(): Record<string, any>;
}

const ConnectedAccountSchema = new Schema<IConnectedAccount>(
  {
    userId: { type: String, required: true, index: true },
    provider: {
      type: String,
      required: true,
      enum: ['gmail', 'slack', 'jira', 'github', 'notion', 'drive', 'calendar'],
      index: true,
    },
    accountEmail: { type: String },
    accountName: { type: String },
    accessToken: { type: String, select: false },
    refreshToken: { type: String, select: false },
    credentials: { type: String, select: false },
    expiresAt: { type: Date },
    scopes: [{ type: String }],
    status: {
      type: String,
      enum: ['connected', 'disconnected', 'expired', 'error'],
      default: 'disconnected',
    },
    metadata: { type: Schema.Types.Mixed, default: {} },
    lastError: { type: String },
  },
  { timestamps: true }
);

ConnectedAccountSchema.index({ userId: 1, provider: 1 }, { unique: true });

ConnectedAccountSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.accessToken;
  delete obj.refreshToken;
  delete obj.credentials;
  return obj;
};

export const ConnectedAccountModel =
  (mongoose.models.ConnectedAccount as mongoose.Model<IConnectedAccount>) ||
  mongoose.model<IConnectedAccount>('ConnectedAccount', ConnectedAccountSchema);
