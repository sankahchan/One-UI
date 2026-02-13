import { createContext } from 'react';

export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

export type ToastPayload = {
  title: string;
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
};

export type ToastContextValue = {
  push: (payload: ToastPayload) => string;
  dismiss: (id: string) => void;
  success: (title: string, description?: string, durationMs?: number) => string;
  error: (title: string, description?: string, durationMs?: number) => string;
  info: (title: string, description?: string, durationMs?: number) => string;
  warning: (title: string, description?: string, durationMs?: number) => string;
};

export const ToastContext = createContext<ToastContextValue | null>(null);
