import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Copy, ExternalLink, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';

import { usersApi } from '../../api/users';
import type { User } from '../../types';
import { Button } from '../atoms/Button';

type SubscriptionFormat = 'v2ray' | 'clash' | 'singbox' | 'wireguard';

interface UserQuickQrModalProps {
  user: User;
  onClose: () => void;
}

const ALL_FORMATS: Array<{ key: SubscriptionFormat; label: string }> = [
  { key: 'v2ray', label: 'V2Ray' },
  { key: 'clash', label: 'Clash' },
  { key: 'singbox', label: 'Sing-box' },
  { key: 'wireguard', label: 'WireGuard' }
];

export function UserQuickQrModal({ user, onClose }: UserQuickQrModalProps) {
  const { t } = useTranslation();
  const [selectedFormat, setSelectedFormat] = useState<SubscriptionFormat>('v2ray');
  const [copied, setCopied] = useState(false);

  const subscriptionQuery = useQuery({
    queryKey: ['subscription-info', user.id],
    queryFn: () => usersApi.getSubscriptionInfo(user.id)
  });

  const urls = useMemo(
    () => subscriptionQuery.data?.data?.urls ?? {},
    [subscriptionQuery.data?.data?.urls]
  );
  const qrCodes = useMemo(
    () => subscriptionQuery.data?.data?.qrCodes ?? {},
    [subscriptionQuery.data?.data?.qrCodes]
  );

  const availableFormats = useMemo(
    () => ALL_FORMATS.filter((format) => Boolean(urls[format.key])),
    [urls]
  );

  const activeFormat = availableFormats.some((format) => format.key === selectedFormat)
    ? selectedFormat
    : availableFormats[0]?.key ?? 'v2ray';

  const selectedUrl = urls[activeFormat] || '';
  const selectedQrDataUrl = qrCodes[activeFormat];

  const copyUrl = async () => {
    if (!selectedUrl) {
      return;
    }
    await navigator.clipboard.writeText(selectedUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-line/80 bg-card/95 shadow-soft backdrop-blur-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line/80 bg-card/95 p-5">
          <div>
            <h2 className="text-xl font-bold text-foreground">
              {t('users.qrModal.title', { defaultValue: 'Subscription QR' })}
            </h2>
            <p className="text-sm text-muted">{user.email}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-card hover:text-foreground"
            aria-label={t('common.close', { defaultValue: 'Close' })}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-5 sm:p-6">
          {subscriptionQuery.isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-line/70 border-t-brand-500" />
            </div>
          ) : subscriptionQuery.isError ? (
            <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-300">
              {t('users.qrModal.loadFailed', { defaultValue: 'Failed to load subscription QR.' })}
            </div>
          ) : availableFormats.length === 0 ? (
            <div className="rounded-xl border border-line/70 bg-panel/60 px-4 py-6 text-center text-sm text-muted">
              {t('users.qrModal.noFormats', { defaultValue: 'No subscription formats available for this user.' })}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {availableFormats.map((format) => (
                  <button
                    key={format.key}
                    type="button"
                    onClick={() => setSelectedFormat(format.key)}
                    className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                      activeFormat === format.key
                        ? 'bg-brand-500 text-white'
                        : 'border border-line/70 bg-card/80 text-muted hover:text-foreground'
                    }`}
                  >
                    {format.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-col items-center gap-4 rounded-2xl border border-line/70 bg-panel/60 p-4">
                <div className="rounded-xl border border-line/70 bg-white p-3">
                  {selectedQrDataUrl ? (
                    <img
                      src={selectedQrDataUrl}
                      alt={t('users.qrModal.alt', { defaultValue: 'Subscription QR' })}
                      className="h-[220px] w-[220px]"
                    />
                  ) : (
                    <QRCodeSVG value={selectedUrl} size={220} />
                  )}
                </div>
                <p className="w-full break-all rounded-lg border border-line/70 bg-card/80 px-3 py-2 text-xs text-foreground">
                  {selectedUrl}
                </p>
              </div>

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="button" className="flex-1" onClick={() => void copyUrl()}>
                  {copied ? <CheckCircle className="mr-2 h-4 w-4" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copied
                    ? t('common.copied', { defaultValue: 'Copied' })
                    : t('users.copyLink', { defaultValue: 'Copy Link' })}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => window.open(selectedUrl, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {t('common.open', { defaultValue: 'Open' })}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
