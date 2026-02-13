import React, { forwardRef } from 'react';

import { cn } from '../../utils/cn';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label ? <label className="ml-1 block text-sm font-medium text-muted">{label}</label> : null}
        <input
          ref={ref}
          className={cn(
            'w-full rounded-xl border px-4 py-2.5 text-sm text-foreground outline-none transition-all duration-200 sm:text-base',
            'border-line/80 bg-card/75 placeholder:text-muted',
            'focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-app',
            error ? 'border-red-500/45 focus-visible:ring-red-500/35' : 'focus-visible:border-brand-500/50',
            className
          )}
          {...props}
        />
        {error ? <p className="ml-1 text-sm text-red-500 dark:text-red-400">{error}</p> : null}
      </div>
    );
  }
);

Input.displayName = 'Input';
