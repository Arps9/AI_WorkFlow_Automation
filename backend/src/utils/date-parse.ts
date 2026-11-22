import { env } from '../config/env.config';

/**
 * Small natural-language date helper used when the AI model is unavailable.
 * Understands: "today/tomorrow/day after tomorrow", weekday names, "at 2 PM", "14:30", "in 2 hours".
 * Returns local wall-clock strings (YYYY-MM-DDTHH:mm:00) in APP_TIMEZONE plus an RFC3339 version.
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function nowParts(tz = env.APP_TIMEZONE) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'long',
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: WEEKDAYS.indexOf(String(parts.weekday).toLowerCase()),
  };
}

/** Returns "+05:30" style offset for a timezone at the given instant. */
export function tzOffset(tz = env.APP_TIMEZONE, at = new Date()): string {
  try {
    const name =
      new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
        .formatToParts(at)
        .find((p) => p.type === 'timeZoneName')?.value || 'GMT';
    const m = name.match(/GMT([+-]\d{2}):?(\d{2})?/);
    if (!m) return '+00:00';
    return `${m[1]}:${m[2] || '00'}`;
  } catch {
    return '+00:00';
  }
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalString(d: { year: number; month: number; day: number; hour: number; minute: number }) {
  return `${d.year}-${pad(d.month)}-${pad(d.day)}T${pad(d.hour)}:${pad(d.minute)}:00`;
}

export function localToRFC3339(local: string, tz = env.APP_TIMEZONE): string {
  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(local)) return local;
  return `${local}${tzOffset(tz)}`;
}

function addDays(base: { year: number; month: number; day: number }, days: number) {
  const dt = new Date(Date.UTC(base.year, base.month - 1, base.day + days));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

export function addMinutesLocal(local: string, minutes: number): string {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return local;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + minutes));
  return toLocalString({
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
    hour: dt.getUTCHours(),
    minute: dt.getUTCMinutes(),
  });
}

export function parseNaturalDateTime(text: string, defaultHour = 10): { local: string; rfc3339: string } | null {
  if (!text) return null;
  const t = text.toLowerCase();

  // Already ISO-like
  const iso = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([zZ]|[+-]\d{2}:\d{2})?/);
  if (iso) {
    const local = iso[0].length === 16 ? `${iso[0]}:00` : iso[0];
    return { local: local.slice(0, 19), rfc3339: localToRFC3339(local) };
  }

  const now = nowParts();
  let date: { year: number; month: number; day: number } = { year: now.year, month: now.month, day: now.day };
  let matchedDay = false;

  const inHours = t.match(/in (\d+) (hour|hours|hr|hrs)/);
  const inMinutes = t.match(/in (\d+) (minute|minutes|min|mins)/);
  if (inHours || inMinutes) {
    const base = toLocalString({ ...date, hour: now.hour, minute: now.minute });
    const local = addMinutesLocal(base, (inHours ? +inHours[1] * 60 : 0) + (inMinutes ? +inMinutes[1] : 0));
    return { local, rfc3339: localToRFC3339(local) };
  }

  if (t.includes('day after tomorrow')) {
    date = addDays(date, 2);
    matchedDay = true;
  } else if (t.includes('tomorrow')) {
    date = addDays(date, 1);
    matchedDay = true;
  } else if (t.includes('today') || t.includes('tonight')) {
    matchedDay = true;
  } else {
    const wd = WEEKDAYS.findIndex((w) => t.includes(w));
    if (wd >= 0) {
      let diff = (wd - now.weekday + 7) % 7;
      if (diff === 0 || t.includes('next ' + WEEKDAYS[wd])) diff = diff === 0 ? 7 : diff;
      date = addDays(date, diff);
      matchedDay = true;
    }
  }

  let hour = defaultHour;
  let minute = 0;
  const ampm = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/);
  const h24 = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (ampm) {
    hour = Number(ampm[1]) % 12;
    minute = ampm[2] ? Number(ampm[2]) : 0;
    if (ampm[3].startsWith('p')) hour += 12;
  } else if (h24) {
    hour = Number(h24[1]);
    minute = Number(h24[2]);
  } else if (t.includes('noon')) {
    hour = 12;
  } else if (t.includes('morning')) {
    hour = 10;
  } else if (t.includes('afternoon')) {
    hour = 15;
  } else if (t.includes('evening')) {
    hour = 18;
  } else if (!matchedDay) {
    return null;
  }

  const local = toLocalString({ ...date, hour, minute });
  return { local, rfc3339: localToRFC3339(local) };
}

/** Converts an absolute ISO instant to local wall-clock time (YYYY-MM-DDTHH:mm:ss) in APP_TIMEZONE. */
export function isoToLocal(iso: string, tz = env.APP_TIMEZONE): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${String(Number(parts.hour) % 24).padStart(2, '0')}:${parts.minute}:${parts.second}`;
}
