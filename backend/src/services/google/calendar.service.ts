import { google, calendar_v3 } from 'googleapis';
import { googleAuthService } from './google-auth.service';
import { env } from '../../config/env.config';
import { NotConnectedError, IntegrationError } from '../integrations/http';
import { demoCalendarEvents } from '../integrations/demo';
import { addMinutesLocal, isoToLocal, localToRFC3339, parseNaturalDateTime } from '../../utils/date-parse';

function mapEvent(e: calendar_v3.Schema$Event) {
  return {
    id: e.id,
    summary: e.summary,
    description: e.description,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    attendees: (e.attendees || []).map((a) => a.email),
    htmlLink: e.htmlLink,
    meetLink: e.hangoutLink,
  };
}

/** Accepts ISO strings, local "YYYY-MM-DDTHH:mm[:ss]" or natural language ("tomorrow at 2 PM"). */
export function normalizeTime(input: string | undefined, fallbackNatural?: string): string {
  if (!input && fallbackNatural) input = fallbackNatural;
  if (!input) throw new IntegrationError('calendar', 'A start time is required', 400);
  input = input.trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) return `${input}:00`;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(input)) return input;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?([zZ]|[+-]\d{2}:?\d{2})$/.test(input)) return isoToLocal(input);
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return `${input}T10:00:00`;
  const parsed = parseNaturalDateTime(input);
  if (!parsed) throw new IntegrationError('calendar', `Could not understand time "${input}"`, 400);
  return parsed.local;
}

class CalendarService {
  private async cal(userId: string) {
    const auth = await googleAuthService.getClient(userId, 'calendar');
    if (!auth) {
      if (!env.DEMO_MODE) throw new NotConnectedError('calendar');
      return null;
    }
    return google.calendar({ version: 'v3', auth });
  }

  public async listEvents(userId: string, p: { days?: number; query?: string; timeMin?: string; timeMax?: string } = {}) {
    const cal = await this.cal(userId);
    if (!cal) return { events: demoCalendarEvents(), simulated: true };
    const timeMin = p.timeMin ? localToRFC3339(normalizeTime(p.timeMin)) : new Date().toISOString();
    const timeMax = p.timeMax ? localToRFC3339(normalizeTime(p.timeMax)) : new Date(Date.now() + (p.days || 7) * 86400000).toISOString();
    const r = await cal.events.list({ calendarId: 'primary', timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 50, q: p.query });
    return { events: (r.data.items || []).map(mapEvent) };
  }

  /** Free/busy check + conflict detection for a proposed slot. */
  public async checkAvailability(userId: string, p: { start: string; end?: string; durationMinutes?: number; attendees?: string[] }) {
    const startLocal = normalizeTime(p.start);
    const endLocal = p.end ? normalizeTime(p.end) : addMinutesLocal(startLocal, p.durationMinutes || 60);
    const startISO = localToRFC3339(startLocal);
    const endISO = localToRFC3339(endLocal);
    const cal = await this.cal(userId);
    if (!cal) {
      const s = new Date(startISO).getTime();
      const e = new Date(endISO).getTime();
      const conflicts = demoCalendarEvents().filter((ev) => new Date(ev.start).getTime() < e && new Date(ev.end).getTime() > s);
      return { start: startLocal, end: endLocal, available: conflicts.length === 0, conflicts, simulated: true };
    }
    const items = [{ id: 'primary' }, ...(p.attendees || []).map((id) => ({ id }))];
    const fb = await cal.freebusy.query({ requestBody: { timeMin: startISO, timeMax: endISO, timeZone: env.APP_TIMEZONE, items } });
    const busy = Object.entries(fb.data.calendars || {}).flatMap(([id, v]) => (v.busy || []).map((b) => ({ calendar: id, start: b.start, end: b.end })));
    const events = await cal.events.list({ calendarId: 'primary', timeMin: startISO, timeMax: endISO, singleEvents: true });
    return { start: startLocal, end: endLocal, available: busy.length === 0, busy, conflicts: (events.data.items || []).map(mapEvent) };
  }

  public async createEvent(userId: string, p: { summary: string; start: string; end?: string; durationMinutes?: number; attendees?: string[]; description?: string; location?: string; addMeetLink?: boolean; reminderMinutes?: number }) {
    const startLocal = normalizeTime(p.start);
    const endLocal = p.end ? normalizeTime(p.end) : addMinutesLocal(startLocal, p.durationMinutes || 60);
    const availability = await this.checkAvailability(userId, { start: startLocal, end: endLocal }).catch(() => null);
    const conflicts = availability?.conflicts || [];

    const cal = await this.cal(userId);
    if (!cal) {
      return {
        status: 'created',
        event: { id: `cal-demo-${Date.now()}`, summary: p.summary, start: startLocal, end: endLocal, attendees: p.attendees || [], htmlLink: '#' },
        conflicts,
        message: `Simulated calendar event "${p.summary}" on ${startLocal.replace('T', ' ').slice(0, 16)}${conflicts.length ? ` (⚠ conflicts with ${conflicts.length} event(s))` : ''}`,
        simulated: true,
      };
    }
    const attendees = (p.attendees || []).filter((a) => /@/.test(a)).map((email) => ({ email }));
    const r = await cal.events.insert({
      calendarId: 'primary',
      sendUpdates: attendees.length ? 'all' : 'none',
      conferenceDataVersion: p.addMeetLink ? 1 : 0,
      requestBody: {
        summary: p.summary,
        description: p.description,
        location: p.location,
        start: { dateTime: startLocal, timeZone: env.APP_TIMEZONE },
        end: { dateTime: endLocal, timeZone: env.APP_TIMEZONE },
        attendees,
        reminders: { useDefault: p.reminderMinutes === undefined, overrides: p.reminderMinutes !== undefined ? [{ method: 'popup', minutes: p.reminderMinutes }] : undefined },
        conferenceData: p.addMeetLink ? { createRequest: { requestId: `af-${Date.now()}` } } : undefined,
      },
    });
    return {
      status: 'created',
      event: mapEvent(r.data),
      conflicts,
      message: `Created "${p.summary}" on ${startLocal.replace('T', ' ').slice(0, 16)}${conflicts.length ? ` — note: overlaps ${conflicts.length} existing event(s)` : ''}`,
    };
  }

  /** Creates a short reminder event (used for meeting action-item deadlines). */
  public async createReminder(userId: string, p: { title: string; dueDate: string; description?: string }) {
    const due = /^\d{4}-\d{2}-\d{2}$/.test(p.dueDate) ? `${p.dueDate}T10:00:00` : normalizeTime(p.dueDate);
    return this.createEvent(userId, { summary: `⏰ ${p.title}`, start: due, durationMinutes: 15, description: p.description, reminderMinutes: 30 });
  }
}

export const calendarService = new CalendarService();
