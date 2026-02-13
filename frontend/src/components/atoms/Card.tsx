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
        'glass-card rounded-2xl transition-all duration-200',
        'hover:shadow-[0_20px_55px_-36px_rgba(15,23,42,0.6)] dark:hover:shadow-[0_20px_55px_-36px_rgba(2,6,23,0.9)]',
        padding ? 'p-5 sm:p-6' : '',
        className
      )}
    >
      {children}
    </section>
  );
};
