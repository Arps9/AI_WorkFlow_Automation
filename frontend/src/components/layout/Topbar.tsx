'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Bot, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const TITLES: Record<string, string> = {
  '/': 'Executive Dashboard',
  '/assistant': 'AI Workflow Assistant',
  '/emails': 'Email Intelligence Hub',
  '/search': 'Smart Search & Knowledge Base',
  '/meetings': 'AI Meeting Assistant',
  '/workflows': 'Workflow Automation',
  '/integrations': 'Integrations',
  '/executions': 'Execution Audit Logs',
  '/settings': 'Settings & Administration',
};

export const Topbar: React.FC = () => {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    api.getHealth().then(setHealth).catch(() => setHealth({ status: 'offline' }));
  }, []);

  const ok = health?.status === 'healthy';

  return (
    <header className="h-16 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-30">
      <h2 className="text-base font-semibold text-slate-100">{TITLES[pathname] || 'AutoFlow AI'}</h2>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px]">
          <span className={`h-2 w-2 rounded-full ${ok ? 'bg-emerald-500' : health ? 'bg-rose-500' : 'bg-slate-500'}`} />
          <span className="text-slate-300 font-medium">{ok ? (health.database === 'connected' ? 'API & DB online' : 'API online, DB offline') : health ? 'API offline' : 'Connecting…'}</span>
        </div>

        <div className="hidden md:flex items-center gap-1.5 text-[11px] text-blue-300 bg-blue-950/40 border border-blue-900/50 px-2.5 py-1 rounded-full font-medium">
          <ShieldCheck className="w-3.5 h-3.5" />
          {health?.ai?.live ? health.ai.model : 'Heuristic AI'} · confirmation guard
        </div>

        {pathname !== '/assistant' && (
          <Link href="/assistant" className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-300 border border-blue-500/40 text-xs font-semibold hover:bg-blue-600/30">
            <Bot className="w-3.5 h-3.5" /> Ask AI
          </Link>
        )}

        <div className="flex items-center gap-2.5 pl-3 border-l border-slate-800">
          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-blue-700 to-indigo-600 flex items-center justify-center text-xs font-bold text-white">
            {(user?.name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="hidden lg:block">
            <div className="text-xs font-semibold text-slate-200">{user?.name}</div>
            <div className="text-[10px] text-slate-400">
              {user?.email} · <span className="uppercase">{user?.role}</span>
            </div>
          </div>
          <button onClick={logout} title="Sign out" className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
