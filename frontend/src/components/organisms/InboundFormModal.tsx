import React from 'react';
import { useForm } from 'react-hook-form';
import { AlertTriangle, Info, Plus, Shuffle, Trash2, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { useTranslation } from 'react-i18next';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import apiClient from '../../api/client';
import { inboundTemplates } from '../../data/inboundTemplates';
import { useToast } from '../../hooks/useToast';
import { copyTextToClipboard } from '../../utils/clipboard';
import { RealitySettings } from './RealitySettings';
import { getPublicIp } from '../../api/system';
import type { Inbound } from '../../types';

interface InboundFormModalProps {
  inbound?: Inbound;
  initialValues?: Partial<FormData>;
  onClose: () => void;
  onSuccess: () => void;
}

interface FormData {
  port: number;
  protocol: 'VLESS' | 'VMESS' | 'TROJAN' | 'SHADOWSOCKS' | 'SOCKS' | 'HTTP' | 'DOKODEMO_DOOR' | 'WIREGUARD' | 'MTPROTO';
  tag: string;
  remark?: string;
  network: 'TCP' | 'WS' | 'GRPC' | 'HTTP' | 'HTTPUPGRADE' | 'XHTTP';
  security: 'NONE' | 'TLS' | 'REALITY';
  serverAddress: string;
  serverName?: string;
  wsPath?: string;
  wsHost?: string;
  xhttpMode?: string;
  grpcServiceName?: string;
  alpn?: string;
  cipher?: string;
  // REALITY fields
  realityPublicKey?: string;
  realityPrivateKey?: string;
  realityShortId?: string;
  realityServerName?: string;
  realityFingerprint?: string;
  realityDest?: string;
  realitySpiderX?: string;
  // Wireguard fields
  wgPublicKey?: string;
  wgPrivateKey?: string;
  wgAddress?: string;
  wgPeerPublicKey?: string;
  wgPeerEndpoint?: string;
  wgAllowedIPs?: string;
  wgMtu?: number;
  dokodemoTargetPort?: number;
  dokodemoNetwork?: string;
  dokodemoFollowRedirect?: boolean;
  // Multiple domains
  domains?: string[] | string;
  fallbacks?: string;
}

interface FallbackRow {
  id: string;
  dest: string;
  path: string;
  alpn: string;
  name: string;
  xver: string;
}

const createFallbackRow = (overrides?: Partial<FallbackRow>): FallbackRow => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  dest: '',
  path: '',
  alpn: '',
  name: '',
  xver: '',
  ...overrides
});

const toFallbackRows = (value: unknown): FallbackRow[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const fallback = entry as {
        dest?: unknown;
        path?: unknown;
        alpn?: unknown;
        name?: unknown;
        xver?: unknown;
      };
      return createFallbackRow({
        dest: fallback.dest ? String(fallback.dest) : '',
        path: fallback.path ? String(fallback.path) : '',
        name: fallback.name ? String(fallback.name) : '',
        xver: fallback.xver !== undefined && fallback.xver !== null ? String(fallback.xver) : '',
        alpn: Array.isArray(fallback.alpn)
          ? fallback.alpn.map((entryValue) => String(entryValue).trim()).filter(Boolean).join(',')
          : (fallback.alpn ? String(fallback.alpn) : '')
      });
    });
};

const rowsToFallbackPayload = (rows: FallbackRow[]) => {
  return rows
    .map((row) => {
      const dest = row.dest.trim();
      const path = row.path.trim();
      const name = row.name.trim();
      const xverRaw = row.xver.trim();
      const alpnValues = row.alpn
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);

      if (!dest) {
        return null;
      }

      const payload: {
        dest: string;
        path?: string;
        name?: string;
        alpn?: string[];
        xver?: number;
      } = { dest };

      if (path) {
        payload.path = path;
      }

      if (name) {
        payload.name = name;
      }

      if (alpnValues.length > 0) {
        payload.alpn = alpnValues;
      }

      if (xverRaw) {
        const parsed = Number.parseInt(xverRaw, 10);
        if (!Number.isNaN(parsed)) {
          payload.xver = parsed;
        }
      }

      return payload;
    })
    .filter((entry): entry is { dest: string; path?: string; name?: string; alpn?: string[]; xver?: number } => Boolean(entry));
};

export const InboundFormModal: React.FC<InboundFormModalProps> = ({
  inbound,
  initialValues,
  onClose,
  onSuccess
}) => {
  const toast = useToast();
  const { t } = useTranslation();
  const [realityTemplateCopied, setRealityTemplateCopied] = React.useState(false);
  const isEdit = !!inbound;
  const inboundDomains = (inbound as (Inbound & { domains?: string[] }) | undefined)?.domains;
  const inboundFallbacks = (inbound as (Inbound & { fallbacks?: unknown[] }) | undefined)?.fallbacks;
  const [fallbackRows, setFallbackRows] = React.useState<FallbackRow[]>(() => toFallbackRows(inboundFallbacks));

  const { register, handleSubmit, setValue, getValues, watch, formState: { errors } } = useForm<FormData>({
    defaultValues: inbound ? {
      ...inbound,
      realityShortId: Array.isArray(inbound.realityShortIds) ? inbound.realityShortIds.join(',') : undefined,
      realityServerName: Array.isArray(inbound.realityServerNames) ? inbound.realityServerNames.join(',') : undefined,
      domains: inboundDomains ? inboundDomains.join(', ') : undefined,
      fallbacks: inboundFallbacks && inboundFallbacks.length > 0 ? JSON.stringify(inboundFallbacks, null, 2) : ''
    } : {
      protocol: 'VLESS',
      network: 'TCP',
      security: 'NONE',
      alpn: '["h2","http/1.1"]',
      ...initialValues
    }
  });

  const protocol = watch('protocol');
  const network = watch('network');
  const security = watch('security');
  const serverNameValue = watch('serverName');
  const wsPath = watch('wsPath');
  const wsHost = watch('wsHost');
  const grpcServiceName = watch('grpcServiceName');
  const xhttpMode = watch('xhttpMode');
  const realityPublicKey = watch('realityPublicKey');
  const realityPrivateKey = watch('realityPrivateKey');
  const realityShortId = watch('realityShortId');
  const realityServerName = watch('realityServerName');
  const realityFingerprint = watch('realityFingerprint');
  const realitySpiderX = watch('realitySpiderX');
  const tagValue = watch('tag');
  const dokodemoTargetPort = watch('dokodemoTargetPort');
  const dokodemoNetwork = watch('dokodemoNetwork');
  const isDokodemo = protocol === 'DOKODEMO_DOOR';
  const supportsTransport = ['VLESS', 'VMESS', 'TROJAN', 'SHADOWSOCKS'].includes(protocol);
  const supportsTls = ['VLESS', 'VMESS', 'TROJAN', 'SHADOWSOCKS'].includes(protocol);
  const supportsReality = protocol === 'VLESS';
  const supportsFallbacks = ['VLESS', 'TROJAN'].includes(protocol);

  const wgPrivateKey = watch('wgPrivateKey');
  const wgPeerPublicKey = watch('wgPeerPublicKey');
  const wgPublicKey = watch('wgPublicKey');
  const wgPeerEndpoint = watch('wgPeerEndpoint');
  const serverAddress = watch('serverAddress');
  const port = watch('port');
  const wgAllowedIPs = watch('wgAllowedIPs');
  const wgMtu = watch('wgMtu');
  const wgAddress = watch('wgAddress');
  React.useEffect(() => {
    if (isEdit) {
      return;
    }

    const currentServerAddress = String(getValues('serverAddress') || '').trim();
    if (!currentServerAddress || currentServerAddress === 'your.domain.com') {
      getPublicIp()
        .then((data) => {
          const defaultIp = data.ip || (typeof window !== 'undefined' ? window.location.hostname : '');
          if (defaultIp) {
            setValue('serverAddress', defaultIp, {
              shouldDirty: false,
              shouldTouch: false,
              shouldValidate: true
            });
          }
        })
        .catch(() => {
          if (typeof window !== 'undefined' && window.location.hostname) {
            setValue('serverAddress', window.location.hostname, {
              shouldDirty: false,
              shouldTouch: false,
              shouldValidate: true
            });
          }
        });
    }
  }, [getValues, isEdit, setValue]);

  React.useEffect(() => {
    setFallbackRows(toFallbackRows(inboundFallbacks));
  }, [inboundFallbacks]);

  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousPaddingRight = document.body.style.paddingRight;
    const scrollbarCompensation = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    if (scrollbarCompensation > 0) {
      document.body.style.paddingRight = `${scrollbarCompensation}px`;
    }

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.paddingRight = previousPaddingRight;
    };
  }, []);

  const fallbackPreview = React.useMemo(
    () => JSON.stringify(rowsToFallbackPayload(fallbackRows), null, 2),
    [fallbackRows]
  );

  const quickPresetTemplates = React.useMemo(() => {
    const categoryPriority: Record<(typeof inboundTemplates)[number]['category'], number> = {
      recommended: 0,
      cdn: 1,
      transport: 2,
      utility: 3
    };

    return [...inboundTemplates]
      .sort((left, right) => {
        const categoryDiff = categoryPriority[left.category] - categoryPriority[right.category];
        if (categoryDiff !== 0) {
          return categoryDiff;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, 12);
  }, []);

  const validationHints = React.useMemo(() => {
    const issues: string[] = [];
    const tips: string[] = [];

    if (!(serverAddress || '').trim()) {
      issues.push('Server address is required.');
    }

    if (protocol === 'TROJAN' && security !== 'TLS') {
      tips.push('Trojan always uses TLS. One-UI will enforce TLS on save.');
    }

    if (protocol === 'VLESS' && security === 'REALITY') {
      if (!(realityPublicKey || '').trim()) {
        issues.push('REALITY requires a Public Key.');
      }
      if (!(realityPrivateKey || '').trim()) {
        issues.push('REALITY requires a Private Key.');
      }
      if (!(serverNameValue || '').trim() && !(realityServerName || '').trim()) {
        issues.push('REALITY requires SNI or Reality Server Names.');
      }
      if (!(realityShortId || '').trim()) {
        tips.push('Set a REALITY Short ID for better client compatibility.');
      }
    }

    if (protocol === 'WIREGUARD') {
      if (!(wgPrivateKey || '').trim()) {
        issues.push('WireGuard requires a local Private Key.');
      }
      if (!(wgPeerPublicKey || '').trim()) {
        issues.push('WireGuard requires Peer Public Key.');
      }
      if (!(wgPeerEndpoint || '').trim()) {
        issues.push('WireGuard requires Peer Endpoint (host:port).');
      }
      if (!(wgAllowedIPs || '').trim()) {
        tips.push('Allowed IPs is empty; recommended: 0.0.0.0/0, ::/0');
      }
    }

    if (isDokodemo) {
      const targetPort = Number(dokodemoTargetPort);
      if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
        issues.push('Dokodemo-door requires a valid Target Port.');
      }
      if (!(dokodemoNetwork || '').trim()) {
        tips.push('Set Target Network (tcp/udp) explicitly for predictable routing.');
      }
    }

    if (supportsTransport && (network === 'WS' || network === 'HTTPUPGRADE' || network === 'XHTTP') && !(wsPath || '').trim()) {
      tips.push('Path is empty; define wsPath/xhttp path for client consistency.');
    }

    if (supportsTransport && network === 'GRPC' && !(grpcServiceName || '').trim()) {
      tips.push('gRPC Service Name is empty; most clients require a matching service name.');
    }

    if (security === 'TLS' && !(serverNameValue || '').trim()) {
      tips.push('TLS SNI is empty; set Server Name to avoid certificate mismatch.');
    }

    if (supportsFallbacks && security === 'TLS') {
      const invalidFallback = fallbackRows.some((row) => {
        const hasAnyValue = [row.dest, row.path, row.alpn, row.name, row.xver].some((field) => field.trim().length > 0);
        return hasAnyValue && !row.dest.trim();
      });

      if (invalidFallback) {
        issues.push('Each fallback row with values must include Dest.');
      } else if (fallbackRows.length === 0) {
        tips.push('Fallbacks are optional. Add them only if your routing requires fallback destinations.');
      }
    }

    return { issues, tips };
  }, [
    dokodemoNetwork,
    dokodemoTargetPort,
    grpcServiceName,
    isDokodemo,
    network,
    protocol,
    realityPrivateKey,
    realityPublicKey,
    realityShortId,
    security,
    serverAddress,
    serverNameValue,
    realityServerName,
    supportsTransport,
    supportsFallbacks,
    fallbackRows,
    wgAllowedIPs,
    wgPeerEndpoint,
    wgPeerPublicKey,
    wgPrivateKey,
    wsPath
  ]);

  const applyPreset = (preset: (typeof inboundTemplates)[number]) => {
    for (const [field, value] of Object.entries(preset.values)) {
      setValue(field as keyof FormData, value as never, {
        shouldDirty: true,
        shouldValidate: true
      });
    }
  };

  const addFallbackRow = () => {
    setFallbackRows((previous) => [...previous, createFallbackRow()]);
  };

  const removeFallbackRow = (rowId: string) => {
    setFallbackRows((previous) => previous.filter((row) => row.id !== rowId));
  };

  const updateFallbackRow = (rowId: string, field: keyof Omit<FallbackRow, 'id'>, value: string) => {
    setFallbackRows((previous) => previous.map((row) => {
      if (row.id !== rowId) {
        return row;
      }

      return {
        ...row,
        [field]: value
      };
    }));
  };

  const applyFallbackPreset = (presetType: 'multiplexer' | 'web' | 'shadowsocks') => {
    if (presetType === 'multiplexer') {
      setFallbackRows([
        { id: Math.random().toString(36).substring(7), path: '/api/v2/telemetry', dest: '10002', name: 'Internal VMess', alpn: '', xver: '1' },
        { id: Math.random().toString(36).substring(7), path: '', dest: '10001', name: 'Internal Trojan', alpn: 'h2', xver: '1' },
        { id: Math.random().toString(36).substring(7), path: '', dest: '80', name: 'Web Camouflage', alpn: '', xver: '0' }
      ]);
    } else if (presetType === 'shadowsocks') {
      setFallbackRows([
        { id: Math.random().toString(36).substring(7), path: '', dest: '10003', name: 'Internal Shadowsocks', alpn: '', xver: '1' },
        { id: Math.random().toString(36).substring(7), path: '', dest: '80', name: 'Web Camouflage', alpn: '', xver: '0' }
      ]);
    } else if (presetType === 'web') {
      setFallbackRows([
        { id: Math.random().toString(36).substring(7), path: '', dest: '80', name: 'Web Camouflage', alpn: '', xver: '0' }
      ]);
    }
  };

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      if (isEdit && inbound) {
        await apiClient.put(`/inbounds/${inbound.id}`, data);
      } else {
        await apiClient.post('/inbounds', data);
      }
    },
    onSuccess: () => {
      onSuccess();
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('inbounds.toast.saveFailed', { defaultValue: 'Failed to save inbound' })
      );
    }
  });

  const randomPortMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.get('/inbounds/random-port');
      return Number(response?.data?.port || 0);
    },
    onSuccess: (portValue) => {
      if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) {
        return;
      }

      setValue('port', portValue, { shouldDirty: true, shouldValidate: true });
      const currentTag = (getValues('tag') || '').trim();
      if (!currentTag) {
        setValue('tag', `${String(protocol).toLowerCase()}-${portValue}`, { shouldDirty: true, shouldValidate: true });
      }
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('inbounds.toast.randomPortFailed', { defaultValue: 'Failed to generate random port' })
      );
    }
  });

  const wireguardKeyGenMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.get('/inbounds/wireguard/keys');
      return response;
    },
    onSuccess: (payload: any) => {
      const keys = payload?.data || payload;
      if (keys?.privateKey) {
        setValue('wgPrivateKey', keys.privateKey, { shouldDirty: true, shouldValidate: true });
      }
      if (keys?.publicKey) {
        setValue('wgPublicKey', keys.publicKey, { shouldDirty: true, shouldValidate: true });
      }
      if (!getValues('wgAllowedIPs')) {
        setValue('wgAllowedIPs', '0.0.0.0/0, ::/0', { shouldDirty: true, shouldValidate: false });
      }
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('inbounds.toast.wireguardKeygenFailed', { defaultValue: 'Failed to generate WireGuard keys' })
      );
    }
  });

  const realityKeyGenMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/reality/generate-keys', {
        serverName: getValues('serverName') || undefined
      });
      return response;
    },
    onSuccess: (payload: any) => {
      const bundle = payload?.data || payload;

      if (bundle?.privateKey) {
        setValue('realityPrivateKey', bundle.privateKey, { shouldDirty: true, shouldValidate: true });
      }
      if (bundle?.publicKey) {
        setValue('realityPublicKey', bundle.publicKey, { shouldDirty: true, shouldValidate: true });
      }
      const generatedShortIds = Array.isArray(bundle?.shortIds)
        ? bundle.shortIds
        : (bundle?.shortId ? [bundle.shortId] : []);

      if (generatedShortIds.length > 0) {
        const existing = (getValues('realityShortId') || '').trim();
        const merged = [existing, generatedShortIds.join(',')]
          .filter(Boolean)
          .join(',')
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean);
        setValue('realityShortId', Array.from(new Set(merged)).join(','), { shouldDirty: true, shouldValidate: true });
      }
      if (!getValues('realityFingerprint')) {
        setValue('realityFingerprint', bundle?.fingerprint || 'chrome', { shouldDirty: true, shouldValidate: false });
      }
      if (!getValues('serverName')) {
        setValue('serverName', bundle?.serverName || 'www.microsoft.com', { shouldDirty: true, shouldValidate: true });
      }
      if (!getValues('realityServerName') && bundle?.serverName) {
        setValue('realityServerName', bundle.serverName, { shouldDirty: true, shouldValidate: false });
      }
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('inbounds.toast.realityKeygenFailed', { defaultValue: 'Failed to generate REALITY keys' })
      );
    }
  });

  const onSubmit = (data: FormData) => {
    const formattedData: FormData = {
      ...data,
      domains: typeof data.domains === 'string'
        ? (data.domains as string).split(',').map((d: string) => d.trim()).filter(Boolean)
        : (Array.isArray(data.domains) ? data.domains : [])
    };

    const fallbackPayload = rowsToFallbackPayload(fallbackRows);
    formattedData.fallbacks = JSON.stringify(fallbackPayload);

    if (!supportsTransport) {
      formattedData.network = 'TCP';
      formattedData.security = 'NONE';
    }

    if (isDokodemo && !formattedData.dokodemoTargetPort) {
      formattedData.dokodemoTargetPort = 80;
    }

    if (!supportsTls && formattedData.security === 'TLS') {
      formattedData.security = 'NONE';
    }

    if (!supportsReality && formattedData.security === 'REALITY') {
      formattedData.security = 'NONE';
    }

    if (formattedData.protocol === 'TROJAN') {
      formattedData.security = 'TLS';
    }

    if (formattedData.security === 'REALITY') {
      const shortIds = typeof formattedData.realityShortId === 'string'
        ? formattedData.realityShortId
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
        : [];
      formattedData.realityShortId = shortIds.join(',');

      const serverNames = typeof formattedData.realityServerName === 'string'
        ? formattedData.realityServerName
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean)
        : [];
      formattedData.realityServerName = serverNames.join(',');

      if (!formattedData.serverName && serverNames.length > 0) {
        formattedData.serverName = serverNames[0];
      }
    }

    mutation.mutate(formattedData as FormData);
  };

  const composePeerEndpoint = () => {
    const host = (serverAddress || '').trim();
    const current = (wgPeerEndpoint || '').trim();

    if (current) {
      return;
    }

    if (!host) {
      toast.warning(
        t('common.warning', { defaultValue: 'Warning' }),
        t('inbounds.toast.missingServerAddress', { defaultValue: 'Set Server Address first.' })
      );
      return;
    }

    const inboundPort = Number(port);
    const resolvedPort = Number.isInteger(inboundPort) && inboundPort > 0 ? inboundPort : 51820;
    setValue('wgPeerEndpoint', `${host}:${resolvedPort}`, { shouldDirty: true, shouldValidate: true });
  };

  const resolveWireguardConfigPreview = () => {
    if (protocol !== 'WIREGUARD') {
      return '';
    }

    const privateKey = (wgPrivateKey || '').trim();
    const peerPublicKey = (wgPeerPublicKey || wgPublicKey || '').trim();
    const endpoint = (wgPeerEndpoint || '').trim();

    if (!privateKey || !peerPublicKey || !endpoint) {
      return '';
    }

    const address = (wgAddress || '').trim() || '10.66.2.2/32';
    const allowedIps = (wgAllowedIPs || '').trim() || '0.0.0.0/0, ::/0';
    const mtuValue = Number(wgMtu);
    const withMtu = Number.isInteger(mtuValue) && mtuValue > 0;

    const lines = [
      '[Interface]',
      `PrivateKey = ${privateKey}`,
      `Address = ${address}`,
      '',
      '[Peer]',
      `PublicKey = ${peerPublicKey}`,
      `Endpoint = ${endpoint}`,
      `AllowedIPs = ${allowedIps}`,
      'PersistentKeepalive = 25'
    ];

    if (withMtu) {
      lines.splice(3, 0, `MTU = ${mtuValue}`);
    }

    return lines.join('\n');
  };

  const wireguardConfigPreview = resolveWireguardConfigPreview();

  const resolveRealityLinkTemplate = () => {
    if (protocol !== 'VLESS' || security !== 'REALITY') {
      return '';
    }

    const host = (serverAddress || '').trim();
    const inboundPort = Number(port);
    const publicKey = (realityPublicKey || '').trim();

    if (!host || !Number.isInteger(inboundPort) || inboundPort < 1 || !publicKey) {
      return '';
    }

    const params = new URLSearchParams();
    const net = (network || 'TCP').toLowerCase();

    params.set('type', net);
    params.set('security', 'reality');
    const fallbackRealityServerName = (realityServerName || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)[0];
    params.set('sni', (serverNameValue || fallbackRealityServerName || host).trim());
    params.set('fp', (realityFingerprint || 'chrome').trim() || 'chrome');
    params.set('pbk', publicKey);
    params.set('flow', 'xtls-rprx-vision');

    const shortIds = (realityShortId || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (shortIds.length > 0) {
      params.set('sid', shortIds[0]);
    }

    if (realitySpiderX && String(realitySpiderX).trim()) {
      params.set('spx', String(realitySpiderX).trim());
    }

    if (network === 'WS' || network === 'HTTPUPGRADE' || network === 'XHTTP') {
      params.set('path', (wsPath || '/').trim() || '/');
      if (wsHost && String(wsHost).trim()) {
        params.set('host', String(wsHost).trim());
      }
      if (network === 'XHTTP' && xhttpMode && String(xhttpMode).trim()) {
        params.set('mode', String(xhttpMode).trim());
      }
    } else if (network === 'GRPC') {
      params.set('serviceName', (grpcServiceName || '').trim());
      params.set('mode', 'gun');
    }

    const remark = encodeURIComponent((tagValue || 'vless-reality').trim() || 'vless-reality');
    return `vless://{UUID}@${host}:${inboundPort}?${params.toString()}#${remark}`;
  };

  const realityLinkTemplate = resolveRealityLinkTemplate();

  const copyRealityTemplate = async () => {
    if (!realityLinkTemplate) {
      return;
    }

    const copiedOk = await copyTextToClipboard(realityLinkTemplate);
    if (!copiedOk) {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        t('inbounds.toast.copyRealityTemplateFailed', { defaultValue: 'Failed to copy template' })
      );
      return;
    }
    setRealityTemplateCopied(true);
    window.setTimeout(() => setRealityTemplateCopied(false), 1600);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/45 p-2 backdrop-blur-sm sm:p-4"
      style={{ WebkitOverflowScrolling: 'touch' }}
    >
      <div className="flex min-h-full items-end justify-center sm:items-center">
        <div className="my-2 flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl glass-card sm:my-4 sm:max-h-[calc(100dvh-2rem)]">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line/50 bg-card/60 p-5 backdrop-blur-md">
            <h2 className="text-xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent sm:text-2xl">
              {isEdit ? 'Edit Inbound' : 'Add New Inbound'}
            </h2>
            <button
              onClick={onClose}
              className="rounded-xl p-2 text-muted transition-all hover:bg-white/10 hover:text-foreground active:scale-95"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <form
            onSubmit={handleSubmit(onSubmit)}
            className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-5 pb-28 pt-5 sm:px-6 sm:pb-32 sm:pt-6"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {!isEdit ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-foreground">Quick Presets</h3>
                  <span className="text-xs text-muted">One-click inbound wizard</span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {quickPresetTemplates.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="rounded-xl border border-line/80 bg-card/70 p-3 text-left transition hover:border-brand-400/55 hover:bg-card"
                    >
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold text-foreground">{preset.name}</p>
                        <span className="rounded-md border border-line/70 bg-panel/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/90">
                          {preset.values.protocol}
                        </span>
                        <span className="rounded-md border border-line/70 bg-panel/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/90">
                          {preset.values.network}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-muted">{preset.description}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {preset.highlights.slice(0, 3).map((highlight) => (
                          <span
                            key={`${preset.id}-${highlight}`}
                            className="rounded-md border border-brand-500/20 bg-brand-500/10 px-1.5 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300"
                          >
                            {highlight}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {(validationHints.issues.length > 0 || validationHints.tips.length > 0) ? (
              <div className="rounded-xl border border-line/70 bg-panel/55 p-4">
                <div className="mb-3 flex items-center gap-2">
                  {validationHints.issues.length > 0 ? (
                    <AlertTriangle className="h-4 w-4 text-amber-500" />
                  ) : (
                    <Info className="h-4 w-4 text-brand-500" />
                  )}
                  <p className="text-sm font-semibold text-foreground">Validation Guide</p>
                </div>

                {validationHints.issues.map((issue) => (
                  <p key={`issue-${issue}`} className="mb-1 text-xs text-red-500">
                    • {issue}
                  </p>
                ))}
                {validationHints.tips.map((tip) => (
                  <p key={`tip-${tip}`} className="mb-1 text-xs text-muted">
                    • {tip}
                  </p>
                ))}
              </div>
            ) : null}

            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground">Basic Settings</h3>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-muted">
                    Protocol *
                  </label>
                  <select
                    {...register('protocol', { required: 'Protocol is required' })}
                    className="w-full rounded-xl border border-line/60 bg-card/60 px-4 py-2.5 text-sm sm:text-base text-foreground backdrop-blur-md outline-none transition-all duration-300 focus:bg-card/90 focus:border-brand-500/60 focus:ring-4 focus:ring-brand-500/10 focus:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                  >
                    <option value="VLESS">VLESS</option>
                    <option value="VMESS">VMess</option>
                    <option value="TROJAN">Trojan</option>
                    <option value="SHADOWSOCKS">Shadowsocks</option>
                    <option value="SOCKS">SOCKS5</option>
                    <option value="HTTP">HTTP Proxy</option>
                    <option value="DOKODEMO_DOOR">Dokodemo-door</option>
                    <option value="WIREGUARD">Wireguard</option>
                    <option value="MTPROTO">MTProto (Telegram)</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <Input
                    label="Port *"
                    type="number"
                    {...register('port', {
                      required: 'Port is required',
                      min: { value: 1, message: 'Port must be between 1-65535' },
                      max: { value: 65535, message: 'Port must be between 1-65535' }
                    })}
                    error={errors.port?.message}
                    placeholder="443"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => randomPortMutation.mutate()}
                    loading={randomPortMutation.isPending}
                  >
                    <Shuffle className="mr-2 h-4 w-4" />
                    Random Free Port
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label="Tag *"
                  {...register('tag', { required: 'Tag is required' })}
                  error={errors.tag?.message}
                  placeholder="vless-ws-tls"
                />

                <Input
                  label="Remark"
                  {...register('remark')}
                  placeholder="My VLESS Inbound"
                />
              </div>

              <Input
                label={isDokodemo ? 'Target Address *' : 'Server Address *'}
                {...register('serverAddress', { required: 'Server address is required' })}
                error={errors.serverAddress?.message}
                placeholder={isDokodemo ? '127.0.0.1' : 'your.domain.com or IP'}
              />

              <div>
                <label className="mb-2 block text-sm font-medium text-muted">
                  Additional Domains
                </label>
                <Input
                  placeholder="cdn.domain.com, worker.domain.com (comma separated)"
                  {...register('domains')}
                />
                <p className="mt-1 text-xs text-muted">
                  Optional: Comma-separated list of additional domains for this inbound.
                </p>
              </div>
            </div>

            {isDokodemo ? (
              <div className="space-y-4 rounded-xl border border-line/70 bg-panel/50 p-4">
                <h3 className="text-lg font-semibold text-foreground">Dokodemo-door Settings</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    label="Target Port *"
                    type="number"
                    {...register('dokodemoTargetPort', {
                      valueAsNumber: true,
                      min: { value: 1, message: 'Target port must be between 1-65535' },
                      max: { value: 65535, message: 'Target port must be between 1-65535' }
                    })}
                    error={errors.dokodemoTargetPort?.message}
                    placeholder="80"
                  />

                  <Input
                    label="Target Network"
                    {...register('dokodemoNetwork')}
                    placeholder="tcp,udp"
                  />
                </div>

                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    {...register('dokodemoFollowRedirect')}
                    className="h-4 w-4 rounded border-line bg-card"
                  />
                  Follow redirect
                </label>
              </div>
            ) : null}

            {supportsTransport ? (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground">Network Settings</h3>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-muted">
                      Network *
                    </label>
                    <select
                      {...register('network', { required: 'Network is required' })}
                      className="w-full rounded-xl border border-line/60 bg-card/60 px-4 py-2.5 text-sm sm:text-base text-foreground backdrop-blur-md outline-none transition-all duration-300 focus:bg-card/90 focus:border-brand-500/60 focus:ring-4 focus:ring-brand-500/10 focus:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                    >
                      <option value="TCP">TCP</option>
                      <option value="WS">WebSocket</option>
                      <option value="HTTPUPGRADE">HTTP Upgrade</option>
                      <option value="XHTTP">XHTTP</option>
                      <option value="GRPC">gRPC</option>
                      <option value="HTTP">HTTP/2</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-muted">
                      Security *
                    </label>
                    <select
                      {...register('security', { required: 'Security is required' })}
                      className="w-full rounded-xl border border-line/60 bg-card/60 px-4 py-2.5 text-sm sm:text-base text-foreground backdrop-blur-md outline-none transition-all duration-300 focus:bg-card/90 focus:border-brand-500/60 focus:ring-4 focus:ring-brand-500/10 focus:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                    >
                      <option value="NONE">None</option>
                      {supportsTls ? <option value="TLS">TLS</option> : null}
                      {supportsReality ? <option value="REALITY">REALITY</option> : null}
                    </select>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-line/80 bg-panel/50 p-3 text-sm text-muted">
                This protocol uses direct listener mode. Network and TLS settings are not required.
              </div>
            )}

            {security === 'TLS' && supportsTls && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground">TLS Settings</h3>

                <Input
                  label="Server Name (SNI)"
                  {...register('serverName')}
                  placeholder="your.domain.com"
                />

                <div>
                  <label className="mb-2 block text-sm font-medium text-muted">
                    ALPN (JSON Array)
                  </label>
                  <input
                    {...register('alpn')}
                    className="w-full rounded-xl border border-line/80 bg-card/75 px-3 py-2 font-mono text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
                    placeholder='["h2","http/1.1"]'
                  />
                  <p className="mt-1 text-xs text-muted">
                    Example: ["h2","http/1.1"] or ["h2"]
                  </p>
                </div>

                {supportsFallbacks ? (
                  <div className="space-y-3 rounded-xl border border-line/70 bg-panel/55 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">Fallbacks</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={addFallbackRow}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Fallback
                      </Button>
                    </div>

                    {fallbackRows.length === 0 ? (
                      <p className="text-xs text-muted">
                        No fallbacks configured. Add fallback rows only when you need path/destination based routing.
                      </p>
                    ) : null}

                    {fallbackRows.map((row) => (
                      <div key={row.id} className="space-y-3 rounded-xl border border-line/70 bg-card/70 p-3">
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <div>
                            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Dest *</label>
                            <input
                              value={row.dest}
                              onChange={(event) => updateFallbackRow(row.id, 'dest', event.target.value)}
                              className="w-full rounded-lg border border-line/70 bg-card/80 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
                              placeholder="3001 or 127.0.0.1:3001"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Path</label>
                            <input
                              value={row.path}
                              onChange={(event) => updateFallbackRow(row.id, 'path', event.target.value)}
                              className="w-full rounded-lg border border-line/70 bg-card/80 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
                              placeholder="/ws"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Name</label>
                            <input
                              value={row.name}
                              onChange={(event) => updateFallbackRow(row.id, 'name', event.target.value)}
                              className="w-full rounded-lg border border-line/70 bg-card/80 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
                              placeholder="fallback-api"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">ALPN</label>
                            <input
                              value={row.alpn}
                              onChange={(event) => updateFallbackRow(row.id, 'alpn', event.target.value)}
                              className="w-full rounded-lg border border-line/70 bg-card/80 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
                              placeholder="h2,http/1.1"
                            />
                          </div>

                          <div>
                            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Xver</label>
                            <input
                              value={row.xver}
                              onChange={(event) => updateFallbackRow(row.id, 'xver', event.target.value)}
                              className="w-full rounded-lg border border-line/70 bg-card/80 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
                              placeholder="1"
                              inputMode="numeric"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => removeFallbackRow(row.id)}
                          >
                            <Trash2 className="mr-2 h-4 w-4 text-red-500" />
                            Remove
                          </Button>
                        </div>
                      </div>
                    ))}

                    <div>
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">JSON Preview</label>
                      <pre className="max-h-36 overflow-auto rounded-lg border border-line/70 bg-card/80 p-3 text-xs text-foreground">
                        {fallbackPreview}
                      </pre>
                    </div>

                    <div className="pt-2 border-t border-line/50">
                      <p className="mb-1 text-sm font-semibold text-foreground">Quick Fallback Presets</p>
                      <p className="mb-3 text-xs text-muted">Note: Users assigned to fallback destinations automatically inherit this Master Inbound's port and REALITY security.</p>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => applyFallbackPreset('multiplexer')}
                          className="bg-brand-500/10 text-brand-700 hover:bg-brand-500/20 border-brand-500/20"
                        >
                          Setup VLESS+VMess+Trojan Multiplexer
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => applyFallbackPreset('shadowsocks')}
                          className="bg-brand-500/5 text-brand-600 hover:bg-brand-500/15 border-brand-500/20"
                        >
                          Setup Shadowsocks Multiplexer
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => applyFallbackPreset('web')}
                        >
                          Nginx Web Camouflage (Port 80)
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {security === 'REALITY' && supportsReality && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold text-foreground">REALITY Settings</h3>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => realityKeyGenMutation.mutate()}
                    loading={realityKeyGenMutation.isPending}
                  >
                    Generate REALITY Keys
                  </Button>
                </div>

                <RealitySettings
                  register={register}
                  watch={watch}
                  setValue={setValue}
                  errors={errors}
                />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    label="Server Name (SNI) *"
                    {...register('serverName', { required: security === 'REALITY' ? 'SNI is required for REALITY' : false })}
                    placeholder="www.microsoft.com"
                  />

                  <div>
                    <label className="mb-2 block text-sm font-medium text-muted">
                      Fingerprint
                    </label>
                    <select
                      {...register('realityFingerprint')}
                      className="w-full rounded-xl border border-line/60 bg-card/60 px-4 py-2.5 text-sm sm:text-base text-foreground backdrop-blur-md outline-none transition-all duration-300 focus:bg-card/90 focus:border-brand-500/60 focus:ring-4 focus:ring-brand-500/10 focus:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                    >
                      <option value="chrome">Chrome</option>
                      <option value="firefox">Firefox</option>
                      <option value="safari">Safari</option>
                      <option value="ios">iOS</option>
                      <option value="android">Android</option>
                      <option value="edge">Edge</option>
                      <option value="random">Random</option>
                    </select>
                  </div>
                </div>

                <Input
                  label="Public Key *"
                  {...register('realityPublicKey', { required: security === 'REALITY' ? 'Public key is required' : false })}
                  placeholder="Enter REALITY public key"
                />

                <Input
                  label="Private Key *"
                  {...register('realityPrivateKey', { required: security === 'REALITY' ? 'Private key is required' : false })}
                  placeholder="Enter REALITY private key"
                />

                <Input
                  label="Short ID"
                  {...register('realityShortId')}
                  placeholder="e.g., 0123456789abcdef,abcdef0123456789"
                />

                <Input
                  label="Reality Server Names"
                  {...register('realityServerName')}
                  placeholder="www.microsoft.com,www.cloudflare.com"
                />

                {realityLinkTemplate ? (
                  <div className="space-y-3 rounded-xl border border-line/70 bg-panel/55 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-foreground">REALITY Link Template</p>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          void copyRealityTemplate();
                        }}
                      >
                        {realityTemplateCopied ? 'Copied' : 'Copy Template'}
                      </Button>
                    </div>
                    <pre className="max-h-44 overflow-auto rounded-lg border border-line/70 bg-card/80 p-3 text-xs text-foreground">
                      {realityLinkTemplate}
                    </pre>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="w-fit rounded-lg border border-line/70 bg-white p-2">
                        <QRCodeSVG value={realityLinkTemplate} size={132} />
                      </div>
                      <p className="text-xs text-muted">
                        Replace {'{UUID}'} with the user UUID for manual links, or use subscription URLs for automatic client import.
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    Enter server address, port, and REALITY keys to preview a share-link template.
                  </p>
                )}
              </div>
            )}

            {protocol === 'WIREGUARD' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-lg font-semibold text-foreground">Wireguard Settings</h3>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={composePeerEndpoint}
                    >
                      Auto Endpoint
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => wireguardKeyGenMutation.mutate()}
                      loading={wireguardKeyGenMutation.isPending}
                    >
                      Generate Key Pair
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    label="Private Key *"
                    {...register('wgPrivateKey', { required: protocol === 'WIREGUARD' ? 'Private key is required' : false })}
                    placeholder="Your Wireguard private key"
                  />

                  <Input
                    label="Public Key"
                    {...register('wgPublicKey')}
                    placeholder="Your Wireguard public key"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    label="Peer Public Key *"
                    {...register('wgPeerPublicKey', { required: protocol === 'WIREGUARD' ? 'Peer public key is required' : false })}
                    placeholder="Server's Wireguard public key"
                  />

                  <Input
                    label="Peer Endpoint"
                    {...register('wgPeerEndpoint')}
                    placeholder="server:51820"
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    label="Allowed IPs"
                    {...register('wgAllowedIPs')}
                    placeholder="0.0.0.0/0, ::/0"
                  />

                  <Input
                    label="MTU"
                    type="number"
                    {...register('wgMtu', { valueAsNumber: true })}
                    placeholder="1420"
                  />
                </div>

                <Input
                  label="Client Address (optional)"
                  {...register('wgAddress')}
                  placeholder="10.66.2.2/32"
                />

                {wireguardConfigPreview ? (
                  <div className="space-y-3 rounded-xl border border-line/70 bg-panel/55 p-4">
                    <p className="text-sm font-semibold text-foreground">WireGuard Config Preview</p>
                    <pre className="max-h-52 overflow-auto rounded-lg border border-line/70 bg-card/80 p-3 text-xs text-foreground">
                      {wireguardConfigPreview}
                    </pre>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                      <div className="w-fit rounded-lg border border-line/70 bg-white p-2">
                        <QRCodeSVG value={wireguardConfigPreview} size={132} />
                      </div>
                      <p className="text-xs text-muted">
                        Scan this QR in WireGuard mobile app using &quot;Create from QR code&quot;.
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    Enter Private Key, Peer Public Key, and Peer Endpoint to preview WireGuard config and QR.
                  </p>
                )}
              </div>
            )}

            {(network === 'WS' || network === 'XHTTP' || network === 'HTTPUPGRADE') && supportsTransport && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground">
                  {network === 'XHTTP' ? 'XHTTP Settings' : network === 'HTTPUPGRADE' ? 'HTTP Upgrade Settings' : 'WebSocket Settings'}
                </h3>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Input
                    label="Path"
                    {...register('wsPath')}
                    placeholder={network === 'XHTTP' ? '/xhttp' : '/vless'}
                  />

                  <Input
                    label={network === 'XHTTP' ? 'Host (comma-separated)' : 'Host'}
                    {...register('wsHost')}
                    placeholder="your.domain.com"
                  />
                </div>

                {network === 'XHTTP' ? (
                  <Input
                    label="Mode"
                    {...register('xhttpMode')}
                    placeholder="auto or packet-up"
                  />
                ) : null}
              </div>
            )}

            {network === 'GRPC' && supportsTransport && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground">gRPC Settings</h3>

                <Input
                  label="Service Name"
                  {...register('grpcServiceName')}
                  placeholder="grpc-service"
                />
              </div>
            )}

            {protocol === 'SHADOWSOCKS' && (
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-foreground">Shadowsocks Settings</h3>

                <div>
                  <label className="mb-2 block text-sm font-medium text-muted">
                    Cipher Method
                  </label>
                  <select
                    {...register('cipher')}
                    className="w-full rounded-xl border border-line/60 bg-card/60 px-4 py-2.5 text-sm sm:text-base text-foreground backdrop-blur-md outline-none transition-all duration-300 focus:bg-card/90 focus:border-brand-500/60 focus:ring-4 focus:ring-brand-500/10 focus:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
                  >
                    <option value="chacha20-ietf-poly1305">chacha20-ietf-poly1305</option>
                    <option value="aes-256-gcm">aes-256-gcm</option>
                    <option value="aes-128-gcm">aes-128-gcm</option>
                  </select>
                </div>
              </div>
            )}

            <div className="sticky bottom-0 z-10 -mx-5 flex flex-col gap-2 border-t border-line/70 bg-card/95 px-5 pb-2 pt-4 sm:-mx-6 sm:flex-row sm:px-6">
              <Button
                type="submit"
                className="flex-1"
                loading={mutation.isPending}
              >
                {isEdit ? 'Update Inbound' : 'Create Inbound'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
