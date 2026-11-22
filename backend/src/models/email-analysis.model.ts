import mongoose, { Document, Schema } from 'mongoose';

export type EmailCategory =
  | 'Important'
  | 'Urgent'
  | 'Bug/Issue'
  | 'Client Request'
  | 'Meeting'
  | 'Normal'
  | 'Promotional';

export type EmailPriority = 'High' | 'Medium' | 'Low';

export interface IEmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

export interface IEmailAnalysis extends Document {
  userId: string;
  messageId: string;
  threadId?: string;
  sender: string;
  senderName?: string;
  recipient?: string;
  subject: string;
  receivedAt: Date;
  snippet?: string;
  bodyText?: string;
  
  // AI Analysis fields
  summary?: string;
  category: EmailCategory;
  priority: EmailPriority;
  keyPoints: string[];
  recommendedAction?: string;
  suggestedReply?: string;
  suggestedActions: Array<{ label: string; tool?: string; reason?: string }>;
  attachments: IEmailAttachment[];
  isSimulatedAnalysis: boolean;

  // Gmail state
  isRead: boolean;
  isStarred: boolean;
  labels: string[];
  isDemoData: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const EmailAnalysisSchema = new Schema<IEmailAnalysis>(
  {
    userId: { type: String, required: true, default: 'system', index: true },
    messageId: { type: String, required: true, index: true },
    threadId: { type: String },
    sender: { type: String, required: true, index: true },
    senderName: { type: String },
    recipient: { type: String },
    subject: { type: String, required: true },
    receivedAt: { type: Date, default: Date.now, index: true },
    snippet: { type: String },
    bodyText: { type: String },

    summary: { type: String },
    category: {
      type: String,
      enum: ['Important', 'Urgent', 'Bug/Issue', 'Client Request', 'Meeting', 'Normal', 'Promotional'],
      default: 'Normal',
      index: true,
    },
    priority: {
      type: String,
      enum: ['High', 'Medium', 'Low'],
      default: 'Medium',
      index: true,
    },
    keyPoints: [{ type: String }],
    recommendedAction: { type: String },
    suggestedReply: { type: String },
    suggestedActions: { type: Schema.Types.Mixed, default: [] },
    attachments: { type: Schema.Types.Mixed, default: [] },
    isSimulatedAnalysis: { type: Boolean, default: false },

    isRead: { type: Boolean, default: false },
    isStarred: { type: Boolean, default: false },
    labels: [{ type: String }],
    isDemoData: { type: Boolean, default: false },
  },
  { timestamps: true }
);

EmailAnalysisSchema.index({ userId: 1, messageId: 1 }, { unique: true });

export const EmailAnalysisModel =
  (mongoose.models.EmailAnalysis as mongoose.Model<IEmailAnalysis>) ||
  mongoose.model<IEmailAnalysis>('EmailAnalysis', EmailAnalysisSchema);
