'use client';

import React, { useState } from 'react';
import { Sparkles, Mail, Lock, User as UserIcon, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { Button } from '../../components/ui/Button';

export default function LoginPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(name, email, password);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const input = 'w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-3 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500';

  return (
    <div className="flex-1 min-h-screen flex items-center justify-center p-6 bg-[radial-gradient(ellipse_at_top,_rgba(37,99,235,0.15),_transparent_60%)]">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Sparkles className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">
              AutoFlow <span className="text-blue-400">AI</span>
            </h1>
            <p className="text-[11px] uppercase tracking-wider text-slate-400">Enterprise Workflow Automation</p>
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-7 shadow-2xl">
          <div className="flex bg-slate-950 border border-slate-800 rounded-lg p-1 mb-6">
            {(['login', 'register'] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`flex-1 py-1.5 text-sm rounded-md font-medium transition-colors ${mode === m ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'register' && (
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
                <input className={input} placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
              </div>
            )}
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
              <input className={input} type="password" placeholder={mode === 'register' ? 'Password (min 8 characters)' : 'Password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === 'register' ? 8 : 1} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
            </div>

            {error && <div className="text-xs text-rose-300 bg-rose-950/50 border border-rose-900 rounded-lg px-3 py-2">{error}</div>}

            <Button type="submit" className="w-full" isLoading={busy}>
              {mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight className="w-4 h-4" />
            </Button>
          </form>

          {mode === 'login' && (
            <div className="mt-5 p-3 rounded-lg bg-blue-950/30 border border-blue-900/50 text-[11px] text-blue-200 leading-relaxed">
              <div className="flex items-center gap-1.5 font-semibold mb-1">
                <ShieldCheck className="w-3.5 h-3.5" /> First run?
              </div>
              The server seeds an admin account (default <code className="text-white">admin@autoflow.ai</code> / <code className="text-white">Admin@123</code>, set via
              DEMO_ADMIN_EMAIL / DEMO_ADMIN_PASSWORD). Change the password in Settings after signing in.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
