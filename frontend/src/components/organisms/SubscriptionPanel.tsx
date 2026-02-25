import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle, ChevronDown, ChevronUp, Copy, Download, QrCode, Share2 } from 'lucide-react';
import { QRCodeSVG as QRCodeReact } from 'qrcode.react';

import apiClient from '../../api/client';
import type { SubscriptionLink } from '../../types';
import { copyTextToClipboard } from '../../utils/clipboard';
import { Button } from '../atoms/Button';
import { Card } from '../atoms/Card';

interface SubscriptionPanelProps {
  userId: number;
}

type SubscriptionFormat = 'v2ray' | 'clash' | 'singbox' | 'wireguard' | 'mieru';

interface SubscriptionData {
  urls: Partial<Record<SubscriptionFormat, string>>;
  qrCodes?: Partial<Record<SubscriptionFormat, string>>;
  links?: SubscriptionLink[];
  shareUrl?: string;
}

const PROTOCOL_COLORS: Record<string, string> = {
  VLESS: 'bg-blue-500/15 text-blue-400',
  VMESS: 'bg-indigo-500/15 text-indigo-400',
  TROJAN: 'bg-amber-500/15 text-amber-400',
  SHADOWSOCKS: 'bg-purple-500/15 text-purple-400'
};

const getProtocolColor = (protocol: string): string =>
  PROTOCOL_COLORS[protocol.toUpperCase()] || 'bg-zinc-500/15 text-zinc-400';

export const SubscriptionPanel: React.FC<SubscriptionPanelProps> = ({ userId }) => {
  const [copied, setCopied] = useState<string>('');
  const [selectedFormat, setSelectedFormat] = useState<SubscriptionFormat>('v2ray');
  const [expandedLinks, setExpandedLinks] = useState<Set<number>>(new Set());
  const [showShareQr, setShowShareQr] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['subscription-info', userId],
    queryFn: async () => {
      const response = await apiClient.get('/users/' + userId + '/subscription');
      return response?.data as SubscriptionData | undefined;
    },
    enabled: Number.isInteger(userId) && userId > 0
  });

  const formats = useMemo(
    () => [
      { key: 'v2ray' as const, label: 'V2Ray / V2RayNG', colorClass: 'bg-blue-500 text-white' },
      { key: 'clash' as const, label: 'Clash / ClashX', colorClass: 'bg-indigo-500 text-white' },
      { key: 'singbox' as const, label: 'Sing-box', colorClass: 'bg-emerald-500 text-white' },
      { key: 'wireguard' as const, label: 'WireGuard', colorClass: 'bg-teal-500 text-white' },
      { key: 'mieru' as const, label: 'Mieru', colorClass: 'bg-fuchsia-500 text-white' }
    ],
    []
  );

  const subscriptionData = data;
  const availableFormats = useMemo(
    () => formats.filter(({ key }) => Boolean(subscriptionData?.urls?.[key])),
    [formats, subscriptionData]
  );

  useEffect(() => {
    if (!subscriptionData) {
      return;
    }

    if (!subscriptionData.urls[selectedFormat] && availableFormats.length > 0) {
      setSelectedFormat(availableFormats[0].key);
    }
  }, [availableFormats, selectedFormat, subscriptionData]);

  if (isLoading) {
    return (
      <Card>
        <h2 className="mb-4 text-xl font-bold text-foreground">Subscription Links</h2>
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-line/70 border-t-brand-500" />
        </div>
      </Card>
    );
  }

  if (!subscriptionData) {
    return null;
  }

  if (availableFormats.length === 0) {
    return (
      <Card>
        <h2 className="mb-4 text-xl font-bold text-foreground">Subscription Links</h2>
        <p className="text-sm text-muted">No subscription formats are available for this user yet.</p>
      </Card>
    );
  }

  const selectedUrl = subscriptionData.urls[selectedFormat] || '';

  const copyToClipboard = async (text: string, key: string) => {
    const copiedOk = await copyTextToClipboard(text);
    if (!copiedOk) {
      return;
    }
    setCopied(key);
    setTimeout(() => setCopied(''), 1600);
  };

  const toggleLinkQr = (inboundId: number) => {
    setExpandedLinks((prev) => {
      const next = new Set(prev);
      if (next.has(inboundId)) {
        next.delete(inboundId);
      } else {
        next.add(inboundId);
      }
      return next;
    });
  };

  const handleDownload = () => {
    if (!selectedUrl) {
      return;
    }

    const separator = selectedUrl.includes('?') ? '&' : '?';
    const downloadUrl = `${selectedUrl}${separator}dl=1`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    const extension = selectedFormat === 'clash'
      ? 'yaml'
      : selectedFormat === 'singbox'
        ? 'json'
      : selectedFormat === 'wireguard'
          ? 'conf'
          : selectedFormat === 'mieru'
            ? 'yaml'
          : 'txt';
    link.download = `subscription-${selectedFormat}.${extension}`;
    link.click();
  };

  return (
    <Card>
      <h2 className="mb-4 text-xl font-bold text-foreground">Subscription Links</h2>

      <div className="mb-6 flex flex-wrap gap-2">
        {availableFormats.map(({ key, label, colorClass }) => (
          <button
            key={key}
            onClick={() => setSelectedFormat(key)}
            className={`rounded-xl px-3 py-2 text-sm font-medium transition sm:px-4 ${selectedFormat === key ? colorClass : 'border border-line/70 bg-card/70 text-muted hover:text-foreground'
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-line/70 bg-panel/55 p-5">
          <div className="rounded-2xl border border-line/70 bg-white p-4">
            {selectedUrl ? (
              <QRCodeReact value={selectedUrl} size={200} level="M" includeMargin={false} />
            ) : (
              <div className="flex h-[200px] w-[200px] items-center justify-center text-sm text-muted">No URL</div>
            )}
          </div>
          <p className="mt-4 text-center text-sm text-muted">
            Scan with {formats.find((format) => format.key === selectedFormat)?.label}
          </p>
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-muted">Subscription URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={selectedUrl}
                onClick={(e) => { (e.target as HTMLInputElement).select(); void copyToClipboard(selectedUrl, selectedFormat); }}
                className="flex-1 cursor-pointer select-all rounded-xl border border-line/80 bg-card/80 px-3 py-2 font-mono text-xs text-foreground sm:text-sm"
              />
              <Button variant="secondary" onClick={() => { void copyToClipboard(selectedUrl, selectedFormat); }} disabled={!selectedUrl}>
                {copied === selectedFormat ? <CheckCircle className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <h3 className="font-medium text-foreground">Import Instructions:</h3>
            <ol className="list-inside list-decimal space-y-1 text-sm text-muted">
              {selectedFormat === 'v2ray' ? (
                <>
                  <li>Open V2RayNG/V2RayN</li>
                  <li>Click &quot;+&quot; then import from clipboard</li>
                  <li>Paste the subscription URL</li>
                  <li>Click update subscription</li>
                </>
              ) : null}
              {selectedFormat === 'clash' ? (
                <>
                  <li>Open Clash/ClashX</li>
                  <li>Go to profiles section</li>
                  <li>Click import from URL</li>
                  <li>Paste the subscription URL and download</li>
                </>
              ) : null}
              {selectedFormat === 'singbox' ? (
                <>
                  <li>Open Sing-box client</li>
                  <li>Click add subscription</li>
                  <li>Select import from URL</li>
                  <li>Paste the link and save</li>
                </>
              ) : null}
              {selectedFormat === 'wireguard' ? (
                <>
                  <li>Download the <code>.conf</code> profile</li>
                  <li>Open WireGuard desktop/mobile app</li>
                  <li>Import tunnel from file</li>
                  <li>Activate the tunnel</li>
                </>
              ) : null}
              {selectedFormat === 'mieru' ? (
                <>
                  <li>Open a Mieru-supported client (Clash Verge/Mihomo + Mieru plugin)</li>
                  <li>Import from URL (YAML profile)</li>
                  <li>Select the imported Mieru proxy</li>
                  <li>Enable global/rule mode and connect</li>
                </>
              ) : null}
            </ol>
          </div>

          <Button variant="secondary" className="w-full" onClick={handleDownload} disabled={!selectedUrl}>
            <Download className="mr-2 h-4 w-4" />
            Download Subscription File
          </Button>
        </div>
      </div>

      {subscriptionData.links && subscriptionData.links.length > 0 && (
        <div className="mt-6 border-t border-line/70 pt-6">
          <h3 className="mb-4 text-lg font-semibold text-foreground">Protocol Links</h3>
          <div className="space-y-3">
            {subscriptionData.links.map((link: SubscriptionLink) => {
              const linkCopyKey = `link-${link.inboundId}`;
              return (
                <div key={link.inboundId} className="rounded-xl border border-line/70 bg-panel/55 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${getProtocolColor(link.protocol)}`}>
                      {link.protocol}
                    </span>
                    <span className="flex-1 truncate text-sm font-medium text-foreground">{link.remark}</span>
                    <span className="text-xs text-muted">
                      {link.network} / {link.security}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => { void copyToClipboard(link.url, linkCopyKey); }}>
                      {copied === linkCopyKey ? (
                        <CheckCircle className="mr-1.5 h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      {copied === linkCopyKey ? 'Copied' : 'Copy'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => toggleLinkQr(link.inboundId)}>
                      <QrCode className="mr-1.5 h-3.5 w-3.5" />
                      QR
                      {expandedLinks.has(link.inboundId) ? (
                        <ChevronUp className="ml-1 h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="ml-1 h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                  {expandedLinks.has(link.inboundId) && (
                    <div className="mt-4 flex justify-center">
                      <div className="rounded-xl border border-line/70 bg-white p-3">
                        <QRCodeReact value={link.url} size={180} level="M" includeMargin={false} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {subscriptionData.shareUrl && (
        <div className="mt-6 border-t border-line/70 pt-4">
          <Button
            variant="secondary"
            onClick={() => {
              void copyToClipboard(subscriptionData.shareUrl!, 'share');
              setShowShareQr((prev) => !prev);
            }}
          >
            <Share2 className="mr-2 h-4 w-4" />
            {copied === 'share' ? 'Link Copied' : 'Share'}
          </Button>
          {showShareQr && (
            <div className="mt-4 flex flex-col items-center rounded-2xl border border-line/70 bg-panel/55 p-5">
              <div className="rounded-2xl border border-line/70 bg-white p-4">
                <QRCodeReact value={subscriptionData.shareUrl!} size={180} level="M" includeMargin={false} />
              </div>
              <p className="mt-3 text-center text-sm text-muted">Scan to open share page</p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
