import { Request, Response } from 'express';
import { z } from 'zod';
import { MeetingModel } from '../models/meeting.model';
import { aiService } from '../services/ai/ai.service';
import { toolRegistry } from '../tools/tool-registry';
import { normalizeTime } from '../services/google/calendar.service';
import { localToRFC3339 } from '../utils/date-parse';

const CreateSchema = z.object({
  title: z.string().trim().min(2),
  scheduledAt: z.string().optional(),
  durationMinutes: z.number().int().min(5).max(480).default(30),
  attendees: z.array(z.string()).default([]),
  context: z.string().optional(),
  generateAgenda: z.boolean().default(true),
  addToCalendar: z.boolean().default(false),
});

const notFound = (res: Response) => res.status(404).json({ success: false, error: { message: 'Meeting not found', statusCode: 404 } });

export class MeetingsController {
  static async list(req: Request, res: Response) {
    res.json({ success: true, meetings: await MeetingModel.find({ userId: req.user!.id }).sort({ createdAt: -1 }).limit(50) });
  }

  static async get(req: Request, res: Response) {
    const m = await MeetingModel.findOne({ _id: req.params.id, userId: req.user!.id });
    return m ? res.json({ success: true, meeting: m }) : notFound(res);
  }

  /** Create a meeting, optionally with an AI agenda and a Google Calendar event. */
  static async create(req: Request, res: Response) {
    const userId = req.user!.id;
    const data = CreateSchema.parse(req.body);
    const local = data.scheduledAt ? normalizeTime(data.scheduledAt) : undefined;
    const agenda = data.generateAgenda ? await aiService.generateAgenda(data.title, data.attendees, data.context || '') : { agenda: [], isSimulated: false };
    const meeting = await MeetingModel.create({
      userId,
      title: data.title,
      scheduledAt: local ? new Date(localToRFC3339(local)) : undefined,
      durationMinutes: data.durationMinutes,
      attendees: data.attendees,
      agenda: agenda.agenda,
      isSimulated: agenda.isSimulated,
    });
    let calendar: any = null;
    if (data.addToCalendar && local) {
      calendar = await toolRegistry.execute('calendar_create_event', { summary: data.title, start: local, durationMinutes: data.durationMinutes, attendees: data.attendees, description: `Agenda:\n${agenda.agenda.map((a) => `• ${a}`).join('\n')}`, addMeetLink: true }, { userId, confirmed: true, source: 'api' });
      meeting.calendarEventId = calendar?.event?.id;
      meeting.calendarLink = calendar?.event?.htmlLink;
      await meeting.save();
    }
    res.status(201).json({ success: true, meeting, calendar });
  }

  static async regenerateAgenda(req: Request, res: Response) {
    const m = await MeetingModel.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!m) return notFound(res);
    const r = await aiService.generateAgenda(m.title, m.attendees, req.body.context || '');
    m.agenda = r.agenda;
    await m.save();
    res.json({ success: true, meeting: m });
  }

  /** Paste notes/transcript → AI summary, decisions, action items, deadlines, attendance. */
  static async processNotes(req: Request, res: Response) {
    const m = await MeetingModel.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!m) return notFound(res);
    const transcript = String(req.body.transcript || '').trim();
    if (transcript.length < 20) return res.status(400).json({ success: false, error: { message: 'Paste the meeting notes or transcript (min 20 characters)', statusCode: 400 } });
    const a = await aiService.analyzeMeeting(m.title, m.attendees, transcript);
    m.transcript = transcript;
    m.summary = a.summary;
    m.decisions = a.decisions;
    m.actionItems = a.actionItems.map((x) => ({ ...x, status: 'open' as const }));
    m.deadlines = a.deadlines;
    m.attendance = a.attendance;
    m.status = 'completed';
    m.isSimulated = Boolean(a.isSimulated);
    await m.save();
    res.json({ success: true, meeting: m });
  }

  /** Push results to other tools: Notion page, calendar reminders, Jira tasks, Slack summary. */
  static async sync(req: Request, res: Response) {
    const userId = req.user!.id;
    const m = await MeetingModel.findOne({ _id: req.params.id, userId });
    if (!m) return notFound(res);
    if (!m.summary) return res.status(400).json({ success: false, error: { message: 'Process the meeting notes first', statusCode: 400 } });
    const { notion, reminders, jira, slack, slackChannel } = req.body as Record<string, any>;
    const ctx = { userId, confirmed: true, source: 'api' as const };
    const out: Record<string, any> = {};
    const markdown = [
      `## Summary`, m.summary,
      `## Decisions`, ...(m.decisions.length ? m.decisions.map((d) => `- ${d}`) : ['- none']),
      `## Action items`, ...m.actionItems.map((a) => `- [ ] ${a.task}${a.owner ? ` — ${a.owner}` : ''}${a.dueDate ? ` (due ${a.dueDate})` : ''}`),
      `## Attendance`, `- ${m.attendance.join(', ') || 'n/a'}`,
    ].join('\n');

    if (notion) {
      out.notion = await toolRegistry.execute('notion_create_page', { title: `Meeting notes — ${m.title}`, content: markdown }, ctx).catch((e) => ({ error: e.message }));
      if (out.notion?.url) m.notionPageUrl = out.notion.url;
    }
    if (reminders) {
      out.reminders = [];
      for (const a of m.actionItems.filter((x) => x.dueDate).slice(0, 10)) {
        out.reminders.push(await toolRegistry.execute('calendar_create_reminder', { title: a.task, dueDate: a.dueDate, description: `Owner: ${a.owner || 'unassigned'} — ${m.title}` }, ctx).catch((e) => ({ error: e.message })));
      }
    }
    if (jira) {
      out.jira = [];
      for (const a of m.actionItems.filter((x) => !x.jiraKey).slice(0, 10)) {
        const r = await toolRegistry.execute('jira_create_issue', { summary: a.task, description: `From meeting "${m.title}"\nOwner: ${a.owner || 'unassigned'}\nDue: ${a.dueDate || 'n/a'}`, issueType: 'Task', assignee: a.owner, priority: 'Medium' }, ctx).catch((e) => ({ error: e.message }));
        if (r?.key) a.jiraKey = r.key;
        out.jira.push(r);
      }
    }
    if (slack) {
      out.slack = await toolRegistry.execute('slack_send_message', { channel: slackChannel, message: `:memo: *${m.title}*\n${m.summary}\n${m.actionItems.length} action item(s)${m.notionPageUrl ? `\nNotes: ${m.notionPageUrl}` : ''}` }, ctx).catch((e) => ({ error: e.message }));
    }
    m.markModified('actionItems');
    await m.save();
    res.json({ success: true, meeting: m, results: out });
  }

  static async updateActionItem(req: Request, res: Response) {
    const m = await MeetingModel.findOne({ _id: req.params.id, userId: req.user!.id });
    if (!m) return notFound(res);
    const idx = Number(req.params.index);
    if (!m.actionItems[idx]) return res.status(404).json({ success: false, error: { message: 'Action item not found', statusCode: 404 } });
    Object.assign(m.actionItems[idx], req.body);
    m.markModified('actionItems');
    await m.save();
    res.json({ success: true, meeting: m });
  }

  static async remove(req: Request, res: Response) {
    await MeetingModel.deleteOne({ _id: req.params.id, userId: req.user!.id });
    res.json({ success: true });
  }
}
