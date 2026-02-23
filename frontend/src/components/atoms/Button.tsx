import React from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '../../utils/cn';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...props
}) => {
  const baseStyles =
    'relative inline-flex items-center justify-center rounded-xl font-medium transition-all duration-300 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-500/30 disabled:cursor-not-allowed disabled:opacity-60 overflow-hidden';

  const variants = {
    primary:
      'border border-brand-400/30 bg-gradient-to-tr from-brand-600 to-brand-400 text-white shadow-[0_4px_20px_rgba(59,130,246,0.3)] hover:shadow-[0_4px_25px_rgba(59,130,246,0.45)] hover:-translate-y-0.5 active:scale-[0.98] active:translate-y-0',
    secondary:
      'border border-line/60 bg-panel/80 text-foreground backdrop-blur-md hover:bg-card/95 hover:border-line hover:shadow-soft active:scale-[0.98]',
    danger:
      'border border-red-500/30 bg-gradient-to-tr from-rose-600 to-red-400 text-white shadow-[0_4px_20px_rgba(225,29,72,0.3)] hover:shadow-[0_4px_25px_rgba(225,29,72,0.45)] hover:-translate-y-0.5 active:scale-[0.98] active:translate-y-0',
    ghost:
      'border border-transparent bg-transparent text-muted hover:bg-card/65 hover:text-foreground active:scale-[0.98]'
  };

  const sizes = {
    sm: 'min-h-[2rem] px-3 py-1.5 text-sm',
    md: 'min-h-[2.5rem] px-4 py-2 text-sm sm:text-base',
    lg: 'min-h-[2.875rem] px-6 py-3 text-base'
  };

  return (
    <button
      className={cn(baseStyles, variants[variant], sizes[size], className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
      {children}
    </button>
  );
};
