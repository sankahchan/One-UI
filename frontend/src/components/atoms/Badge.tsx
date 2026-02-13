import React from 'react';

import { cn } from '../../utils/cn';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'danger' | 'info';
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ children, variant = 'info', className }) => {
  const variants = {
    success: 'border border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    warning: 'border border-amber-500/35 bg-amber-500/15 text-amber-700 dark:text-amber-300',
    danger: 'border border-red-500/35 bg-red-500/15 text-red-700 dark:text-red-300',
    info: 'border border-blue-500/35 bg-blue-500/15 text-blue-700 dark:text-blue-300'
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide',
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
};
