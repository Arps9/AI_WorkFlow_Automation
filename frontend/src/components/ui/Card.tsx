import React from 'react';
import { cn } from '../../lib/utils';

export const Card: React.FC<{ children: React.ReactNode; className?: string; onClick?: () => void }> = ({
  children,
  className,
  onClick,
}) => {
  return (
    <div
      onClick={onClick}
      className={cn(
        'bg-slate-900/90 backdrop-blur-sm border border-slate-800/80 rounded-xl p-5 shadow-sm transition-all duration-200',
        onClick && 'cursor-pointer hover:border-slate-700 hover:shadow-md',
        className
      )}
    >
      {children}
    </div>
  );
};

export const CardHeader: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cn('flex items-center justify-between pb-3 mb-3 border-b border-slate-800/60', className)}>
    {children}
  </div>
);

export const CardTitle: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <h3 className={cn('text-base font-semibold text-slate-100 tracking-tight', className)}>{children}</h3>
);

export const CardDescription: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <p className={cn('text-xs text-slate-400 mt-0.5', className)}>{children}</p>
);
