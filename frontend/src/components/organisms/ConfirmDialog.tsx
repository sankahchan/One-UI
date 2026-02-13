import type { ReactNode } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '../atoms/Button';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-2 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !loading) {
          onCancel();
        }
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line/70 bg-card/95 shadow-2xl shadow-black/20">
        <div className="flex items-start justify-between border-b border-line/70 px-4 py-3 sm:px-5">
          <div className="flex items-start gap-2">
            <span className={`mt-0.5 rounded-full p-1 ${tone === 'danger' ? 'bg-red-500/15 text-red-400' : 'bg-brand-500/15 text-brand-400'}`}>
              <AlertTriangle className="h-4 w-4" />
            </span>
            <h3 className="text-base font-semibold text-foreground">{title}</h3>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-muted transition hover:bg-panel/70 hover:text-foreground"
            onClick={onCancel}
            disabled={loading}
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {description ? (
          <div className="whitespace-pre-wrap px-4 py-4 text-sm text-muted sm:px-5">
            {description}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 border-t border-line/70 bg-panel/35 px-4 py-3 sm:px-5">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
            disabled={loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
