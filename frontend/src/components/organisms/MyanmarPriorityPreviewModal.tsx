import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../atoms/Button';

interface TopEntry {
  key: string;
  toPriority?: number;
}

interface SummaryRow {
  label: string;
  value: ReactNode;
}

interface MyanmarPriorityPreviewModalProps {
  open: boolean;
  title?: string;
  description?: string;
  summaryRows: SummaryRow[];
  currentTop3?: TopEntry[];
  newTop3?: TopEntry[];
  previewLines?: string[];
  confirmLabel?: string;
  loading?: boolean;
  disableConfirm?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function formatTopEntry(entry: TopEntry, index: number) {
  const priorityLabel = Number.isInteger(Number(entry.toPriority)) ? ` [P${entry.toPriority}]` : '';
  return `${index + 1}. ${entry.key}${priorityLabel}`;
}

export function MyanmarPriorityPreviewModal({
  open,
  title = 'Myanmar Priority Preview',
  description,
  summaryRows,
  currentTop3 = [],
  newTop3 = [],
  previewLines = [],
  confirmLabel = 'Apply',
  loading = false,
  disableConfirm = false,
  onClose,
  onConfirm
}: MyanmarPriorityPreviewModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end justify-center bg-black/55 p-2 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !loading) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-2xl border border-line/70 bg-card/95 shadow-2xl shadow-black/25">
        <div className="flex items-start justify-between border-b border-line/70 px-4 py-3 sm:px-6">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-muted transition hover:bg-panel/70 hover:text-foreground"
            onClick={onClose}
            disabled={loading}
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {summaryRows.map((item) => (
              <div key={item.label} className="rounded-xl border border-line/70 bg-panel/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">{item.label}</p>
                <p className="mt-1 text-lg font-semibold text-foreground">{item.value}</p>
              </div>
            ))}
          </div>

          {currentTop3.length > 0 || newTop3.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-line/70 bg-panel/45 p-3">
                <p className="text-sm font-semibold text-foreground">Current Top 3</p>
                {currentTop3.length === 0 ? (
                  <p className="mt-2 text-xs text-muted">No current entries</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm text-foreground/90">
                    {currentTop3.slice(0, 3).map((entry, index) => (
                      <li key={`before-${entry.key}-${index}`}>{formatTopEntry(entry, index)}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-xl border border-line/70 bg-panel/45 p-3">
                <p className="text-sm font-semibold text-foreground">New Top 3</p>
                {newTop3.length === 0 ? (
                  <p className="mt-2 text-xs text-muted">No new entries</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm text-foreground/90">
                    {newTop3.slice(0, 3).map((entry, index) => (
                      <li key={`after-${entry.key}-${index}`}>{formatTopEntry(entry, index)}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : null}

          {previewLines.length > 0 ? (
            <div className="rounded-xl border border-line/70 bg-panel/45 p-3">
              <p className="text-sm font-semibold text-foreground">Preview</p>
              <ul className="mt-2 space-y-1 text-xs text-foreground/90">
                {previewLines.map((line, index) => (
                  <li key={`${line}-${index}`}>{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-line/70 bg-panel/35 px-4 py-3 sm:px-6">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            loading={loading}
            disabled={disableConfirm || loading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

