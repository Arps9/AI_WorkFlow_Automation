import React from 'react';
import { cn } from '../../lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'urgent' | 'bug' | 'client' | 'meeting' | 'success' | 'warning' | 'secondary';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'default', className }) => {
  const variants = {
    default: 'bg-slate-800 text-slate-300 border-slate-700',
    urgent: 'bg-rose-950/80 text-rose-300 border-rose-800/60 font-medium',
    bug: 'bg-red-950/70 text-red-300 border-red-800/60 font-medium',
    client: 'bg-amber-950/70 text-amber-300 border-amber-800/60 font-medium',
    meeting: 'bg-purple-950/70 text-purple-300 border-purple-800/60 font-medium',
    success: 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60 font-medium',
    warning: 'bg-yellow-950/70 text-yellow-300 border-yellow-800/60 font-medium',
    secondary: 'bg-blue-950/70 text-blue-300 border-blue-800/60 font-medium',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs border font-medium transition-colors',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
};
