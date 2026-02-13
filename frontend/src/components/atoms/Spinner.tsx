import { cn } from '../../utils/cn';

interface SpinnerProps {
  className?: string;
}

export function Spinner({ className }: SpinnerProps) {
  return (
    <span
      className={cn(
        'inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-accent-500',
        className
      )}
      aria-label="Loading"
    />
  );
}
