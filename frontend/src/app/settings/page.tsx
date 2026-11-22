'use client';

import React, { useEffect, useState } from 'react';
import { Server, KeyRound, ScrollText, Users, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { User } from '../../types';
import { formatDate } from '../../lib/utils';

const Flag = ({ ok, label }: { ok: boolean; label: string }) => (
  <div className="flex items-center justify-between text-xs py-1.5 border-b border-slate-800/60 last:border-0">
    <span className="text-slate-300">{label}</span>
    {ok ? <CheckCircle2 className="w-4 h-4 text-emerald-400" /> : <XCircle className="w-4 h-4 text-slate-600" />}
  </div>
);

export default function SettingsPage() {
  const { user } = useAuth();
  const [health, setHealth] = useState<any>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [allLogs, setAllLogs] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const isAdmin = user?.role === 'admin';

  const loadLogs = (all = allLogs) => api.getAuditLogs(all).then((r) => setLogs(r.logs || [])).catch(() => null);

  useEffect(() => {
    api.getHealth().then(setHealth).catch(() => null);
    loadLogs();
    if (isAdmin) api.getUsers().then((r) => setUsers(r.users || [])).catch(() => null);
  }, [isAdmin]);

  const changePw = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.changePassword(pw.current, pw.next);
      setMsg({ ok: true, text: 'Password updated.' });
      setPw({ current: '', next: '' });
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    }
  };

  const updateUser = async (id: string, data: any) => {
    try {
      await api.updateUser(id, data);
      setUsers((await api.getUsers()).users);
    } catch (err: any) {
      setMsg({ ok: false, text: err.message });
    }
  };

  const input = 'w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-blue-500';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings & Administration</h1>
        <p className="text-xs text-slate-400 mt-1">System status, account security, audit trail and role-based access control.</p>
      </div>

      {msg && <div className={`p-3 rounded-lg text-xs ${msg.ok ? 'bg-emerald-950/40 border border-emerald-900 text-emerald-200' : 'bg-rose-950/40 border border-rose-900 text-rose-200'}`}>{msg.text}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card>
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2"><Server className="w-4 h-4 text-blue-400" /> System status</CardTitle>
              <CardDescription>v{health?.version} · {health?.timezone}</CardDescription>
            </div>
          </CardHeader>
          {health ? (
            <>
              <Flag ok={health.database === 'connected'} label="MongoDB" />
              <Flag ok={health.ai?.live} label={`Gemini AI ${health.ai?.model ? `(${health.ai.model})` : ''}`} />
              <Flag ok={health.integrations?.googleOAuth} label="Google OAuth client" />
              <Flag ok={health.integrations?.slackEnv} label="Slack token in .env" />
              <Flag ok={health.integrations?.jiraEnv} label="Jira token in .env" />
              <Flag ok={health.integrations?.githubEnv} label="GitHub token in .env" />
              <Flag ok={health.integrations?.notionEnv} label="Notion key in .env" />
              <div className="mt-3 text-[11px] text-slate-400">Demo mode: <strong className="text-slate-200">{String(health.demoMode)}</strong> — unconnected tools return simulated data.</div>
              {health.ai?.lastError && <div className="mt-2 text-[11px] text-rose-300">AI error: {health.ai.lastError}</div>}
            </>
          ) : (
            <p className="text-xs text-slate-500">Loading…</p>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><KeyRound className="w-4 h-4 text-blue-400" /> Change password</CardTitle>
          </CardHeader>
          <form onSubmit={changePw} className="space-y-3">
            <input className={input} type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required />
            <input className={input} type="password" placeholder="New password (min 8)" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required />
            <Button type="submit" size="sm">Update password</Button>
          </form>
          <div className="mt-4 text-[11px] text-slate-500 leading-relaxed">
            Signed in as <strong className="text-slate-300">{user?.email}</strong> with role <Badge className="text-[9px]">{user?.role}</Badge>. Sessions use signed JWTs; third-party tokens are AES-256-GCM encrypted at rest.
          </div>
        </Card>

        {isAdmin && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users className="w-4 h-4 text-blue-400" /> Users (RBAC)</CardTitle>
            </CardHeader>
            <div className="space-y-2">
              {users.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <div className="text-slate-200 truncate">{u.name}</div>
                    <div className="text-[10px] text-slate-500 truncate">{u.email}</div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <select value={u.role} disabled={u.id === user?.id} onChange={(e) => updateUser(u.id, { role: e.target.value })} className="bg-slate-950 border border-slate-800 rounded px-1.5 py-1 text-[11px]">
                      {['user', 'manager', 'admin'].map((r) => <option key={r}>{r}</option>)}
                    </select>
                    <button disabled={u.id === user?.id} onClick={() => updateUser(u.id, { isActive: !u.isActive })} className={`text-[10px] px-1.5 py-1 rounded border ${u.isActive !== false ? 'border-emerald-900 text-emerald-300' : 'border-rose-900 text-rose-300'}`}>
                      {u.isActive !== false ? 'active' : 'disabled'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2"><ScrollText className="w-4 h-4 text-blue-400" /> Audit log</CardTitle>
            <CardDescription>Every sign-in, integration change, tool call and workflow run (secrets redacted).</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <label className="text-[11px] text-slate-400 flex items-center gap-1.5">
                <input type="checkbox" checked={allLogs} onChange={(e) => { setAllLogs(e.target.checked); loadLogs(e.target.checked); }} /> all users
              </label>
            )}
            <Button size="sm" variant="outline" onClick={() => loadLogs()}><RefreshCw className="w-3 h-3" /></Button>
          </div>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-800">
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Action</th>
                <th className="py-2 pr-3 font-medium">Resource</th>
                <th className="py-2 pr-3 font-medium">Provider</th>
                <th className="py-2 pr-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l._id} className="border-b border-slate-800/50 text-slate-300">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-slate-500">{formatDate(l.createdAt)}</td>
                  <td className="py-1.5 pr-3 font-mono">{l.action}</td>
                  <td className="py-1.5 pr-3 truncate max-w-[220px]">{l.resource || l.userEmail || '—'}</td>
                  <td className="py-1.5 pr-3">{l.provider || '—'}</td>
                  <td className="py-1.5 pr-3">
                    <Badge variant={l.status === 'success' ? 'success' : l.status === 'failure' ? 'urgent' : l.status === 'simulated' ? 'warning' : 'default'} className="text-[9px]">{l.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!logs.length && <p className="text-xs text-slate-500 py-3">No audit entries yet.</p>}
        </div>
      </Card>
    </div>
  );
}
