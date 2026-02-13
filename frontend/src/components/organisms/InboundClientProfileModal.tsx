import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, Download, QrCode, RefreshCw, X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useQuery } from '@tanstack/react-query';
import JSZip from 'jszip';

import apiClient from '../../api/client';
import { API_URL } from '../../api/client';
import { useAuthStore } from '../../store/authStore';
import type { Inbound } from '../../types';
import {
  buildInboundClientTemplates,
  filterInboundTemplatesByPreset,
  type TemplatePreset
} from '../../utils/inboundClientTemplates';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { Spinner } from '../atoms/Spinner';

interface InboundClientProfileModalProps {
  inbound: Inbound;
  initialUserId?: number;
  onClose: () => void;
}

export const InboundClientProfileModal: React.FC<InboundClientProfileModalProps> = ({ inbound, initialUserId, onClose }) => {
  const token = useAuthStore((state) => state.token);
  const [selectedPreset, setSelectedPreset] = useState<TemplatePreset>('full');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<number | null>(initialUserId ?? null);
  const [copied, setCopied] = useState(false);
  const [packaging, setPackaging] = useState(false);
  const [packagingAllUsers, setPackagingAllUsers] = useState(false);
  const fallbackTemplates = useMemo(
    () => filterInboundTemplatesByPreset(buildInboundClientTemplates(inbound), selectedPreset),
    [inbound, selectedPreset]
  );

  const {
    data: templateResponse,
    isLoading,
    isError,
    isFetching,
    refetch
  } = useQuery({
    queryKey: ['inbound-client-templates', inbound.id, selectedUserId, selectedPreset],
    queryFn: async () => {
      const response = await apiClient.get(`/inbounds/${inbound.id}/client-templates`, {
        params: {
          ...(selectedUserId ? { userId: selectedUserId } : {}),
          ...(selectedPreset !== 'full' ? { preset: selectedPreset } : {})
        }
      });
      return response.data;
    }
  });

  const templates = templateResponse?.templates || fallbackTemplates;
  const users = templateResponse?.users || [];
  const resolvedUser = templateResponse?.user || null;

  useEffect(() => {
    if (templates.length === 0) {
      setSelectedTemplateId('');
      return;
    }

    if (!templates.some((item: { id: string }) => item.id === selectedTemplateId)) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [templates, selectedTemplateId]);

  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId) || templates[0];

  useEffect(() => {
    setSelectedUserId(initialUserId ?? null);
  }, [initialUserId, inbound.id]);

  const copyTemplate = async () => {
    if (!selectedTemplate) {
      return;
    }

    await navigator.clipboard.writeText(selectedTemplate.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const downloadTemplate = () => {
    if (!selectedTemplate) {
      return;
    }

    const blob = new Blob([selectedTemplate.content], { type: selectedTemplate.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${inbound.tag || inbound.protocol.toLowerCase()}-${selectedTemplate.id}.${selectedTemplate.extension}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toSafeFilename = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');

  const downloadLocalPack = async () => {
    if (!templates.length) {
      return;
    }

    const zip = new JSZip();
    const userLabel = resolvedUser?.email || `user-${selectedUserId || 'auto'}`;
    const root = `${toSafeFilename(inbound.tag || inbound.protocol.toLowerCase())}-${toSafeFilename(userLabel)}`;

    const readmeLines = [
      'One-UI Client Template Package',
      '',
      `Inbound: ${inbound.remark || inbound.tag || inbound.protocol}`,
      `Protocol: ${inbound.protocol}`,
      `Server: ${inbound.serverAddress}:${inbound.port}`,
      `User: ${resolvedUser?.email || 'auto-selected'}`,
      '',
      'Notes:',
      '- These files are generated from One-UI inbound settings.',
      '- Some protocols may still need client-side substitutions.',
      '- Verify TLS/SNI and transport options in your client after import.'
    ];

    zip.file(`${root}/README.txt`, readmeLines.join('\n'));

    templates.forEach((template, index) => {
      const fileName = `${String(index + 1).padStart(2, '0')}-${toSafeFilename(template.id)}.${template.extension}`;
      zip.file(`${root}/${fileName}`, template.content);
    });

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${root}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPackage = async () => {
    if (!templates.length || packaging) {
      return;
    }

    setPackaging(true);
    try {
      if (!token) {
        throw new Error('Missing auth token');
      }

      const params = new URLSearchParams();
      if (selectedUserId) {
        params.set('userId', String(selectedUserId));
      }
      if (selectedPreset !== 'full') {
        params.set('preset', selectedPreset);
      }

      const url = `${API_URL.replace(/\/$/, '')}/inbounds/${inbound.id}/client-templates/pack${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Server pack failed (${response.status})`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || `${toSafeFilename(inbound.tag || inbound.protocol.toLowerCase())}.zip`;

      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(downloadUrl);
    } catch {
      await downloadLocalPack();
    } finally {
      setPackaging(false);
    }
  };

  const downloadAllUsersPackage = async () => {
    if (packagingAllUsers) {
      return;
    }

    setPackagingAllUsers(true);
    try {
      if (!token) {
        throw new Error('Missing auth token');
      }

      const params = new URLSearchParams();
      if (selectedPreset !== 'full') {
        params.set('preset', selectedPreset);
      }

      const url = `${API_URL.replace(/\/$/, '')}/inbounds/${inbound.id}/client-templates/pack/all-users${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        throw new Error(`Server all-users pack failed (${response.status})`);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') || '';
      const filenameMatch = disposition.match(/filename="([^"]+)"/i);
      const filename = filenameMatch?.[1] || `${toSafeFilename(inbound.tag || inbound.protocol.toLowerCase())}-all-users.zip`;

      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(downloadUrl);
    } finally {
      setPackagingAllUsers(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="my-6 w-full max-w-5xl overflow-hidden rounded-2xl border border-line/80 bg-card/95 shadow-soft">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line/80 bg-card/95 px-5 py-4">
          <div>
            <h2 className="text-xl font-bold text-foreground">Client Config Templates</h2>
            <p className="mt-1 text-xs text-muted">
              {inbound.protocol} · {inbound.remark || inbound.tag} · {inbound.serverAddress}:{inbound.port}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-muted transition hover:bg-card hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-4 p-5 lg:grid-cols-[290px_1fr]">
          <aside className="space-y-2 rounded-xl border border-line/70 bg-panel/60 p-2">
            <div className="rounded-lg border border-line/70 bg-card/70 p-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">User Context</label>
              <select
                value={selectedUserId === null ? '' : String(selectedUserId)}
                onChange={(event) => {
                  const raw = event.target.value;
                  setSelectedUserId(raw ? Number(raw) : null);
                }}
                className="w-full rounded-lg border border-line/70 bg-card/80 px-2 py-2 text-xs text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
              >
                <option value="">Auto (active user)</option>
                {users.map((user: { id: number; email: string; status: string }) => (
                  <option key={user.id} value={user.id}>
                    {user.email} ({user.status})
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="mt-2 w-full"
                onClick={() => {
                  void refetch();
                }}
                loading={isFetching}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>

            <div className="rounded-lg border border-line/70 bg-card/70 p-2">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-muted">Export Preset</label>
              <select
                value={selectedPreset}
                onChange={(event) => {
                  setSelectedPreset(event.target.value as TemplatePreset);
                }}
                className="w-full rounded-lg border border-line/70 bg-card/80 px-2 py-2 text-xs text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
              >
                <option value="full">Full (all templates)</option>
                <option value="v2ray">V2Ray / Generic</option>
                <option value="clash">Clash Meta</option>
                <option value="singbox">Sing-box</option>
                <option value="xray">Xray Core JSON</option>
              </select>
            </div>

            {templates.map((template) => {
              const active = template.id === selectedTemplate?.id;
              return (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => {
                    setSelectedTemplateId(template.id);
                    setCopied(false);
                  }}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    active
                      ? 'border-brand-400/60 bg-brand-500/15 text-foreground'
                      : 'border-line/60 bg-card/65 text-muted hover:text-foreground'
                  }`}
                >
                  <p className="text-sm font-semibold">{template.title}</p>
                  <p className="mt-1 text-xs">{template.description}</p>
                </button>
              );
            })}
          </aside>

          <section className="space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-10">
                <Spinner />
              </div>
            ) : null}

            {isError ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-300">
                Could not fetch server-generated templates. Showing local fallback templates.
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="info">{inbound.protocol}</Badge>
                <span className="text-sm font-semibold text-foreground">{selectedTemplate?.title}</span>
                {resolvedUser ? <Badge variant="success">{resolvedUser.email}</Badge> : null}
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={copyTemplate}>
                  {copied ? <CheckCircle2 className="mr-2 h-4 w-4 text-emerald-500" /> : <Copy className="mr-2 h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={downloadTemplate}>
                  <Download className="mr-2 h-4 w-4" />
                  Download
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => { void downloadPackage(); }} loading={packaging}>
                  <Download className="mr-2 h-4 w-4" />
                  Download Pack
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => { void downloadAllUsersPackage(); }} loading={packagingAllUsers}>
                  <Download className="mr-2 h-4 w-4" />
                  All Users Pack
                </Button>
              </div>
            </div>

            <pre className="max-h-[52vh] overflow-auto rounded-xl border border-line/70 bg-card/80 p-3 text-xs text-foreground">
              {selectedTemplate?.content || 'No template available'}
            </pre>

            {selectedTemplate?.qrValue ? (
              <div className="rounded-xl border border-line/70 bg-panel/60 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <QrCode className="h-4 w-4 text-brand-500" />
                  <p className="text-sm font-semibold text-foreground">QR Preview</p>
                </div>
                <div className="w-fit rounded-lg border border-line/70 bg-white p-2">
                  <QRCodeSVG value={selectedTemplate.qrValue} size={154} />
                </div>
              </div>
            ) : null}

            <p className="text-xs text-muted">
              Replace placeholders like <code>{'{UUID}'}</code>, <code>{'{PASSWORD}'}</code>, and <code>{'{WG_PRIVATE_KEY}'}</code> before use.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};
