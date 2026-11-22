'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Mail, Workflow, Zap, CheckCircle2, ArrowUpRight, Bot, Layers, AlertTriangle, RefreshCw, Search, CalendarClock, BookOpen } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { api } from '../lib/api';
import { WorkflowExecution, Integration } from '../types';
import { formatDate } from '../lib/utils';
import { useAuth } from '../lib/auth';

const CATEGORY_COLORS: Record<string, string> = {
  Urgent: 'bg-rose-500',
  'Bug/Issue': 'bg-red-400',
  'Client Request': 'bg-amber-400',
  Meeting: 'bg-purple-400',
  Important: 'bg-blue-400',
  Normal: 'bg-slate-400',
  Promotional: 'bg-slate-600',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [overview, setOverview] = useState<any>(null);
  const [executions, setExecutions] = useState<WorkflowExecution[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const [a, e, i] = await Promise.allSettled([api.getAnalytics(), api.getExecutions(6), api.getIntegrations()]);
    if (a.status === 'fulfilled') setOverview(a.value.overview);
    else setError(a.reason?.message);
    if (e.status === 'fulfilled') setExecutions(e.value.executions || []);
    if (i.status === 'fulfilled') setIntegrations(i.value.integrations || []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const maxDay = Math.max(1, ...(overview?.runsLast7Days || []).map((d: any) => d.total));
  const categories = Object.entries(overview?.emailsByCategory || {}) as Array<[string, number]>;
  const totalCat = categories.reduce((a, [, v]) => a + v, 0) || 1;

  const kpis = [
    { label: 'Emails analysed', value: overview?.emailsAnalyzed ?? '—', icon: Mail, hint: `${overview?.emailsByPriority?.High || 0} high priority` },
    { label: 'Workflow runs', value: overview?.workflowRuns ?? '—', icon: Workflow, hint: overview?.workflowSuccessRate != null ? `${overview.workflowSuccessRate}% success` : 'no runs yet' },
    { label: 'Automated actions', value: overview?.automatedWriteActions ?? '—', icon: Zap, hint: 'tickets, messages, events…' },
    { label: 'Integrations', value: overview ? `${overview.integrationsConnected}/${overview.integrationsTotal}` : '—', icon: Layers, hint: 'connected' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Welcome back, {user?.name?.split(' ')[0]}</h1>
          <p className="text-xs text-slate-400 mt-1">Live metrics computed from your workflow runs, analysed emails and audit trail.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} isLoading={loading}>
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </Button>
          <Link href="/assistant">
            <Button size="sm">
              <Bot className="w-3.5 h-3.5" /> Ask the assistant
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-900 text-rose-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {overview && !overview.ai?.live && (
        <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-900/60 text-amber-200 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          AI is running in heuristic fallback mode. Add <code className="text-white">GEMINI_API_KEY</code> to <code className="text-white">.env</code> and restart the backend for real Gemini analysis.
          {overview.ai?.lastError && <span className="text-amber-400/80"> Last error: {overview.ai.lastError.slice(0, 120)}</span>}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <Card key={k.label}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">{k.label}</span>
              <k.icon className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-2xl font-bold text-white">{k.value}</div>
            <div className="text-[11px] text-slate-500 mt-1">{k.hint}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Workflow runs — last 7 days</CardTitle>
              <CardDescription>Average run time {overview?.avgRunMs ? `${overview.avgRunMs} ms` : '—'}</CardDescription>
            </div>
          </CardHeader>
          <div className="flex items-end gap-3 h-40 pt-2">
            {(overview?.runsLast7Days || []).map((d: any) => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-1.5">
                <span className="text-[10px] text-slate-400">{d.total || ''}</span>
                <div className="w-full flex flex-col justify-end rounded-md overflow-hidden bg-slate-950 border border-slate-800" style={{ height: '110px' }}>
                  <div className="bg-blue-500/80" style={{ height: `${((d.total - d.failed) / maxDay) * 100}%` }} />
                  <div className="bg-rose-500/80" style={{ height: `${(d.failed / maxDay) * 100}%` }} />
                </div>
                <span className="text-[10px] text-slate-500">{new Date(d.date).toLocaleDateString('en-IN', { weekday: 'short' })}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-3 text-[10px] text-slate-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500" /> completed</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-rose-500" /> failed</span>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Inbox by category</CardTitle>
              <CardDescription>From AI email analysis</CardDescription>
            </div>
          </CardHeader>
          {categories.length ? (
            <div className="space-y-2.5">
              {categories.sort((a, b) => b[1] - a[1]).map(([cat, n]) => (
                <div key={cat}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-300">{cat}</span>
                    <span className="text-slate-400">{n}</span>
                  </div>
                  <div className="h-1.5 bg-slate-950 rounded-full overflow-hidden">
                    <div className={`h-full ${CATEGORY_COLORS[cat] || 'bg-slate-400'}`} style={{ width: `${(n / totalCat) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              No analysed emails yet. Open <Link href="/emails" className="text-blue-400">Emails</Link> and click “Analyse inbox”.
            </p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent executions</CardTitle>
            <Link href="/executions" className="text-xs text-blue-400 hover:text-blue-300 inline-flex items-center gap-1">
              All logs <ArrowUpRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          {executions.length ? (
            <div className="divide-y divide-slate-800/70">
              {executions.map((ex) => (
                <div key={ex._id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-slate-200 truncate">{ex.workflowTitle}</div>
                    <div className="text-[11px] text-slate-500 truncate">{ex.summary}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={ex.status === 'completed' ? 'success' : ex.status === 'failed' ? 'urgent' : 'default'}>{ex.status}</Badge>
                    <span className="text-[11px] text-slate-500 w-16 text-right">{formatDate(ex.startTime)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">
              No runs yet — try a template on the <Link href="/workflows" className="text-blue-400">Workflows</Link> page.
            </p>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Integrations</CardTitle>
            <Link href="/integrations" className="text-xs text-blue-400">Manage</Link>
          </CardHeader>
          <div className="space-y-2">
            {integrations.map((i) => (
              <div key={i.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{i.name}</span>
                {i.status === 'connected' ? (
                  <Badge variant="success"><CheckCircle2 className="w-3 h-3 mr-1" />{i.connectionSource === 'env' ? '.env' : 'connected'}</Badge>
                ) : (
                  <Badge>{i.connectionSource === 'demo' ? 'demo data' : 'not connected'}</Badge>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { href: '/search', icon: Search, title: 'Smart Search', text: `Search Gmail, Drive, Jira, GitHub and Notion at once. ${overview?.knowledgeDocuments ?? 0} documents indexed for RAG.` },
          { href: '/meetings', icon: CalendarClock, title: 'Meeting Assistant', text: `Agendas, notes → action items → Jira & reminders. ${overview?.meetings ?? 0} meetings so far.` },
          { href: '/workflows', icon: BookOpen, title: 'Workflow Templates', text: `${overview?.activeWorkflows ?? 0} active workflows including the three spec pipelines.` },
        ].map((c) => (
          <Link key={c.href} href={c.href}>
            <Card onClick={() => undefined} className="h-full">
              <c.icon className="w-5 h-5 text-blue-400 mb-2" />
              <div className="text-sm font-semibold text-white">{c.title}</div>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{c.text}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
