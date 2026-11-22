'use client';

import React, { useEffect, useState } from 'react';
import { Layers, CheckCircle2, ExternalLink, Mail, MessageSquare, CheckSquare, GitBranch, FileText, HardDrive, Calendar as CalendarIcon, RefreshCw, LogOut, KeyRound, PlugZap, AlertCircle } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { api } from '../../lib/api';
import { Integration } from '../../types';

const ICONS: Record<string, any> = { mail: Mail, 'message-square': MessageSquare, 'check-square': CheckSquare, 'git-branch': GitBranch, 'file-text': FileText, 'hard-drive': HardDrive, calendar: CalendarIcon };

export default function IntegrationsPage() {
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);
  const [banner, setBanner] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [connecting, setConnecting] = useState<Integration | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [oauthHelp, setOauthHelp] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setItems((await api.getIntegrations()).integrations || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const p = new URLSearchParams(window.location.search);
    if (p.get('success')) setBanner({ type: 'ok', text: 'Google account connected — Gmail, Drive and Calendar are now live.' });
    if (p.get('error')) setBanner({ type: 'err', text: `Google connection failed: ${p.get('error')}` });
    if (p.get('success') || p.get('error')) window.history.replaceState({}, '', '/integrations');
  }, []);

  const connectGoogle = async () => {
    const r = await api.getGoogleAuthUrl();
    if (r.configured && r.url) window.location.href = r.url;
    else setOauthHelp(true);
  };

  const submit = async () => {
    if (!connecting) return;
    setBusy(connecting.id);
    try {
      const r = await api.connectIntegration(connecting.id, form);
      setBanner({ type: 'ok', text: `${connecting.name} connected as ${r.accountName || 'your account'}.` });
      setConnecting(null);
      setForm({});
      load();
    } catch (err: any) {
      setBanner({ type: 'err', text: `${connecting.name}: ${err.message}` });
    } finally {
      setBusy(null);
    }
  };

  const test = async (i: Integration) => {
    setBusy(i.id);
    try {
      const r = await api.testIntegration(i.id);
      setBanner({ type: 'ok', text: `${i.name} OK — ${r.accountName || 'connection verified'} (${r.source === 'env' ? '.env keys' : 'your keys'})` });
    } catch (err: any) {
      setBanner({ type: 'err', text: `${i.name}: ${err.message}` });
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (i: Integration) => {
    setBusy(i.id);
    try {
      if (i.authType === 'oauth2') await api.disconnectGoogle();
      else await api.disconnectIntegration(i.id);
      load();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Integrations</h1>
          <p className="text-xs text-slate-400 mt-1">One Google sign-in powers Gmail, Drive and Calendar. Slack, Jira, GitHub and Notion use API tokens stored AES-256 encrypted.</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} isLoading={loading}>
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </Button>
      </div>

      {banner && (
        <div className={`p-3 rounded-lg text-xs flex items-center justify-between ${banner.type === 'ok' ? 'bg-emerald-950/40 border border-emerald-900 text-emerald-200' : 'bg-rose-950/40 border border-rose-900 text-rose-200'}`}>
          <span className="flex items-center gap-2">{banner.type === 'ok' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}{banner.text}</span>
          <button onClick={() => setBanner(null)} className="text-slate-400 hover:text-white">×</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((i) => {
          const Icon = ICONS[i.icon] || Layers;
          const connected = i.status === 'connected';
          return (
            <Card key={i.id} className={`flex flex-col justify-between ${connected ? 'border-blue-500/60 ring-1 ring-blue-500/20' : ''}`}>
              <div>
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${connected ? 'bg-blue-600/20 border-blue-500/40 text-blue-400' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  {connected ? (
                    <Badge variant="success"><CheckCircle2 className="w-3 h-3 mr-1" />{i.connectionSource === 'env' ? 'CONNECTED (.env)' : 'CONNECTED'}</Badge>
                  ) : i.connectionSource === 'demo' ? (
                    <Badge variant="warning">DEMO DATA</Badge>
                  ) : (
                    <Badge>NOT CONNECTED</Badge>
                  )}
                </div>
                <h3 className="text-base font-bold text-white mb-1">{i.name}</h3>
                <p className="text-xs text-slate-400 leading-relaxed mb-3">{i.description}</p>
                {(i.accountEmail || i.accountName) && (
                  <div className="mb-3 p-2 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-300">
                    <span className="text-slate-500 block text-[10px] font-semibold uppercase">Account</span>
                    {i.accountName}{i.accountEmail ? ` · ${i.accountEmail}` : ''}
                  </div>
                )}
                {i.lastError && <div className="mb-3 text-[11px] text-rose-300">Last error: {i.lastError}</div>}
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {i.capabilities.map((c) => (
                    <span key={c} className="text-[10px] px-2 py-0.5 rounded bg-slate-950 border border-slate-800 text-slate-300">{c}</span>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex items-center gap-2">
                {i.authType === 'oauth2' ? (
                  connected ? (
                    <Button variant="outline" size="sm" className="flex-1 text-rose-300" onClick={() => disconnect(i)} isLoading={busy === i.id}>
                      <LogOut className="w-3.5 h-3.5" /> Disconnect Google
                    </Button>
                  ) : (
                    <Button size="sm" className="flex-1" onClick={connectGoogle}>
                      <PlugZap className="w-3.5 h-3.5" /> Sign in with Google
                    </Button>
                  )
                ) : (
                  <>
                    <Button size="sm" variant={connected ? 'secondary' : 'primary'} className="flex-1" onClick={() => { setConnecting(i); setForm({}); }}>
                      <KeyRound className="w-3.5 h-3.5" /> {connected ? 'Update keys' : 'Connect'}
                    </Button>
                    {connected && (
                      <Button size="sm" variant="outline" onClick={() => test(i)} isLoading={busy === i.id}>Test</Button>
                    )}
                    {connected && i.connectionSource === 'user' && (
                      <Button size="sm" variant="ghost" onClick={() => disconnect(i)} title="Disconnect"><LogOut className="w-3.5 h-3.5" /></Button>
                    )}
                  </>
                )}
                {i.docsUrl && (
                  <a href={i.docsUrl} target="_blank" rel="noreferrer" className="p-2 text-slate-500 hover:text-white" title="API docs">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </Card>
          );
        })}
      </div>

      <Modal isOpen={Boolean(connecting)} onClose={() => setConnecting(null)} title={`Connect ${connecting?.name}`} description="Credentials are verified with the provider, then stored encrypted (AES-256-GCM)." maxWidth="md">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {connecting?.credentialFields?.map((f) => (
            <div key={f.key}>
              <label className="text-xs font-semibold text-slate-300">
                {f.label} {f.required && <span className="text-rose-400">*</span>}
              </label>
              <input
                type={f.type}
                required={f.required}
                placeholder={f.placeholder}
                value={form[f.key] || ''}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                className="mt-1 w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:border-blue-500"
                autoComplete="off"
              />
              {f.help && <p className="text-[10px] text-slate-500 mt-1">{f.help}</p>}
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setConnecting(null)}>Cancel</Button>
            <Button type="submit" size="sm" isLoading={busy === connecting?.id}>Verify & connect</Button>
          </div>
        </form>
      </Modal>

      <Modal isOpen={oauthHelp} onClose={() => setOauthHelp(false)} title="Google OAuth is not configured" maxWidth="md">
        <div className="space-y-3 text-xs text-slate-300">
          <p>Add these to the project <code>.env</code> and restart the backend:</p>
          <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-[11px]">{`GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxx
GOOGLE_REDIRECT_URI=http://localhost:5000/api/auth/google/callback`}</pre>
          <p className="text-slate-400">Until then, Gmail/Drive/Calendar show clearly-labelled demo data. See SETUP_GUIDE.md → “Google Cloud”.</p>
          <div className="flex justify-end"><Button size="sm" onClick={() => setOauthHelp(false)}>Got it</Button></div>
        </div>
      </Modal>
    </div>
  );
}
