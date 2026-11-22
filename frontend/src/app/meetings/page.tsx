'use client';

import React, { useEffect, useState } from 'react';
import { CalendarClock, Plus, Sparkles, CheckCircle2, Circle, FileText, CheckSquare, Bell, MessageSquare, Trash2, ExternalLink, RefreshCw } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { api } from '../../lib/api';
import { Meeting } from '../../types';

const SAMPLE = `Priya: Sprint goal is shipping the Slack digest and fixing webhook 401s.
Rahul: I will finish the OAuth token refresh fix by Friday.
Ankit: I will share the dashboard Figma by Wednesday.
Priya: We decided to postpone the Notion knowledge base to next sprint.
Sneha: QA needs a staging build before Thursday.`;

export default function MeetingsPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ title: '', scheduledAt: '', attendees: '', context: '', addToCalendar: true });
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [syncOpts, setSyncOpts] = useState({ notion: true, reminders: true, jira: true, slack: false });
  const [syncResult, setSyncResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (keepId?: string) => {
    const r = await api.getMeetings();
    setMeetings(r.meetings || []);
    const id = keepId || selected?._id;
    setSelected((r.meetings || []).find((m: Meeting) => m._id === id) || r.meetings?.[0] || null);
  };

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    setNotes(selected?.transcript || '');
    setSyncResult(null);
  }, [selected?._id]);

  const wrap = async (key: string, fn: () => Promise<any>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  };

  const create = () =>
    wrap('create', async () => {
      const r = await api.createMeeting({
        title: form.title,
        scheduledAt: form.scheduledAt || undefined,
        attendees: form.attendees.split(',').map((s) => s.trim()).filter(Boolean),
        context: form.context,
        addToCalendar: form.addToCalendar && Boolean(form.scheduledAt),
      });
      setCreateOpen(false);
      setForm({ title: '', scheduledAt: '', attendees: '', context: '', addToCalendar: true });
      await load(r.meeting._id);
    });

  const input = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">AI Meeting Assistant</h1>
          <p className="text-xs text-slate-400 mt-1">Agenda → notes → summary, decisions and action items → Notion, Calendar reminders, Jira and Slack.</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="w-3.5 h-3.5" /> New meeting</Button>
      </div>

      {error && <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-200 text-xs flex justify-between">{error}<button onClick={() => setError(null)}>×</button></div>}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        <div className="space-y-2">
          {meetings.map((m) => (
            <Card key={m._id} onClick={() => setSelected(m)} className={`p-3 ${selected?._id === m._id ? 'border-blue-500' : ''}`}>
              <div className="text-sm text-white font-semibold truncate">{m.title}</div>
              <div className="text-[11px] text-slate-500 flex items-center justify-between mt-1">
                <span>{m.scheduledAt ? new Date(m.scheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'unscheduled'}</span>
                <Badge variant={m.status === 'completed' ? 'success' : 'secondary'} className="text-[9px]">{m.status}</Badge>
              </div>
            </Card>
          ))}
          {!meetings.length && <p className="text-xs text-slate-500">No meetings yet. Create one to get an AI agenda.</p>}
        </div>

        {selected ? (
          <div className="lg:col-span-3 space-y-5">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>{selected.title}</CardTitle>
                  <CardDescription>{selected.attendees.join(', ') || 'No attendees listed'}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  {selected.calendarLink && selected.calendarLink !== '#' && <a href={selected.calendarLink} target="_blank" rel="noreferrer" className="text-xs text-blue-400 inline-flex items-center gap-1">Calendar <ExternalLink className="w-3 h-3" /></a>}
                  <Button size="sm" variant="ghost" onClick={() => wrap('delete', async () => { await api.deleteMeeting(selected._id); setSelected(null); await load(); })}><Trash2 className="w-3.5 h-3.5 text-rose-400" /></Button>
                </div>
              </CardHeader>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Agenda</span>
                <Button size="sm" variant="outline" className="h-7 text-[11px]" isLoading={busy === 'agenda'} onClick={() => wrap('agenda', async () => { await api.regenerateAgenda(selected._id); await load(selected._id); })}>
                  <Sparkles className="w-3 h-3" /> Regenerate
                </Button>
              </div>
              <ul className="space-y-1 text-sm text-slate-300">{selected.agenda.map((a, i) => <li key={i}>• {a}</li>)}</ul>
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Meeting notes / transcript</CardTitle>
                  <CardDescription>Paste notes after the meeting — AI extracts summary, decisions, action items, deadlines and attendance.</CardDescription>
                </div>
                {!notes && <button className="text-[11px] text-blue-400" onClick={() => setNotes(SAMPLE)}>Use sample</button>}
              </CardHeader>
              <textarea className={`${input} h-36 font-mono text-xs`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Speaker: what was said…" />
              <div className="flex justify-end mt-2">
                <Button size="sm" isLoading={busy === 'notes'} disabled={notes.trim().length < 20} onClick={() => wrap('notes', async () => { await api.processMeetingNotes(selected._id, notes); await load(selected._id); })}>
                  <Sparkles className="w-3.5 h-3.5" /> Analyse notes
                </Button>
              </div>
            </Card>

            {selected.summary && (
              <Card>
                <CardHeader>
                  <div>
                    <CardTitle>AI summary</CardTitle>
                    {selected.isSimulated && <CardDescription>Heuristic extraction (add GEMINI_API_KEY for full AI)</CardDescription>}
                  </div>
                </CardHeader>
                <p className="text-sm text-slate-300 leading-relaxed">{selected.summary}</p>
                <div className="grid md:grid-cols-2 gap-4 mt-4 text-xs">
                  <div>
                    <div className="text-[11px] font-semibold uppercase text-slate-400 mb-1">Decisions</div>
                    <ul className="space-y-1 text-slate-300">{selected.decisions.length ? selected.decisions.map((d, i) => <li key={i}>• {d}</li>) : <li className="text-slate-500">None recorded</li>}</ul>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase text-slate-400 mb-1">Attendance & deadlines</div>
                    <p className="text-slate-300">{selected.attendance.join(', ') || '—'}</p>
                    <ul className="mt-1 text-slate-400">{selected.deadlines.map((d, i) => <li key={i}>⏰ {d}</li>)}</ul>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="text-[11px] font-semibold uppercase text-slate-400 mb-2">Action items</div>
                  <div className="space-y-1.5">
                    {selected.actionItems.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800 text-xs">
                        <button onClick={() => wrap(`ai-${i}`, async () => { await api.updateActionItem(selected._id, i, { status: a.status === 'done' ? 'open' : 'done' }); await load(selected._id); })}>
                          {a.status === 'done' ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <Circle className="w-4 h-4 text-slate-500" />}
                        </button>
                        <span className={`flex-1 ${a.status === 'done' ? 'line-through text-slate-500' : 'text-slate-200'}`}>{a.task}</span>
                        {a.owner && <Badge className="text-[9px]">{a.owner}</Badge>}
                        {a.dueDate && <Badge variant="warning" className="text-[9px]">due {a.dueDate}</Badge>}
                        {a.jiraKey && <Badge variant="secondary" className="text-[9px]">{a.jiraKey}</Badge>}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-800">
                  <div className="text-[11px] font-semibold uppercase text-slate-400 mb-2">Push results to</div>
                  <div className="flex flex-wrap gap-4 text-xs text-slate-300 mb-3">
                    {[
                      { k: 'notion', label: 'Notion page', icon: FileText },
                      { k: 'reminders', label: 'Calendar reminders (dated items)', icon: Bell },
                      { k: 'jira', label: 'Jira tasks', icon: CheckSquare },
                      { k: 'slack', label: 'Slack summary', icon: MessageSquare },
                    ].map((o) => (
                      <label key={o.k} className="flex items-center gap-1.5">
                        <input type="checkbox" checked={(syncOpts as any)[o.k]} onChange={(e) => setSyncOpts({ ...syncOpts, [o.k]: e.target.checked })} />
                        <o.icon className="w-3.5 h-3.5 text-slate-400" /> {o.label}
                      </label>
                    ))}
                  </div>
                  <Button size="sm" isLoading={busy === 'sync'} onClick={() => wrap('sync', async () => { const r = await api.syncMeeting(selected._id, syncOpts); setSyncResult(r.results); await load(selected._id); })}>
                    <RefreshCw className="w-3.5 h-3.5" /> Approve & sync
                  </Button>
                  {syncResult && <pre className="mt-3 text-[10px] text-slate-400 bg-slate-950 border border-slate-800 rounded-lg p-3 max-h-56 overflow-auto">{JSON.stringify(syncResult, null, 2)}</pre>}
                </div>
              </Card>
            )}
          </div>
        ) : (
          <Card className="lg:col-span-3 flex flex-col items-center justify-center py-16 text-center">
            <CalendarClock className="w-8 h-8 text-slate-600 mb-3" />
            <p className="text-sm text-slate-400">Create a meeting to generate an agenda, or paste notes to extract action items.</p>
          </Card>
        )}
      </div>

      <Modal isOpen={createOpen} onClose={() => setCreateOpen(false)} title="New meeting" description="AI generates a time-boxed agenda; optionally creates a Google Calendar event with Meet link." maxWidth="md">
        <div className="space-y-3 text-xs">
          <input className={input} placeholder="Title, e.g. Sprint 15 planning" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className={input} type="datetime-local" value={form.scheduledAt} onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })} />
          <input className={input} placeholder="Attendee emails, comma-separated" value={form.attendees} onChange={(e) => setForm({ ...form, attendees: e.target.value })} />
          <textarea className={`${input} h-20`} placeholder="Context for the agenda (optional)" value={form.context} onChange={(e) => setForm({ ...form, context: e.target.value })} />
          <label className="flex items-center gap-2 text-slate-300">
            <input type="checkbox" checked={form.addToCalendar} onChange={(e) => setForm({ ...form, addToCalendar: e.target.checked })} /> Add to Google Calendar (needs a date/time)
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={create} isLoading={busy === 'create'} disabled={form.title.trim().length < 2}>Create</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
