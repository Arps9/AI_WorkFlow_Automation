import mongoose, { Document, Schema } from 'mongoose';

export interface IActionItem {
  task: string;
  owner?: string;
  dueDate?: string;
  status: 'open' | 'done';
  jiraKey?: string;
}

export interface IMeeting extends Document {
  userId: string;
  title: string;
  scheduledAt?: Date;
  durationMinutes: number;
  attendees: string[];
  agenda: string[];
  transcript?: string;
  summary?: string;
  decisions: string[];
  actionItems: IActionItem[];
  deadlines: string[];
  attendance: string[];
  calendarEventId?: string;
  calendarLink?: string;
  notionPageUrl?: string;
  status: 'scheduled' | 'completed';
  isSimulated?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ActionItemSchema = new Schema<IActionItem>(
  {
    task: { type: String, required: true },
    owner: { type: String },
    dueDate: { type: String },
    status: { type: String, enum: ['open', 'done'], default: 'open' },
    jiraKey: { type: String },
  },
  { _id: false }
);

const MeetingSchema = new Schema<IMeeting>(
  {
    userId: { type: String, required: true, index: true },
    title: { type: String, required: true },
    scheduledAt: { type: Date },
    durationMinutes: { type: Number, default: 30 },
    attendees: [{ type: String }],
    agenda: [{ type: String }],
    transcript: { type: String },
    summary: { type: String },
    decisions: [{ type: String }],
    actionItems: [ActionItemSchema],
    deadlines: [{ type: String }],
    attendance: [{ type: String }],
    calendarEventId: { type: String },
    calendarLink: { type: String },
    notionPageUrl: { type: String },
    status: { type: String, enum: ['scheduled', 'completed'], default: 'scheduled' },
    isSimulated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const MeetingModel =
  (mongoose.models.Meeting as mongoose.Model<IMeeting>) || mongoose.model<IMeeting>('Meeting', MeetingSchema);
