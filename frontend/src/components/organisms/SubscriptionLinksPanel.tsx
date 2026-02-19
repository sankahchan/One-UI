import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  QrCode,
  Share2,
  Smartphone
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

import apiClient from '../../api/client';
import type { SubscriptionLinksData, SubscriptionLink } from '../../types';
import {
  detectPlatform,
  resolveSubscriptionApps,
  type Platform,
  type SubscriptionBrandingMetadata
} from '../../lib/subscriptionApps';
import { Button } from '../atoms/Button';
import { Card } from '../atoms/Card';

interface SubscriptionLinksPanelProps {
  userId: number;
}

type ClientTab = 'v2ray' | 'clash' | 'shadowrocket' | 'singbox';

const CLIENT_TABS: Array<{ key: ClientTab; label: string; colorClass: string }> = [
  { key: 'v2ray', label: 'V2RayNG', colorClass: 'bg-blue-500 text-white' },
  { key: 'clash', label: 'Clash', colorClass: 'bg-indigo-500 text-white' },
  { key: 'shadowrocket', label: 'Shadowrocket', colorClass: 'bg-orange-500 text-white' },
  { key: 'singbox', label: 'Sing-box', colorClass: 'bg-emerald-500 text-white' }
];

const PROTOCOL_COLORS: Record<string, string> = {
  VLESS: 'bg-blue-500/15 text-blue-400',
  VMESS: 'bg-indigo-500/15 text-indigo-400',
  TROJAN: 'bg-amber-500/15 text-amber-400',
  SHADOWSOCKS: 'bg-purple-500/15 text-purple-400'
};

const getProtocolColor = (protocol: string): string =>
  PROTOCOL_COLORS[protocol.toUpperCase()] || 'bg-zinc-500/15 text-zinc-400';

const getDeepLink = (tab: ClientTab, url: string): string | null => {
  if (!url) return null;
  switch (tab) {
    case 'v2ray':
      return `v2rayng://install-sub?url=${encodeURIComponent(url)}`;
    case 'clash':
      return `clash://install-config?url=${encodeURIComponent(url)}`;
    case 'shadowrocket':
      return url;
    default:
      return null;
  }
};

const getSubscriptionUrl = (
  data: SubscriptionLinksData,
  tab: ClientTab
): string => {
  const urls = data.urls;
  if (!urls) return '';
  if (tab === 'shadowrocket') return urls.v2ray || '';
  return urls[tab] || '';
};

export const SubscriptionLinksPanel: React.FC<SubscriptionLinksPanelProps> = ({ userId }) => {
  const [activeTab, setActiveTab] = useState<ClientTab>('v2ray');
  const [copied, setCopied] = useState<string>('');
  const [expandedQr, setExpandedQr] = useState<Set<number>>(new Set());
  const [showShareQr, setShowShareQr] = useState(false);
  const [platform, setPlatform] = useState<Platform>(() => detectPlatform());

  const { data, isLoading } = useQuery({
    queryKey: ['subscription-info', userId],
    queryFn: async () => {
      const response = await apiClient.get('/users/' + userId + '/subscription');
      return response?.data as SubscriptionLinksData | undefined;
    },
    enabled: Number.isInteger(userId) && userId > 0
  });

  useEffect(() => {
    setPlatform(detectPlatform());
  }, []);

  const availableTabs = useMemo(() => {
    if (!data?.urls) return [];
    return CLIENT_TABS.filter(({ key }) => {
      if (key === 'shadowrocket') return Boolean(data.urls.v2ray);
      return Boolean(data.urls[key]);
    });
  }, [data]);

  useEffect(() => {
    if (!data?.urls) return;
    const currentUrl = getSubscriptionUrl(data, activeTab);
    if (!currentUrl && availableTabs.length > 0) {
      setActiveTab(availableTabs[0].key);
    }
  }, [availableTabs, activeTab, data]);

  const copyToClipboard = (text: string, key: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 1600);
  };

  const toggleQr = (inboundId: number) => {
    setExpandedQr((prev) => {
      const next = new Set(prev);
      if (next.has(inboundId)) {
        next.delete(inboundId);
      } else {
        next.add(inboundId);
      }
      return next;
    });
  };

  const handleDownloadAll = () => {
    if (!data?.links?.length) return;
    const content = data.links.map((link) => `# ${link.remark} [${link.protocol}]\n${link.url}`).join('\n\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'protocol-links.txt';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const brandingMetadata = (data as any)?.branding?.metadata as SubscriptionBrandingMetadata | null | undefined;
  const appsForPlatform = data?.urls
    ? resolveSubscriptionApps({
        platform,
        urls: data.urls,
        metadata: brandingMetadata
      })
    : [];

  if (isLoading) {
    return (
      <Card>
        <h2 className="mb-4 text-xl font-bold text-foreground">Protocol Links</h2>
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-line/70 border-t-brand-500" />
        </div>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  if (!data.links?.length && !data.urls) {
    return (
      <Card>
        <h2 className="mb-4 text-xl font-bold text-foreground">Subscription Link Generator</h2>
        <p className="text-sm text-muted">No subscription data available for this user.</p>
      </Card>
    );
  }

  const selectedUrl = getSubscriptionUrl(data, activeTab);
  const deepLink = getDeepLink(activeTab, selectedUrl);

  return (
    <Card>
      <h2 className="mb-4 text-xl font-bold text-foreground">Subscription Link Generator</h2>

      <div className="mb-6 flex flex-wrap gap-2">
        {availableTabs.map(({ key, label, colorClass }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`rounded-xl px-3 py-2 text-sm font-medium transition sm:px-4 ${
              activeTab === key ? colorClass : 'border border-line/70 bg-card/70 text-muted hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {selectedUrl && (
        <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className="flex flex-col items-center justify-center rounded-2xl border border-line/70 bg-panel/55 p-5">
            <div className="rounded-2xl border border-line/70 bg-white p-4">
              {selectedUrl ? (
                <QRCodeSVG value={selectedUrl} size={200} level="M" includeMargin={false} />
              ) : (
                <div className="flex h-[200px] w-[200px] items-center justify-center text-sm text-muted">No URL</div>
              )}
            </div>
            <p className="mt-4 text-center text-sm text-muted">
              Scan with {CLIENT_TABS.find((t) => t.key === activeTab)?.label}
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
                  onClick={(e) => { (e.target as HTMLInputElement).select(); copyToClipboard(selectedUrl, `sub-${activeTab}`); }}
                  className="flex-1 cursor-pointer select-all rounded-xl border border-line/80 bg-card/80 px-3 py-2 font-mono text-xs text-foreground sm:text-sm"
                />
                <Button variant="secondary" onClick={() => copyToClipboard(selectedUrl, `sub-${activeTab}`)}>
                  {copied === `sub-${activeTab}` ? <CheckCircle className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            {deepLink && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => window.open(deepLink, '_blank', 'noopener,noreferrer')}
              >
                <Smartphone className="mr-2 h-4 w-4" />
                One-Click Import
              </Button>
            )}

            {appsForPlatform.length > 0 ? (
              <details className="rounded-2xl border border-line/70 bg-panel/55 p-4">
                <summary className="cursor-pointer text-sm font-semibold text-foreground">
                  Add to app (platform)
                </summary>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(['android', 'ios', 'windows'] as Platform[]).map((entry) => (
                    <button
                      key={entry}
                      onClick={() => setPlatform(entry)}
                      className={`rounded-xl px-3 py-2 text-sm font-semibold transition ${
                        platform === entry
                          ? 'bg-brand-500 text-white shadow-soft'
                          : 'border border-line/70 bg-card/70 text-muted hover:text-foreground'
                      }`}
                    >
                      {entry === 'android' ? 'Android' : null}
                      {entry === 'ios' ? 'iOS' : null}
                      {entry === 'windows' ? 'Desktop' : null}
                    </button>
                  ))}
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {appsForPlatform.map((app) => {
                    const copyKey = `app-${app.id}`;
                    return (
                      <div key={app.id} className="rounded-2xl border border-line/70 bg-card/65 p-4">
                        <div className="flex items-start gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-line/70 bg-panel text-xl">
                            {app.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-foreground">{app.name}</p>
                            <p className="mt-1 text-xs text-muted">{app.description}</p>
                          </div>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-2">
                          {app.importUrl ? (
                            <Button className="w-full" onClick={() => { window.location.href = app.importUrl as string; }}>
                              <Smartphone className="mr-2 h-4 w-4" />
                              One-Click
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              className="w-full"
                              onClick={() => copyToClipboard(app.manualUrl, `manual-${app.id}`)}
                            >
                              <Copy className="mr-2 h-4 w-4" />
                              Copy URL
                            </Button>
                          )}

                          <div className="flex gap-2">
                            <Button
                              variant="ghost"
                              className="flex-1 justify-center"
                              onClick={() => copyToClipboard(app.manualUrl, copyKey)}
                            >
                              {copied === copyKey ? <CheckCircle className="mr-2 h-4 w-4 text-emerald-500" /> : <Copy className="mr-2 h-4 w-4" />}
                              {copied === copyKey ? 'Copied' : 'Copy'}
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                if (!app.storeLink) return;
                                window.open(app.storeLink, '_blank', 'noopener,noreferrer');
                              }}
                              disabled={!app.storeLink}
                              aria-label="Open app download page"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            ) : null}
          </div>
        </div>
      )}

      {data.links && data.links.length > 0 && (
      <div className="mb-4 border-t border-line/70 pt-6">
        <h3 className="mb-4 text-lg font-semibold text-foreground">Individual Protocol Links</h3>
        <div className="space-y-3">
          {data.links.map((link: SubscriptionLink) => (
            <LinkCard
              key={link.inboundId}
              link={link}
              expanded={expandedQr.has(link.inboundId)}
              copied={copied}
              onToggleQr={() => toggleQr(link.inboundId)}
              onCopy={(text, key) => copyToClipboard(text, key)}
            />
          ))}
        </div>
      </div>
      )}

      <div className="flex flex-wrap gap-3 border-t border-line/70 pt-4">
        <Button variant="secondary" onClick={handleDownloadAll} disabled={!data.links?.length}>
          <Download className="mr-2 h-4 w-4" />
          Download All Links
        </Button>

        {data.shareUrl && (
          <Button
            variant="secondary"
            onClick={() => {
              copyToClipboard(data.shareUrl, 'share');
              setShowShareQr((prev) => !prev);
            }}
          >
            <Share2 className="mr-2 h-4 w-4" />
            {copied === 'share' ? 'Copied' : 'Share'}
          </Button>
        )}
      </div>

      {showShareQr && data.shareUrl && (
        <div className="mt-4 flex flex-col items-center rounded-2xl border border-line/70 bg-panel/55 p-5">
          <div className="rounded-2xl border border-line/70 bg-white p-4">
            <QRCodeSVG value={data.shareUrl} size={180} level="M" includeMargin={false} />
          </div>
          <p className="mt-3 text-center text-sm text-muted">Scan to open share page</p>
          <p className="mt-1 break-all text-center font-mono text-xs text-muted">{data.shareUrl}</p>
        </div>
      )}
    </Card>
  );
};

interface LinkCardProps {
  link: SubscriptionLink;
  expanded: boolean;
  copied: string;
  onToggleQr: () => void;
  onCopy: (text: string, key: string) => void;
}

const LinkCard: React.FC<LinkCardProps> = ({ link, expanded, copied, onToggleQr, onCopy }) => {
  const copyKey = `link-${link.inboundId}`;

  return (
    <div className="rounded-xl border border-line/70 bg-panel/55 p-4">
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
        <Button size="sm" variant="secondary" onClick={() => onCopy(link.url, copyKey)}>
          {copied === copyKey ? <CheckCircle className="mr-1.5 h-3.5 w-3.5 text-emerald-500" /> : <Copy className="mr-1.5 h-3.5 w-3.5" />}
          {copied === copyKey ? 'Copied' : 'Copy'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onToggleQr}>
          <QrCode className="mr-1.5 h-3.5 w-3.5" />
          QR
          {expanded ? <ChevronUp className="ml-1 h-3.5 w-3.5" /> : <ChevronDown className="ml-1 h-3.5 w-3.5" />}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => window.open(link.url, '_blank', 'noopener,noreferrer')}
        >
          <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
          Open
        </Button>
      </div>

      {expanded && (
        <div className="mt-4 flex justify-center">
          <div className="rounded-xl border border-line/70 bg-white p-3">
            <QRCodeSVG value={link.url} size={180} level="M" includeMargin={false} />
          </div>
        </div>
      )}
    </div>
  );
};
