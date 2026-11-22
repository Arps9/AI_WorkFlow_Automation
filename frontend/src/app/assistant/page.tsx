'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Send, Bot, ShieldCheck, Check, X, RefreshCw, Plus, Trash2, Wrench, AlertTriangle, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { api } from '../../lib/api';
import { ChatMessage } from '../../types';
import { formatDate } from '../../lib/utils';

type ToolCall = NonNullable<ChatMessage['toolCalls']>[number];

const PRESETS = [
  "Summarize today's emails and create Jira tasks for bugs",
  "Schedule tomorrow's sprint planning at 11 AM and notify everyone on Slack",
  'Show pending Jira tasks',
  'Find documents related to Project Alpha',
  'Summarize #engineering on Slack',
  'Show open pull requests',
];

const WELCOME: ChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Hi! I can work across Gmail, Slack, Jira, GitHub, Google Drive, Calendar and Notion. I run read-only lookups immediately and ask for your approval before I send, create, post or schedule anything.',
  timestamp: new Date(),
};

const newSessionId = () => `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function EmailList({ emails }: { emails: any[] }) {
  return (
    <div className="space-y-1.5">
      {emails.slice(0, 8).map((e) => (
        <div key={e.messageId} className="flex items-start gap-2 p-2 rounded-lg bg-slate-950/70 border border-slate-800">
          <Badge variant={e.priority === 'High' ? 'urgent' : e.priority === 'Low' ? 'default' : 'warning'} className="text-[9px] shrink-0">{e.priority || '—'}</Badge>
          <div className="min-w-0">
            <div className="text-xs text-slate-200 truncate">{e.subject}</div>
            <div className="text-[10px] text-slate-500 truncate">{e.senderName || e.sender} · {e.category}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolResult({ call }: { call: ToolCall }) {
  const [open, setOpen] = useState(false);
  const r = call.result;
  const isEmails = Array.isArray(r) && r[0]?.subject !== undefined;
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-3 py-2 text-[11px]">
        <span className="flex items-center gap-1.5 text-slate-300">
          <Wrench className="w-3 h-3 text-blue-400" />
          <code>{call.toolName}</code>
          {call.status === 'failed' && <Badge variant="urgent" className="text-[9px]">failed</Badge>}
          {r?.simulated && <Badge variant="warning" className="text-[9px]">simulated</Badge>}
          {call.status === 'rejected' && <Badge className="text-[9px]">rejected</Badge>}
        </span>
        {open ? <ChevronDown className="w-3 h-3 text-slate-500" /> : <ChevronRight className="w-3 h-3 text-slate-500" />}
      </button>
      {isEmails && !open && <div className="px-3 pb-3"><EmailList emails={r} /></div>}
      {open && <pre className="px-3 pb-3 text-[10px] text-slate-400 overflow-x-auto max-h-64">{JSON.stringify(r ?? call.parameters, null, 2)}</pre>}
    </div>
  );
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string>(newSessionId);
  const [sessions, setSessions] = useState<any[]>([]);
  const [busyCall, setBusyCall] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const loadSessions = () => api.getAssistantSessions().then((r) => setSessions(r.sessions || [])).catch(() => null);
  useEffect(() => {
    loadSessions();
  }, []);
  useEffect(() => {
    // Block body on purpose: newer browsers return a Promise from scrollIntoView(), and an
    // expression-bodied arrow would hand that Promise to React as the effect's "cleanup".
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const openSession = async (id: string) => {
    const r = await api.getAssistantHistory(id);
    setSessionId(id);
    setMessages([WELCOME, ...(r.conversation?.messages || [])]);
  };

  const newChat = () => {
    setSessionId(newSessionId());
    setMessages([WELCOME]);
  };

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setMessages((m) => [...m, { id: `u-${Date.now()}`, role: 'user', content: msg, timestamp: new Date() }]);
    setInput('');
    setLoading(true);
    try {
      const r = await api.sendAssistantChat({ message: msg, sessionId });
      setMessages((m) => [...m, r.message]);
      loadSessions();
    } catch (err: any) {
      setMessages((m) => [...m, { id: `e-${Date.now()}`, role: 'assistant', content: `⚠️ ${err.message}`, timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  };

  const updateCall = (callId: string, patch: Partial<ToolCall>) =>
    setMessages((ms) => ms.map((m) => ({ ...m, toolCalls: m.toolCalls?.map((c) => (c.id === callId ? { ...c, ...patch } : c)) })));

  const confirm = async (call: ToolCall) => {
    if (!call.id) return;
    setBusyCall(call.id);
    try {
      const r = await api.confirmAssistantAction({ sessionId, toolCallId: call.id });
      updateCall(call.id, { status: 'executed', result: r.result });
      setMessages((m) => [...m, { id: `c-${Date.now()}`, role: 'assistant', content: r.message, timestamp: new Date() }]);
    } catch (err: any) {
      updateCall(call.id, { status: 'failed', result: { error: err.message } });
      setMessages((m) => [...m, { id: `c-${Date.now()}`, role: 'assistant', content: `⚠️ ${err.message}`, timestamp: new Date() }]);
    } finally {
      setBusyCall(null);
    }
  };

  const reject = async (call: ToolCall) => {
    if (!call.id) return;
    await api.rejectAssistantAction({ sessionId, toolCallId: call.id }).catch(() => null);
    updateCall(call.id, { status: 'rejected' });
  };

  const approveAll = async (calls: ToolCall[]) => {
    for (const c of calls) await confirm(c);
  };

  return (
    <div className="h-[calc(100vh-8.5rem)] flex gap-5">
      {/* Sessions */}
      <aside className="hidden xl:flex w-60 flex-col shrink-0 border border-slate-800 rounded-xl bg-slate-900/50">
        <div className="p-3 border-b border-slate-800">
          <Button size="sm" className="w-full" onClick={newChat}>
            <Plus className="w-3.5 h-3.5" /> New chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sessions.map((s) => (
            <div key={s.sessionId} className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs cursor-pointer ${s.sessionId === sessionId ? 'bg-blue-600/15 text-blue-300' : 'text-slate-400 hover:bg-slate-800/60'}`} onClick={() => openSession(s.sessionId)}>
              <MessageSquare className="w-3 h-3 shrink-0" />
              <span className="truncate flex-1">{s.title}</span>
              <button
                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400"
                onClick={async (e) => {
                  e.stopPropagation();
                  await api.deleteAssistantSession(s.sessionId);
                  if (s.sessionId === sessionId) newChat();
                  loadSessions();
                }}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
          {!sessions.length && <p className="text-[11px] text-slate-500 p-2">Conversations are saved here.</p>}
        </div>
      </aside>

      {/* Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <div>
            <h1 className="text-xl font-bold text-white">AI Workflow Assistant</h1>
            <p className="text-xs text-slate-400">Multi-step agent: plans → runs read tools → proposes actions for approval.</p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-900/60 px-2.5 py-1 rounded-full">
            <ShieldCheck className="w-3.5 h-3.5" /> Confirmation guard on
          </div>
        </div>

        <div className="py-3 flex gap-2 overflow-x-auto shrink-0">
          {PRESETS.map((p) => (
            <button key={p} onClick={() => send(p)} disabled={loading} className="text-xs px-3 py-1.5 rounded-full bg-slate-900 border border-slate-800 hover:border-blue-500/50 text-slate-300 hover:text-white shrink-0">
              {p}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto pr-2 space-y-4 py-2">
          {messages.map((m) => {
            const user = m.role === 'user';
            const pending = (m.toolCalls || []).filter((c) => c.status === 'pending_confirmation');
            const done = (m.toolCalls || []).filter((c) => c.status !== 'pending_confirmation');
            return (
              <div key={m.id} className={`flex gap-3 ${user ? 'justify-end' : 'justify-start'}`}>
                {!user && (
                  <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400 shrink-0">
                    <Bot className="w-4 h-4" />
                  </div>
                )}
                <div className={`max-w-2xl rounded-xl p-4 text-sm leading-relaxed ${user ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-slate-900 border border-slate-800/80 text-slate-200 rounded-tl-none'}`}>
                  <div className="whitespace-pre-line">{m.content}</div>

                  {done.length > 0 && <div className="mt-3 space-y-2">{done.map((c, i) => <ToolResult key={c.id || i} call={c} />)}</div>}

                  {pending.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Needs your approval
                        </span>
                        {pending.length > 1 && (
                          <Button size="sm" variant="secondary" className="h-6 text-[11px]" onClick={() => approveAll(pending)}>
                            Approve all
                          </Button>
                        )}
                      </div>
                      {pending.map((c) => (
                        <div key={c.id} className="p-3 rounded-lg bg-amber-950/30 border border-amber-800/50">
                          <div className="text-xs font-semibold text-amber-100">{c.confirmationDetails?.description || c.toolName}</div>
                          <div className="text-[10px] text-amber-200/70 mt-0.5 font-mono">{c.toolName}</div>
                          <pre className="text-[10px] text-slate-300 bg-slate-950/60 rounded p-2 mt-2 max-h-36 overflow-auto whitespace-pre-wrap">{JSON.stringify(c.parameters, null, 2)}</pre>
                          <div className="flex gap-2 mt-2">
                            <Button size="sm" className="h-7 text-xs" isLoading={busyCall === c.id} onClick={() => confirm(c)}>
                              <Check className="w-3 h-3" /> Approve
                            </Button>
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => reject(c)}>
                              <X className="w-3 h-3" /> Reject
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={`text-[10px] mt-2 ${user ? 'text-blue-200' : 'text-slate-500'}`}>{formatDate(m.timestamp)}</div>
                </div>
              </div>
            );
          })}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-slate-400 pl-11">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" /> Planning and calling tools…
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="pt-3 border-t border-slate-800 flex gap-2"
        >
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything — e.g. “Create a GitHub issue from today's client email”" className="flex-1 bg-slate-900 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500" />
          <Button type="submit" disabled={!input.trim() || loading}>
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}