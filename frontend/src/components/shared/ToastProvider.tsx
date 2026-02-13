import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import {
  ToastContext,
  type ToastContextValue,
  type ToastPayload,
  type ToastVariant
} from './toast-context';
import { registerToast } from '../../utils/toastBridge';

type ToastItem = ToastPayload & {
  id: string;
  variant: ToastVariant;
};

const variantStyles: Record<ToastVariant, string> = {
  success: 'border-emerald-500/35 bg-emerald-500/15 text-emerald-100',
  error: 'border-rose-500/35 bg-rose-500/15 text-rose-100',
  info: 'border-sky-500/35 bg-sky-500/15 text-sky-100',
  warning: 'border-amber-500/35 bg-amber-500/15 text-amber-100'
};

function ToastIcon({ variant }: { variant: ToastVariant }) {
  if (variant === 'success') {
    return <CheckCircle2 className="h-4 w-4" />;
  }
  if (variant === 'error') {
    return <AlertTriangle className="h-4 w-4" />;
  }
  return <Info className="h-4 w-4" />;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    ({ title, description, variant = 'info', durationMs = 3600 }: ToastPayload) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const nextToast: ToastItem = { id, title, description, variant, durationMs };
      setToasts((previous) => [...previous, nextToast]);

      if (durationMs > 0) {
        window.setTimeout(() => {
          dismiss(id);
        }, durationMs);
      }

      return id;
    },
    [dismiss]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      dismiss,
      success: (title, description, durationMs) => push({ title, description, variant: 'success', durationMs }),
      error: (title, description, durationMs) => push({ title, description, variant: 'error', durationMs }),
      info: (title, description, durationMs) => push({ title, description, variant: 'info', durationMs }),
      warning: (title, description, durationMs) => push({ title, description, variant: 'warning', durationMs })
    }),
    [dismiss, push]
  );

  useEffect(() => {
    registerToast(value);
  }, [value]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-[140] flex w-[min(90vw,420px)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-xl border px-3 py-3 shadow-soft backdrop-blur-sm ${variantStyles[toast.variant]}`}
          >
            <div className="flex items-start gap-2">
              <div className="mt-0.5">
                <ToastIcon variant={toast.variant} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-1 text-xs opacity-90">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                className="rounded-md p-1 opacity-80 transition hover:bg-white/10 hover:opacity-100"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
