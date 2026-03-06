import React from 'react';

import { cn } from '../../utils/cn';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, className, padding = true }) => {
  return (
    <section
      className={cn(
        'glass-card rounded-3xl',
        padding ? 'p-6 sm:p-8' : '',
        className
      )}
    >
      {children}
    </section>
  );
};
