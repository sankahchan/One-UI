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
            'w-full rounded-xl border px-4 py-2.5 text-sm text-foreground outline-none transition-all duration-300 sm:text-base',
            'border-line/60 bg-card/60 backdrop-blur-md placeholder:text-muted/70',
            'focus:bg-card/90 focus:border-brand-500/60 focus:ring-4 focus:ring-brand-500/10 focus:shadow-[0_0_20px_rgba(59,130,246,0.15)]',
            error ? 'border-red-500/45 focus:border-red-500/60 focus:ring-red-500/15' : '',
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
