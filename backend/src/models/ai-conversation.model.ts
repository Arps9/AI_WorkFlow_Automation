import mongoose, { Document, Schema } from 'mongoose';

export interface IToolCallRecord {
  id?: string;
  toolName: string;
  parameters: Record<string, any>;
  result?: any;
  status: 'executed' | 'pending_confirmation' | 'rejected' | 'failed';
  confirmationDetails?: {
    actionType: string;
    description: string;
    targetResource: string;
  };
  executedAt?: Date;
}

export interface IChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  intent?: string;
  toolCalls?: IToolCallRecord[];
  emailReferences?: string[]; // messageIds
}

export interface IAIConversation extends Document {
  sessionId: string;
  userId: string;
  title: string;
  messages: IChatMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const ToolCallRecordSchema = new Schema<IToolCallRecord>(
  {
    id: { type: String },
    toolName: { type: String, required: true },
    parameters: { type: Schema.Types.Mixed, default: {} },
    result: { type: Schema.Types.Mixed },
    status: {
      type: String,
      enum: ['executed', 'pending_confirmation', 'rejected', 'failed'],
      default: 'executed',
    },
    confirmationDetails: {
      actionType: { type: String },
      description: { type: String },
      targetResource: { type: String },
    },
    executedAt: { type: Date },
  },
  { _id: false }
);

const ChatMessageSchema = new Schema<IChatMessage>(
  {
    id: { type: String, required: true },
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    intent: { type: String },
    toolCalls: [ToolCallRecordSchema],
    emailReferences: [{ type: String }],
  },
  { _id: false }
);

const AIConversationSchema = new Schema<IAIConversation>(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    title: { type: String, default: 'New Conversation' },
    messages: [ChatMessageSchema],
  },
  { timestamps: true }
);

export const AIConversationModel =
  (mongoose.models.AIConversation as mongoose.Model<IAIConversation>) ||
  mongoose.model<IAIConversation>('AIConversation', AIConversationSchema);
