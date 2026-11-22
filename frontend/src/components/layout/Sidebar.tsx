'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Bot, Mail, Workflow, Layers, ScrollText, Settings, Sparkles, Search, CalendarClock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { cn } from '../../lib/utils';
import { api } from '../../lib/api';

export const Sidebar: React.FC = () => {
  const pathname = usePathname();
  const [health, setHealth] = useState<any>(null);

  useEffect(() => {
    api.getHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  const groups = [
    {
      label: 'Platform',
      items: [
        { label: 'Dashboard', href: '/', icon: LayoutDashboard },
        { label: 'AI Assistant', href: '/assistant', icon: Bot, badge: 'Agent' },
        { label: 'Emails', href: '/emails', icon: Mail },
        { label: 'Smart Search', href: '/search', icon: Search, badge: 'RAG' },
        { label: 'Meetings', href: '/meetings', icon: CalendarClock },
      ],
    },
    {
      label: 'Automation',
      items: [
        { label: 'Workflows', href: '/workflows', icon: Workflow },
        { label: 'Execution Logs', href: '/executions', icon: ScrollText },
        { label: 'Integrations', href: '/integrations', icon: Layers },
        { label: 'Settings', href: '/settings', icon: Settings },
      ],
    },
  ];

  const aiLive = health?.ai?.live;

  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800/80 flex flex-col shrink-0 h-screen select-none sticky top-0">
      <div className="h-16 px-6 flex items-center gap-3 border-b border-slate-800/80">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-md shadow-blue-500/20">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-bold text-sm tracking-tight text-white">
            AutoFlow <span className="text-blue-400 font-semibold">AI</span>
          </h1>
          <p className="text-[10px] uppercase font-semibold tracking-wider text-slate-400">Enterprise Suite</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.label} className="space-y-1">
            <div className="px-3 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{g.label}</div>
            {g.items.map((item) => {
              const Icon = item.icon;
              const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center justify-between px-3 py-2 rounded-lg text-sm font-medium transition-all group',
                    active ? 'bg-blue-600/15 text-blue-400 border border-blue-500/30' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/80 border border-transparent'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={cn('w-4 h-4', active ? 'text-blue-400' : 'text-slate-400 group-hover:text-slate-300')} />
                    <span>{item.label}</span>
                  </div>
                  {item.badge && (
                    <span className={cn('text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider border', active ? 'bg-blue-500/20 text-blue-300 border-blue-400/30' : 'bg-slate-800 text-slate-400 border-slate-700')}>
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="p-4 m-3 rounded-xl border border-slate-800/80 bg-slate-900/40">
        <div className="flex items-center gap-2 mb-1.5">
          {aiLive ? <ShieldCheck className="w-4 h-4 text-emerald-400" /> : <ShieldAlert className="w-4 h-4 text-amber-400" />}
          <span className="text-xs font-semibold text-white">{aiLive ? 'Gemini connected' : 'AI fallback mode'}</span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          {aiLive ? `Model: ${health?.ai?.model}` : 'Set GEMINI_API_KEY for real AI. Using rule-based heuristics.'}
          {health?.demoMode && <span className="block mt-1 text-slate-500">Demo mode: unconnected tools return simulated data.</span>}
        </p>
      </div>
    </aside>
  );
};
