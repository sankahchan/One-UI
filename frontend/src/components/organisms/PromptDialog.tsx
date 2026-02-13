import { useEffect, useState, type ReactNode } from 'react';
import { MessageSquareText, X } from 'lucide-react';
import { Button } from '../atoms/Button';

interface PromptDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  inputType?: 'text' | 'number';
  confirmLabel?: string;
  cancelLabel?: string;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

export function PromptDialog({
  open,
  title,
  description,
  label = 'Value',
  placeholder,
  defaultValue = '',
  inputType = 'text',
  confirmLabel = 'Save',
  cancelLabel = 'Cancel',
  loading = false,
  onCancel,
  onConfirm
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (open) {
      setValue(defaultValue);
    }
  }, [defaultValue, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/55 p-2 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !loading) {
          onCancel();
        }
      }}
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-line/70 bg-card/95 shadow-2xl shadow-black/20">
        <div className="flex items-start justify-between border-b border-line/70 px-4 py-3 sm:px-5">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 rounded-full bg-brand-500/15 p-1 text-brand-400">
              <MessageSquareText className="h-4 w-4" />
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

        <div className="space-y-3 px-4 py-4 sm:px-5">
          {description ? <p className="whitespace-pre-wrap text-sm text-muted">{description}</p> : null}
          <label className="space-y-1 text-sm">
            <span className="font-medium text-foreground">{label}</span>
            <input
              autoFocus
              type={inputType}
              className="w-full rounded-xl border border-line/80 bg-card/80 px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand-500/70 focus:ring-2 focus:ring-brand-500/35"
              placeholder={placeholder}
              value={value}
              disabled={loading}
              onChange={(event) => {
                setValue(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !loading) {
                  event.preventDefault();
                  onConfirm(value);
                }
                if (event.key === 'Escape' && !loading) {
                  event.preventDefault();
                  onCancel();
                }
              }}
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-line/70 bg-panel/35 px-4 py-3 sm:px-5">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={() => onConfirm(value)}
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
