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
    'inline-flex items-center justify-center rounded-xl font-medium transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/45 focus-visible:ring-offset-2 focus-visible:ring-offset-app disabled:cursor-not-allowed disabled:opacity-60';

  const variants = {
    primary:
      'border border-brand-500/35 bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-soft hover:brightness-110 active:scale-[0.99]',
    secondary:
      'border border-line/75 bg-card/80 text-foreground hover:bg-card active:scale-[0.99]',
    danger:
      'border border-red-500/35 bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-soft hover:brightness-110 active:scale-[0.99]',
    ghost:
      'border border-transparent bg-transparent text-muted hover:bg-card/65 hover:text-foreground active:scale-[0.99]'
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
