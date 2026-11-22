import { ToolDefinition } from './tool.interface';
import { driveService } from '../services/google/drive.service';
import { calendarService } from '../services/google/calendar.service';
import { gmailService } from '../services/gmail/gmail.service';
import { aiService } from '../services/ai/ai.service';

// ------------------------------------------------------------------ Drive
const driveSearch: ToolDefinition = {
  name: 'drive_search_files',
  displayName: 'Search Google Drive',
  description: 'Finds Drive files by name or full-text content (e.g. "latest project proposal")',
  provider: 'drive',
  requiresConfirmation: false,
  parameters: { query: { type: 'string', description: 'Search text' }, limit: { type: 'number', description: 'Max files', default: 10 } },
  execute: (p, ctx) => driveService.searchFiles(ctx.userId, p),
};

const driveSummarize: ToolDefinition = {
  name: 'drive_summarize_file',
  displayName: 'Summarize Drive Document',
  description: 'Extracts text (Docs, Sheets, PDFs) from a Drive file and returns an AI summary',
  provider: 'drive',
  requiresConfirmation: false,
  parameters: { fileId: { type: 'string', description: 'Drive file id', required: true } },
  async execute(p, ctx) {
    const f = await driveService.readFileText(ctx.userId, p.fileId);
    const s = await aiService.summarizeEmail(f.name, f.text.slice(0, 12000), 'Google Drive');
    return { fileId: p.fileId, name: f.name, url: f.webViewLink, characters: f.text.length, summary: s.summary, keyPoints: s.keyPoints, simulated: f.simulated || s.isSimulated };
  },
};

const driveUpload: ToolDefinition = {
  name: 'drive_upload_file',
  displayName: 'Upload Text File to Drive',
  description: 'Creates a text/markdown file in Google Drive (e.g. reports, notes)',
  provider: 'drive',
  requiresConfirmation: true,
  actionType: 'drive_upload',
  parameters: {
    name: { type: 'string', description: 'File name, e.g. report.md', required: true },
    content: { type: 'string', description: 'Text content', required: true },
    folderName: { type: 'string', description: 'Folder to put it in (created if missing)' },
  },
  execute: (p, ctx) => driveService.uploadFile(ctx.userId, { ...p, mimeType: p.name?.endsWith('.md') ? 'text/markdown' : 'text/plain' }),
};

const driveSaveAttachment: ToolDefinition = {
  name: 'drive_save_attachment',
  displayName: 'Save Email Attachment to Drive',
  description: 'Saves attachments of a Gmail message into a Drive folder (e.g. invoices)',
  provider: 'drive',
  requiresConfirmation: true,
  actionType: 'drive_upload',
  parameters: {
    messageId: { type: 'string', description: 'Gmail message id', required: true },
    folderName: { type: 'string', description: 'Destination folder', default: 'AutoFlow Attachments' },
  },
  async execute(p, ctx) {
    const msg = await gmailService.getMessage(p.messageId, ctx.userId);
    if (!msg) throw new Error(`Email not found: ${p.messageId}`);
    if (!msg.attachments.length) return { status: 'skipped', message: 'Email has no attachments' };
    const saved = [];
    for (const a of msg.attachments.slice(0, 10)) {
      const data = await gmailService.getAttachment(ctx.userId, msg.id, a.attachmentId);
      saved.push(await driveService.uploadFile(ctx.userId, { name: a.filename, content: data, mimeType: a.mimeType, folderName: p.folderName }));
    }
    return { status: 'uploaded', count: saved.length, files: saved.map((s: any) => s.file), simulated: saved.some((s: any) => s.simulated), message: `Saved ${saved.length} attachment(s) to "${p.folderName}"` };
  },
};

const driveFolder: ToolDefinition = {
  name: 'drive_create_folder',
  displayName: 'Create Drive Folder',
  description: 'Creates a Drive folder if it does not exist',
  provider: 'drive',
  requiresConfirmation: true,
  actionType: 'drive_folder',
  parameters: { name: { type: 'string', description: 'Folder name', required: true } },
  execute: (p, ctx) => driveService.ensureFolder(ctx.userId, p.name),
};

const driveMove: ToolDefinition = {
  name: 'drive_move_file',
  displayName: 'Organize Drive File',
  description: 'Moves a file into a named folder (creates the folder if needed)',
  provider: 'drive',
  requiresConfirmation: true,
  actionType: 'drive_move',
  parameters: { fileId: { type: 'string', description: 'Drive file id', required: true }, folderName: { type: 'string', description: 'Destination folder', required: true } },
  execute: (p, ctx) => driveService.moveFile(ctx.userId, p),
};

// ------------------------------------------------------------------ Calendar
const calList: ToolDefinition = {
  name: 'calendar_list_events',
  displayName: 'List Calendar Events',
  description: 'Lists upcoming Google Calendar events',
  provider: 'calendar',
  requiresConfirmation: false,
  parameters: { days: { type: 'number', description: 'Days ahead (default 7)', default: 7 }, query: { type: 'string', description: 'Optional text filter' } },
  execute: (p, ctx) => calendarService.listEvents(ctx.userId, p),
};

const calAvailability: ToolDefinition = {
  name: 'calendar_check_availability',
  displayName: 'Check Availability',
  description: 'Free/busy check and conflict detection for a time slot (yours + attendees)',
  provider: 'calendar',
  requiresConfirmation: false,
  parameters: {
    start: { type: 'string', description: 'YYYY-MM-DDTHH:mm:ss or natural language', required: true },
    durationMinutes: { type: 'number', description: 'Length (default 60)', default: 60 },
    attendees: { type: 'array', description: 'Attendee emails' },
  },
  execute: (p, ctx) => calendarService.checkAvailability(ctx.userId, p),
};

const calCreate: ToolDefinition = {
  name: 'calendar_create_event',
  displayName: 'Schedule Meeting',
  description: 'Creates a Google Calendar event (warns about conflicts). Times in YYYY-MM-DDTHH:mm:ss local time',
  provider: 'calendar',
  requiresConfirmation: true,
  actionType: 'calendar_create',
  parameters: {
    summary: { type: 'string', description: 'Event title', required: true },
    start: { type: 'string', description: 'Start time', required: true },
    end: { type: 'string', description: 'End time (optional)' },
    durationMinutes: { type: 'number', description: 'Used when end is missing', default: 60 },
    attendees: { type: 'array', description: 'Attendee emails' },
    description: { type: 'string', description: 'Agenda / notes' },
    addMeetLink: { type: 'boolean', description: 'Add a Google Meet link', default: true },
  },
  execute: (p, ctx) => calendarService.createEvent(ctx.userId, p),
};

const calReminder: ToolDefinition = {
  name: 'calendar_create_reminder',
  displayName: 'Create Reminder',
  description: 'Adds a 15-minute reminder event on a due date',
  provider: 'calendar',
  requiresConfirmation: true,
  actionType: 'calendar_create',
  parameters: { title: { type: 'string', description: 'Reminder title', required: true }, dueDate: { type: 'string', description: 'YYYY-MM-DD or date-time', required: true }, description: { type: 'string', description: 'Details' } },
  execute: (p, ctx) => calendarService.createReminder(ctx.userId, p),
};

export const googleTools = [driveSearch, driveSummarize, driveUpload, driveSaveAttachment, driveFolder, driveMove, calList, calAvailability, calCreate, calReminder];
