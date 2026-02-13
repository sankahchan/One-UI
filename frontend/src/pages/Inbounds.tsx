import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronRight, Copy, Download, Edit, Eye, FileCode2, Plus, Power, PowerOff, Shuffle, Sparkles, Trash2, Upload } from 'lucide-react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Badge } from '../components/atoms/Badge';
import { Button } from '../components/atoms/Button';
import { Card } from '../components/atoms/Card';
import { ConfirmDialog } from '../components/organisms/ConfirmDialog';
import { InboundClientProfileModal } from '../components/organisms/InboundClientProfileModal';
import { InboundClientsDrawer } from '../components/organisms/InboundClientsDrawer';
import { InboundFormModal } from '../components/organisms/InboundFormModal';
import { ProtocolCompatibilityPanel } from '../components/organisms/ProtocolCompatibilityPanel';
import apiClient from '../api/client';
import { groupsApi } from '../api/groups';
import { inboundTemplates, type InboundTemplate } from '../data/inboundTemplates';
import { usePersistedFilters, useSavedViews } from '../hooks/usePersistedFilters';
import { useSmartAutoRefresh } from '../hooks/useSmartAutoRefresh';
import { useToast } from '../hooks/useToast';
import { useUserSessions } from '../hooks/useUsers';
import { useAuthStore } from '../store/authStore';
import { Skeleton } from '../components/atoms/Skeleton';
import type { Group, Inbound } from '../types';

type InboundDraftValues = Partial<Inbound> & {
  realityShortId?: string;
  domains?: string[] | string;
  fallbacks?: string;
};

type ImportCandidate = Record<string, unknown>;
type InboundsTab = 'inbounds' | 'templates' | 'compatibility';
type InboundUserRelation = {
  inboundId?: number;
  inbound?: {
    id?: number;
  };
  enabled?: boolean;
  priority?: number;
};

type InboundUserDirectoryEntry = {
  id: number;
  email: string;
  uuid: string;
  status: string;
  expireDate: string;
  uploadUsed: number | string;
  downloadUsed: number | string;
  dataLimit: number | string;
  inbounds?: InboundUserRelation[];
};

type InboundClientRow = {
  id: number;
  email: string;
  uuid: string;
  status: string;
  enabled: boolean;
  priority: number;
  expireDate: string;
  uploadUsed: number;
  downloadUsed: number;
  dataLimit: number;
  totalUsed: number;
};

type MyanmarPackResponseData = {
  dryRun?: boolean;
  created?: Inbound[];
  planned?: Array<Partial<Inbound>>;
  warnings?: string[];
  assignment?: {
    assignedUsers?: number;
    assignedGroups?: number;
    requestedUserIds?: number[];
    requestedGroupIds?: number[];
  };
};

type InboundsConfirmState =
  | { type: 'bulk-delete'; ids: number[] }
  | { type: 'single-delete'; id: number; label: string }
  | null;

const INBOUNDS_TABS: Array<{ id: InboundsTab; label: string }> = [
  { id: 'inbounds', label: 'Inbounds' },
  { id: 'templates', label: 'Templates' },
  { id: 'compatibility', label: 'Compatibility' }
];

type InboundTemplateCategory = InboundTemplate['category'];

const TEMPLATE_CATEGORY_ORDER: InboundTemplateCategory[] = ['recommended', 'cdn', 'transport', 'utility'];

const TEMPLATE_CATEGORY_LABEL: Record<InboundTemplateCategory, { title: string; hint: string }> = {
  recommended: {
    title: 'Recommended',
    hint: 'Balanced defaults for most deployments.'
  },
  cdn: {
    title: 'CDN & Edge',
    hint: 'Traffic profiles optimized for edge/CDN transport.'
  },
  transport: {
    title: 'Transport Profiles',
    hint: 'Focused presets for specific transport behaviors.'
  },
  utility: {
    title: 'Utility & Gateway',
    hint: 'DNS forwarders, gateways, and service adapters.'
  }
};

function isInboundsTab(value: string | null): value is InboundsTab {
  return value === 'inbounds' || value === 'templates' || value === 'compatibility';
}

function toSafeNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

const allowedProtocols = new Set(['VLESS', 'VMESS', 'TROJAN', 'SHADOWSOCKS', 'SOCKS', 'HTTP', 'DOKODEMO_DOOR', 'WIREGUARD', 'MTPROTO']);
const allowedNetworks = new Set(['TCP', 'WS', 'GRPC', 'HTTP', 'HTTPUPGRADE', 'XHTTP']);
const allowedSecurity = new Set(['NONE', 'TLS', 'REALITY']);

function normalizeProtocol(raw: unknown): Inbound['protocol'] {
  const value = String(raw || 'VLESS').toUpperCase();
  return (allowedProtocols.has(value) ? value : 'VLESS') as Inbound['protocol'];
}

function normalizeNetwork(raw: unknown, protocol: Inbound['protocol']): Inbound['network'] {
  const value = String(raw || '').toUpperCase();
  if (allowedNetworks.has(value)) {
    return value as Inbound['network'];
  }

  if (protocol === 'DOKODEMO_DOOR' || protocol === 'SOCKS' || protocol === 'HTTP') {
    return 'TCP';
  }

  return 'WS';
}

function normalizeSecurity(raw: unknown, protocol: Inbound['protocol']): Inbound['security'] {
  const value = String(raw || '').toUpperCase();
  if (protocol === 'TROJAN') {
    return 'TLS';
  }
  if (allowedSecurity.has(value)) {
    if (value === 'REALITY' && protocol !== 'VLESS') {
      return 'NONE';
    }
    return value as Inbound['security'];
  }
  return 'NONE';
}

function sanitizeTag(rawTag: unknown, fallback: string, usedTags: Set<string>) {
  const baseTag = String(rawTag || fallback).trim().replace(/\s+/g, '-').toLowerCase();
  let candidate = baseTag || fallback;
  let suffix = 1;

  while (usedTags.has(candidate)) {
    candidate = `${baseTag || fallback}-${suffix}`;
    suffix += 1;
  }

  usedTags.add(candidate);
  return candidate;
}

function sanitizePort(rawPort: unknown, usedPorts: Set<number>, fallback: number) {
  let port = Number.parseInt(String(rawPort ?? fallback), 10);
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    port = fallback;
  }
  while (usedPorts.has(port) || port < 1 || port > 65535) {
    port += 1;
    if (port > 65535) {
      port = 1024;
    }
  }
  usedPorts.add(port);
  return port;
}

function normalizeImportedInbound(
  item: ImportCandidate,
  index: number,
  usedTags: Set<string>,
  usedPorts: Set<number>
) {
  const protocol = normalizeProtocol(item.protocol);
  const network = normalizeNetwork(item.network, protocol);
  const security = normalizeSecurity(item.security, protocol);
  const fallbackPort = 20000 + index;
  const port = sanitizePort(item.port, usedPorts, fallbackPort);
  const tag = sanitizeTag(item.tag, `${protocol.toLowerCase()}-${port}`, usedTags);

  const payload: Record<string, unknown> = {
    protocol,
    network,
    security,
    port,
    tag,
    remark: typeof item.remark === 'string' ? item.remark : undefined,
    serverAddress:
      typeof item.serverAddress === 'string' && item.serverAddress.trim()
        ? item.serverAddress.trim()
        : '127.0.0.1'
  };

  const optionalFields = [
    'serverName',
    'wsPath',
    'wsHost',
    'xhttpMode',
    'grpcServiceName',
    'alpn',
    'cipher',
    'realityPublicKey',
    'realityPrivateKey',
    'realityShortId',
    'realityFingerprint',
    'wgPrivateKey',
    'wgPublicKey',
    'wgAddress',
    'wgPeerPublicKey',
    'wgPeerEndpoint',
    'wgAllowedIPs',
    'wgMtu',
    'dokodemoTargetPort',
    'dokodemoNetwork',
    'dokodemoFollowRedirect',
    'domains',
    'fallbacks'
  ];

  for (const key of optionalFields) {
    const value = item[key];
    if (value !== undefined) {
      payload[key] = value;
    }
  }

  if (protocol === 'DOKODEMO_DOOR' && payload.dokodemoTargetPort === undefined) {
    payload.dokodemoTargetPort = 80;
  }

  return payload;
}

function toExportProfile(inbound: Inbound) {
  const exportable = {
    port: inbound.port,
    protocol: inbound.protocol,
    tag: inbound.tag,
    remark: inbound.remark,
    enabled: inbound.enabled,
    network: inbound.network,
    security: inbound.security,
    serverName: inbound.serverName,
    serverAddress: inbound.serverAddress,
    alpn: inbound.alpn,
    wsPath: inbound.wsPath,
    wsHost: inbound.wsHost,
    xhttpMode: inbound.xhttpMode,
    grpcServiceName: inbound.grpcServiceName,
    cipher: inbound.cipher,
    realityPublicKey: inbound.realityPublicKey,
    realityPrivateKey: inbound.realityPrivateKey,
    realityFingerprint: inbound.realityFingerprint,
    realityShortIds: inbound.realityShortIds,
    realityServerNames: inbound.realityServerNames,
    wgPrivateKey: inbound.wgPrivateKey,
    wgPublicKey: inbound.wgPublicKey,
    wgAddress: inbound.wgAddress,
    wgPeerPublicKey: inbound.wgPeerPublicKey,
    wgPeerEndpoint: inbound.wgPeerEndpoint,
    wgAllowedIPs: inbound.wgAllowedIPs,
    wgMtu: inbound.wgMtu,
    dokodemoTargetPort: inbound.dokodemoTargetPort,
    dokodemoNetwork: inbound.dokodemoNetwork,
    dokodemoFollowRedirect: inbound.dokodemoFollowRedirect,
    domains: inbound.domains,
    fallbacks: inbound.fallbacks
  } as Record<string, unknown>;

  return Object.fromEntries(Object.entries(exportable).filter(([, value]) => value !== undefined && value !== null));
}

function templateToDraft(template: InboundTemplate): InboundDraftValues {
  const fallbackProtocol = String(template.values.protocol || 'vless').toLowerCase();
  const fallbackPort = Number(template.values.port || 443);
  return {
    ...template.values,
    tag: template.values.tag || `${fallbackProtocol}-${fallbackPort}`,
    serverAddress: template.values.serverAddress || 'your.domain.com'
  };
}

function buildClonePayload(source: Inbound, existingInbounds: Inbound[]) {
  const exportProfile = toExportProfile(source);
  const usedTags = new Set(existingInbounds.map((inbound) => inbound.tag));
  const usedPorts = new Set(existingInbounds.map((inbound) => inbound.port));

  const clonedTag = sanitizeTag(`${source.tag}-copy`, `${source.protocol.toLowerCase()}-copy`, usedTags);
  const clonedPort = sanitizePort(source.port + 1, usedPorts, source.port + 1);

  return {
    ...exportProfile,
    tag: clonedTag,
    port: clonedPort,
    remark: `${source.remark || source.tag} (Clone)`
  };
}

function profileToDraft(profile: Record<string, unknown>): InboundDraftValues {
  const draft: InboundDraftValues = {
    ...profile
  } as InboundDraftValues;

  if (Array.isArray(profile.domains)) {
    draft.domains = profile.domains.map((entry) => String(entry)).join(', ');
  }

  if (Array.isArray(profile.fallbacks)) {
    draft.fallbacks = JSON.stringify(profile.fallbacks, null, 2);
  }

  if (!draft.realityShortId && Array.isArray((profile as { realityShortIds?: unknown[] }).realityShortIds)) {
    const firstShortId = (profile as { realityShortIds?: unknown[] }).realityShortIds?.[0];
    if (firstShortId !== undefined && firstShortId !== null) {
      draft.realityShortId = String(firstShortId);
    }
  }

  return draft;
}

function buildCloneDraft(source: Inbound, existingInbounds: Inbound[]) {
  return profileToDraft(buildClonePayload(source, existingInbounds));
}

function fallbackDraftForProtocol(protocol: Inbound['protocol']): InboundDraftValues {
  const baseTag = protocol.toLowerCase().replace(/_/g, '-');

  return {
    protocol,
    port: 443,
    tag: `${baseTag}-new`,
    remark: `${protocol} inbound`,
    network: 'TCP',
    security: 'NONE',
    serverAddress: 'your.domain.com'
  };
}

export const Inbounds: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const admin = useAuthStore((state) => state.admin);
  const canDeleteInbounds = admin?.role === 'SUPER_ADMIN';

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingInbound, setEditingInbound] = useState<Inbound | null>(null);
  const [draftInbound, setDraftInbound] = useState<InboundDraftValues | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<InboundTemplate | null>(null);
  const [profileInbound, setProfileInbound] = useState<Inbound | null>(null);
  const [drawerInbound, setDrawerInbound] = useState<Inbound | null>(null);
  const [clientActionLoadingKey, setClientActionLoadingKey] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<number | null>(null);
  const [randomizingPortId, setRandomizingPortId] = useState<number | null>(null);
  const [expandedInboundIds, setExpandedInboundIds] = useState<number[]>([]);
  const [selectedInboundIds, setSelectedInboundIds] = useState<number[]>([]);
  const [confirmState, setConfirmState] = useState<InboundsConfirmState>(null);
  const [showMyanmarPackModal, setShowMyanmarPackModal] = useState(false);
  const [myanmarPackForm, setMyanmarPackForm] = useState({
    serverAddress: '',
    serverName: '',
    cdnHost: '',
    fallbackPorts: '8443,9443',
    assignUserIds: [] as number[],
    assignGroupIds: [] as number[]
  });
  const [myanmarPackPreview, setMyanmarPackPreview] = useState<MyanmarPackResponseData | null>(null);
  const [nowTimestamp, setNowTimestamp] = useState<number>(() => Date.now());
  const preferences = usePersistedFilters<{
    defaultTab: InboundsTab;
    viewMode: 'auto' | 'table' | 'cards';
  }>('one-ui/inbounds-filters', {
    defaultTab: 'inbounds',
    viewMode: 'auto'
  });
  const { views: savedViews, saveView, deleteView } = useSavedViews<{
    tab: InboundsTab;
    viewMode: 'auto' | 'table' | 'cards';
  }>('one-ui/inbounds-saved-views');
  const [selectedViewId, setSelectedViewId] = useState('');
  const [activeTab, setActiveTab] = useState<InboundsTab>(() => {
    const tab = searchParams.get('tab');
    if (isInboundsTab(tab)) {
      return tab;
    }
    return preferences.value.defaultTab;
  });
  const viewMode = preferences.value.viewMode;
  const setViewMode = (nextMode: 'auto' | 'table' | 'cards') => {
    preferences.setValue((previous) => ({
      ...previous,
      viewMode: nextMode
    }));
  };

  const quickAction = searchParams.get('quick');
  const queryTab = searchParams.get('tab');

  useEffect(() => {
    if (quickAction === 'create') {
      setEditingInbound(null);
      setDraftInbound(null);
      setShowAddModal(true);
      setActiveTab('inbounds');

      const next = new URLSearchParams(searchParams);
      next.delete('quick');
      next.set('tab', 'inbounds');
      setSearchParams(next, { replace: true });
    }
  }, [quickAction, searchParams, setSearchParams]);

  useEffect(() => {
    if (!isInboundsTab(queryTab)) {
      return;
    }

    if (queryTab !== activeTab) {
      setActiveTab(queryTab);
    }
  }, [queryTab, activeTab]);

  useEffect(() => {
    preferences.setValue((previous) => (
      previous.defaultTab === activeTab
        ? previous
        : {
            ...previous,
            defaultTab: activeTab
          }
    ));
  }, [activeTab, preferences]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['inbounds'],
    queryFn: async () => {
      const response = await apiClient.get('/inbounds');
      return response.data as Inbound[];
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000
  });

  const { data: inboundUsers = [] } = useQuery({
    queryKey: ['inbounds-users-directory'],
    queryFn: async () => {
      const pageSize = 100;
      let currentPage = 1;
      let totalPages = 1;
      const users: InboundUserDirectoryEntry[] = [];

      while (currentPage <= totalPages && currentPage <= 50) {
        const response = await apiClient.get('/users', {
          params: {
            page: currentPage,
            limit: pageSize
          }
        }) as {
          data?: InboundUserDirectoryEntry[];
          meta?: {
            totalPages?: number;
          };
        };

        if (Array.isArray(response.data)) {
          users.push(...response.data);
        }

        totalPages = Number(response.meta?.totalPages || 1);
        currentPage += 1;
      }

      return users;
    },
    staleTime: 20_000
  });
  const { data: assignableGroups = [] } = useQuery({
    queryKey: ['inbounds-assignable-groups'],
    queryFn: async () => {
      const response = await groupsApi.list({
        page: 1,
        limit: 200,
        includeDisabled: true
      });
      return (response.data || []) as Group[];
    },
    staleTime: 30_000
  });

  const inbounds = useMemo(() => data || [], [data]);
  const inboundUserIds = useMemo(
    () => inboundUsers.map((user) => Number(user.id)).filter((id) => Number.isInteger(id) && id > 0),
    [inboundUsers]
  );
  const sessionsStream = useUserSessions(inboundUserIds, {
    includeOffline: true,
    live: true,
    streamInterval: 2000
  });

  const selectedCount = selectedInboundIds.length;
  const allSelected = inbounds.length > 0 && selectedInboundIds.length === inbounds.length;

  const importMutation = useMutation({
    mutationFn: async (items: ImportCandidate[]) => {
      const usedTags = new Set(inbounds.map((entry) => entry.tag));
      const usedPorts = new Set(inbounds.map((entry) => entry.port));
      let success = 0;
      const failures: string[] = [];

      for (const [index, item] of items.entries()) {
        try {
          const payload = normalizeImportedInbound(item, index, usedTags, usedPorts);
          await apiClient.post('/inbounds', payload);
          success += 1;
        } catch (error: any) {
          failures.push(`Item ${index + 1}: ${error?.message || 'Unknown error'}`);
        }
      }

      return { success, failures };
    },
    onSuccess: async ({ success, failures }) => {
      await queryClient.invalidateQueries({ queryKey: ['inbounds'] });
      const failedCount = failures.length;
      if (failedCount > 0) {
        toast.error(
          'Import completed with warnings',
          `Imported ${success} profile(s), ${failedCount} failed. ${failures.slice(0, 3).join(' | ')}`
        );
      } else {
        toast.success('Import completed', `Successfully imported ${success} profile(s).`);
      }
    },
    onError: (error: any) => {
      toast.error('Import failed', error?.message || 'Failed to import inbound profiles');
    }
  });

  const applyMyanmarPackMutation = useMutation({
    mutationFn: async (payload: {
      serverAddress: string;
      serverName?: string;
      cdnHost?: string;
      fallbackPorts?: string;
      userIds?: number[];
      groupIds?: number[];
      dryRun?: boolean;
    }) => {
      return apiClient.post('/inbounds/presets/myanmar', payload);
    },
    onSuccess: async (result: { data?: MyanmarPackResponseData }) => {
      const payload = result?.data || {};
      const isDryRun = Boolean(payload.dryRun);
      const warnings = payload.warnings || [];

      if (isDryRun) {
        setMyanmarPackPreview(payload);
        const plannedCount = payload.planned?.length || 0;
        if (warnings.length > 0) {
          toast.error(
            'Myanmar pack preview generated with warnings',
            `${plannedCount} planned profile(s). ${warnings.slice(0, 3).join(' | ')}`
          );
        } else {
          toast.success('Myanmar pack preview generated', `${plannedCount} planned profile(s).`);
        }
        return;
      }

      await queryClient.invalidateQueries({ queryKey: ['inbounds'] });
      const createdCount = payload.created?.length || 0;
      const assignment = payload.assignment || {};
      const assignedUsers = Number(assignment.assignedUsers || 0);
      const assignedGroups = Number(assignment.assignedGroups || 0);
      let assignmentSummary = '';
      if (assignedUsers > 0 || assignedGroups > 0) {
        assignmentSummary = `\nAssigned to ${assignedUsers} user(s) and ${assignedGroups} group(s).`;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users'] }),
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['inbounds-assignable-groups'] }),
        queryClient.invalidateQueries({ queryKey: ['inbounds-users-directory'] })
      ]);

      if (warnings.length > 0) {
        toast.error(
          'Myanmar pack applied with warnings',
          `${createdCount} profile(s) created.${assignmentSummary} ${warnings.slice(0, 3).join(' | ')}`
        );
      } else {
        toast.success('Myanmar pack applied', `${createdCount} profile(s) created.${assignmentSummary}`);
      }
      setShowMyanmarPackModal(false);
      setMyanmarPackPreview(null);
    },
    onError: (error: any) => {
      toast.error('Myanmar pack failed', error?.message || 'Failed to apply Myanmar pack');
    }
  });

  const deleteInbound = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/inbounds/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });

  const bulkDeleteInbounds = useMutation({
    mutationFn: async (inboundIds: number[]) => {
      await apiClient.post('/inbounds/bulk/delete', { inboundIds });
    },
    onSuccess: async () => {
      setSelectedInboundIds([]);
      await queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });

  const bulkEnableInbounds = useMutation({
    mutationFn: async (inboundIds: number[]) => {
      await apiClient.post('/inbounds/bulk/enable', { inboundIds });
    },
    onSuccess: async () => {
      setSelectedInboundIds([]);
      await queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });

  const bulkDisableInbounds = useMutation({
    mutationFn: async (inboundIds: number[]) => {
      await apiClient.post('/inbounds/bulk/disable', { inboundIds });
    },
    onSuccess: async () => {
      setSelectedInboundIds([]);
      await queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });

  const toggleInbound = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.post(`/inbounds/${id}/toggle`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });

  const randomizeInboundPort = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.post(`/inbounds/${id}/random-port`);
    },
    onMutate: (id) => {
      setRandomizingPortId(id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    },
    onError: (error: any) => {
      toast.error('Randomize port failed', error?.message || 'Failed to randomize inbound port');
    },
    onSettled: () => {
      setRandomizingPortId(null);
    }
  });

  useEffect(() => {
    setSelectedInboundIds((previous) => previous.filter((id) => inbounds.some((inbound) => inbound.id === id)));
  }, [inbounds]);

  useEffect(() => {
    setExpandedInboundIds((previous) => previous.filter((id) => inbounds.some((inbound) => inbound.id === id)));
  }, [inbounds]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowTimestamp(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const sessionsByUuid = useMemo(() => {
    const map = new Map<string, { online: boolean; currentIp: string | null; lastSeenAt: string | null }>();
    for (const session of sessionsStream.data?.sessions || []) {
      map.set(String(session.uuid || ''), {
        online: Boolean(session.online),
        currentIp: session.currentIp,
        lastSeenAt: session.lastSeenAt
      });
    }
    return map;
  }, [sessionsStream.data?.sessions]);

  const onlineUuidSet = useMemo(() => {
    const onlineUuids = (sessionsStream.data?.sessions || [])
      .filter((session) => session.online)
      .map((session) => String(session.uuid || ''))
      .filter(Boolean);
    return new Set(onlineUuids);
  }, [sessionsStream.data?.sessions]);

  const clientsByInbound = useMemo(() => {
    const map = new Map<number, InboundClientRow[]>();

    for (const user of inboundUsers) {
      const relations = Array.isArray(user.inbounds) ? user.inbounds : [];
      for (const relation of relations) {
        const inboundId = Number(relation.inboundId ?? relation.inbound?.id);
        if (!Number.isInteger(inboundId) || inboundId < 1) {
          continue;
        }

        const uploadUsed = toSafeNumber(user.uploadUsed);
        const downloadUsed = toSafeNumber(user.downloadUsed);
        const dataLimit = toSafeNumber(user.dataLimit);
        const totalUsed = uploadUsed + downloadUsed;
        const row: InboundClientRow = {
          id: Number(user.id),
          email: String(user.email || ''),
          uuid: String(user.uuid || ''),
          status: String(user.status || ''),
          enabled: Boolean(relation.enabled),
          priority: Number.isInteger(Number(relation.priority)) ? Number(relation.priority) : 100,
          expireDate: String(user.expireDate || ''),
          uploadUsed,
          downloadUsed,
          dataLimit,
          totalUsed
        };

        const existing = map.get(inboundId) || [];
        existing.push(row);
        map.set(inboundId, existing);
      }
    }

    for (const [inboundId, rows] of map.entries()) {
      rows.sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority;
        }
        return a.email.localeCompare(b.email);
      });
      map.set(inboundId, rows);
    }

    return map;
  }, [inboundUsers]);

  const toggleInboundSelection = (id: number) => {
    setSelectedInboundIds((previous) => (
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id]
    ));
  };

  const toggleInboundExpanded = (id: number) => {
    setExpandedInboundIds((previous) => (
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id]
    ));
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedInboundIds([]);
      return;
    }

    setSelectedInboundIds(inbounds.map((inbound) => inbound.id));
  };

  const hasBulkPending = bulkDeleteInbounds.isPending || bulkEnableInbounds.isPending || bulkDisableInbounds.isPending;

  const refreshInboundRelations = async (options: { includeUsersDirectory?: boolean } = {}) => {
    const tasks = [
      queryClient.invalidateQueries({ queryKey: ['inbounds'] }),
      queryClient.invalidateQueries({ queryKey: ['user-sessions'] })
    ];

    if (options.includeUsersDirectory) {
      tasks.push(queryClient.invalidateQueries({ queryKey: ['inbounds-users-directory'] }));
    }

    await Promise.all(tasks);
  };

  const autoRefresh = useSmartAutoRefresh(
    () => refreshInboundRelations(),
    {
      enabled: activeTab === 'inbounds',
      intervalMs: 5_000
    }
  );

  const runClientAction = async (actionKey: string, handler: () => Promise<void>, fallbackMessage: string) => {
    setClientActionLoadingKey(actionKey);
    try {
      await handler();
      await refreshInboundRelations({ includeUsersDirectory: true });
    } catch (error: any) {
      toast.error('Client action failed', error?.message || fallbackMessage);
    } finally {
      setClientActionLoadingKey(null);
    }
  };

  const runBulkDelete = async () => {
    if (!canDeleteInbounds) {
      toast.error('Permission denied', 'Only SUPER_ADMIN can delete inbounds.');
      return;
    }
    if (selectedInboundIds.length === 0) {
      return;
    }
    setConfirmState({ type: 'bulk-delete', ids: [...selectedInboundIds] });
  };

  const handleConfirmDelete = async () => {
    if (!confirmState) {
      return;
    }

    try {
      if (confirmState.type === 'bulk-delete') {
        await bulkDeleteInbounds.mutateAsync(confirmState.ids);
        toast.success('Bulk delete completed', `Deleted ${confirmState.ids.length} inbound(s).`);
      } else {
        await deleteInbound.mutateAsync(confirmState.id);
        toast.success('Inbound deleted', `Deleted inbound "${confirmState.label}".`);
      }
      setConfirmState(null);
    } catch (error: any) {
      toast.error('Delete failed', error?.message || 'Failed to delete inbound');
    }
  };

  const runBulkEnable = async () => {
    if (selectedInboundIds.length === 0) {
      return;
    }

    try {
      await bulkEnableInbounds.mutateAsync(selectedInboundIds);
      toast.success('Bulk enable completed', 'Selected inbounds enabled.');
    } catch (error: any) {
      toast.error('Bulk enable failed', error?.message || 'Failed to enable selected inbounds');
    }
  };

  const runBulkDisable = async () => {
    if (selectedInboundIds.length === 0) {
      return;
    }

    try {
      await bulkDisableInbounds.mutateAsync(selectedInboundIds);
      toast.success('Bulk disable completed', 'Selected inbounds disabled.');
    } catch (error: any) {
      toast.error('Bulk disable failed', error?.message || 'Failed to disable selected inbounds');
    }
  };

  const cloneInbound = useMutation({
    mutationFn: async (source: Inbound) => {
      const payload = buildClonePayload(source, inbounds);
      await apiClient.post('/inbounds', payload);
    },
    onMutate: (source) => {
      setCloningId(source.id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['inbounds'] });
      toast.success('Inbound cloned', 'Inbound cloned successfully.');
    },
    onError: (error: any) => {
      toast.error('Clone failed', error?.message || 'Failed to clone inbound');
    },
    onSettled: () => {
      setCloningId(null);
    }
  });

  const protocolColor = useMemo(
    () =>
      ({
        VLESS: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
        VMESS: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
        TROJAN: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
        SHADOWSOCKS: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
        SOCKS: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
        HTTP: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-300',
        DOKODEMO_DOOR: 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
        WIREGUARD: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
        MTPROTO: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
      }) as Record<Inbound['protocol'], string>,
    []
  );
  const assignableUsers = useMemo(
    () =>
      [...inboundUsers]
        .sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')))
        .slice(0, 500),
    [inboundUsers]
  );
  const assignableGroupsSorted = useMemo(
    () =>
      [...assignableGroups]
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [assignableGroups]
  );
  const selectedMyanmarUserSet = useMemo(
    () => new Set(myanmarPackForm.assignUserIds),
    [myanmarPackForm.assignUserIds]
  );
  const selectedMyanmarGroupSet = useMemo(
    () => new Set(myanmarPackForm.assignGroupIds),
    [myanmarPackForm.assignGroupIds]
  );

  const templatesByProtocol = useMemo(() => {
    const mapping = new Map<Inbound['protocol'], InboundTemplate>();
    for (const template of inboundTemplates) {
      if (!mapping.has(template.values.protocol)) {
        mapping.set(template.values.protocol, template);
      }
    }
    return mapping;
  }, []);

  const templatesByCategory = useMemo(() => {
    const grouped: Record<InboundTemplateCategory, InboundTemplate[]> = {
      recommended: [],
      cdn: [],
      transport: [],
      utility: []
    };

    for (const template of inboundTemplates) {
      grouped[template.category].push(template);
    }

    return grouped;
  }, []);

  const openAddModal = (draft?: InboundDraftValues | null) => {
    setEditingInbound(null);
    setDraftInbound(draft || null);
    setShowAddModal(true);
  };

  const openMyanmarPackModal = () => {
    setMyanmarPackForm((previous) => ({
      ...previous,
      serverAddress: previous.serverAddress || '',
      serverName: previous.serverName || '',
      cdnHost: previous.cdnHost || '',
      fallbackPorts: previous.fallbackPorts || '8443,9443'
    }));
    setMyanmarPackPreview(null);
    setShowMyanmarPackModal(true);
  };

  const toggleMyanmarPackUser = (userId: number, checked: boolean) => {
    setMyanmarPackForm((previous) => {
      const next = new Set(previous.assignUserIds);
      if (checked) {
        next.add(userId);
      } else {
        next.delete(userId);
      }
      return {
        ...previous,
        assignUserIds: Array.from(next)
      };
    });
  };

  const toggleMyanmarPackGroup = (groupId: number, checked: boolean) => {
    setMyanmarPackForm((previous) => {
      const next = new Set(previous.assignGroupIds);
      if (checked) {
        next.add(groupId);
      } else {
        next.delete(groupId);
      }
      return {
        ...previous,
        assignGroupIds: Array.from(next)
      };
    });
  };

  const selectAllMyanmarPackUsers = () => {
    setMyanmarPackForm((previous) => ({
      ...previous,
      assignUserIds: assignableUsers.map((user) => Number(user.id))
    }));
  };

  const clearMyanmarPackUsers = () => {
    setMyanmarPackForm((previous) => ({
      ...previous,
      assignUserIds: []
    }));
  };

  const selectAllMyanmarPackGroups = () => {
    setMyanmarPackForm((previous) => ({
      ...previous,
      assignGroupIds: assignableGroupsSorted.map((group) => Number(group.id))
    }));
  };

  const clearMyanmarPackGroups = () => {
    setMyanmarPackForm((previous) => ({
      ...previous,
      assignGroupIds: []
    }));
  };

  const applyMyanmarPack = async (dryRun = false) => {
    if (!myanmarPackForm.serverAddress.trim()) {
      toast.error('Validation failed', 'Server address is required.');
      return;
    }

    const payload = {
      serverAddress: myanmarPackForm.serverAddress.trim(),
      serverName: myanmarPackForm.serverName.trim() || myanmarPackForm.serverAddress.trim(),
      cdnHost: myanmarPackForm.cdnHost.trim() || undefined,
      fallbackPorts: myanmarPackForm.fallbackPorts.trim() || undefined,
      userIds: myanmarPackForm.assignUserIds,
      groupIds: myanmarPackForm.assignGroupIds,
      dryRun
    };

    await applyMyanmarPackMutation.mutateAsync(payload);
  };

  const openCloneEditor = (source: Inbound) => {
    openAddModal(buildCloneDraft(source, inbounds));
  };

  const openQuickCreateForProtocol = (protocol: Inbound['protocol']) => {
    const template = templatesByProtocol.get(protocol);
    if (template) {
      openAddModal(templateToDraft(template));
      return;
    }

    openAddModal(fallbackDraftForProtocol(protocol));
  };

  const closeModal = () => {
    setShowAddModal(false);
    setEditingInbound(null);
    setDraftInbound(null);
  };

  const switchTab = (tab: InboundsTab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const handleSaveCurrentView = () => {
    const name = window.prompt('Name this inbounds view');
    if (!name) {
      return;
    }

    try {
      const view = saveView(name, {
        tab: activeTab,
        viewMode
      });
      setSelectedViewId(view.id);
      toast.success('View saved', `Saved view "${view.name}".`);
    } catch (error: any) {
      toast.error('Save view failed', error?.message || 'Failed to save view');
    }
  };

  const applySavedView = (viewId: string) => {
    setSelectedViewId(viewId);
    const selected = savedViews.find((view) => view.id === viewId);
    if (!selected) {
      return;
    }

    setViewMode(selected.filters.viewMode || 'auto');
    switchTab(selected.filters.tab || 'inbounds');
  };

  const removeSavedView = () => {
    if (!selectedViewId) {
      return;
    }

    deleteView(selectedViewId);
    setSelectedViewId('');
  };

  const handleDelete = async (id: number) => {
    if (!canDeleteInbounds) {
      toast.error('Permission denied', 'Only SUPER_ADMIN can delete inbounds.');
      return;
    }
    const inbound = inbounds.find((entry) => entry.id === id);
    setConfirmState({
      type: 'single-delete',
      id,
      label: inbound?.remark || inbound?.tag || `#${id}`
    });
  };

  const handleExport = () => {
    if (inbounds.length === 0) {
      toast.error('Export unavailable', 'No inbounds to export.');
      return;
    }

    const payload = {
      app: 'One-UI',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      inbounds: inbounds.map(toExportProfile)
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `one-ui-inbounds-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const parseImportItems = (raw: unknown): ImportCandidate[] => {
    if (Array.isArray(raw)) {
      return raw.filter((item) => item && typeof item === 'object') as ImportCandidate[];
    }
    if (raw && typeof raw === 'object') {
      const objectPayload = raw as Record<string, unknown>;
      if (Array.isArray(objectPayload.inbounds)) {
        return objectPayload.inbounds.filter((item) => item && typeof item === 'object') as ImportCandidate[];
      }
      return [objectPayload];
    }
    return [];
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }

    try {
      const rawText = await file.text();
      const parsed = JSON.parse(rawText);
      const items = parseImportItems(parsed);
      if (items.length === 0) {
        toast.error('Import failed', 'No valid inbound profiles found in selected file.');
        return;
      }
      await importMutation.mutateAsync(items);
    } catch (error: any) {
      toast.error('Import failed', error?.message || 'Invalid JSON file');
    }
  };

  const formatBytes = (bytes: number) => {
    if (!Number.isFinite(bytes) || bytes <= 0) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** exponent);
    return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[exponent]}`;
  };

  const getDaysLeft = (expireDate: string) => {
    const expire = new Date(expireDate);
    if (Number.isNaN(expire.getTime())) {
      return null;
    }
    const diff = expire.getTime() - nowTimestamp;
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const confirmTitle = confirmState?.type === 'bulk-delete'
    ? 'Delete Selected Inbounds'
    : confirmState?.type === 'single-delete'
    ? 'Delete Inbound'
    : '';
  const confirmDescription = confirmState?.type === 'bulk-delete'
    ? `Delete ${confirmState.ids.length} selected inbound(s)? This action cannot be undone.`
    : confirmState?.type === 'single-delete'
    ? `Delete inbound "${confirmState.label}"? Associated users may lose access.`
    : '';
  const confirmLoading = confirmState?.type === 'bulk-delete'
    ? bulkDeleteInbounds.isPending
    : confirmState?.type === 'single-delete'
    ? deleteInbound.isPending
    : false;

  const tableVisibilityClass = viewMode === 'auto'
    ? 'hidden overflow-hidden p-0 lg:block'
    : viewMode === 'table'
    ? 'overflow-hidden p-0'
    : 'hidden';
  const cardsVisibilityClass = viewMode === 'auto'
    ? 'grid grid-cols-1 gap-4 lg:hidden'
    : viewMode === 'cards'
    ? 'grid grid-cols-1 gap-4'
    : 'hidden';

  return (
    <div className="space-y-6">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={handleImportFile}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Inbounds</h1>
          <p className="mt-1 text-sm text-muted">Manage your Xray inbound configurations and reusable profiles.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {activeTab === 'inbounds' ? (
            <>
              <Button variant="secondary" onClick={toggleSelectAll} disabled={inbounds.length === 0}>
                {allSelected ? 'Clear Selection' : 'Select All'}
              </Button>
              <Button variant="secondary" onClick={handleExport}>
                <Download className="mr-2 h-4 w-4" />
                Export JSON
              </Button>
              <Button variant="secondary" onClick={() => fileInputRef.current?.click()} loading={importMutation.isPending}>
                <Upload className="mr-2 h-4 w-4" />
                Import JSON
              </Button>
              <Button
                variant="secondary"
                onClick={openMyanmarPackModal}
                loading={applyMyanmarPackMutation.isPending}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Apply Myanmar Pack
              </Button>
            </>
          ) : null}
          <Button onClick={() => openAddModal()}>
            <Plus className="mr-2 h-4 w-4" />
            Add Inbound
          </Button>
        </div>
      </div>

      <Card className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="min-w-[180px] rounded-xl border border-line/80 bg-card/75 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none focus:ring-2 focus:ring-brand-500/35"
              value={selectedViewId}
              onChange={(event) => applySavedView(event.target.value)}
            >
              <option value="">Saved views</option>
              {savedViews.map((view) => (
                <option key={view.id} value={view.id}>
                  {view.name}
                </option>
              ))}
            </select>
            <Button size="sm" variant="secondary" onClick={handleSaveCurrentView}>
              Save View
            </Button>
            <Button size="sm" variant="ghost" onClick={removeSavedView} disabled={!selectedViewId}>
              Remove View
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-xl border border-line/70 bg-card/70 p-1">
              {(['auto', 'table', 'cards'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setViewMode(mode)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    viewMode === mode
                      ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white'
                      : 'text-muted hover:text-foreground'
                  }`}
                >
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost" onClick={autoRefresh.togglePaused}>
              {autoRefresh.paused ? 'Resume Auto' : 'Pause Auto'}
            </Button>
            <span className="text-xs text-muted">
              Auto refresh: {autoRefresh.statusLabel} ({Math.ceil(autoRefresh.nextRunInMs / 1000)}s)
            </span>
          </div>
        </div>
      </Card>

      <Card className="p-3 sm:p-4">
        <div className="overflow-x-auto">
          <div className="inline-flex min-w-full gap-1 rounded-xl border border-line/70 bg-panel/45 p-1">
            {INBOUNDS_TABS.map((tab) => {
              const isActive = activeTab === tab.id;
              const count = tab.id === 'inbounds'
                ? inbounds.length
                : tab.id === 'templates'
                ? inboundTemplates.length
                : undefined;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => switchTab(tab.id)}
                  className={`flex min-w-[130px] flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors sm:min-w-[150px] ${
                    isActive
                      ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-soft'
                      : 'text-muted hover:bg-card/70 hover:text-foreground'
                  }`}
                >
                  <span>{tab.label}</span>
                  {typeof count === 'number' ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs ${isActive ? 'bg-white/20 text-white' : 'bg-card/80 text-foreground/80'}`}>
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </Card>

      {activeTab === 'inbounds' && selectedCount > 0 ? (
        <Card>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm text-foreground">
              {selectedCount} inbound{selectedCount > 1 ? 's' : ''} selected
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setSelectedInboundIds([]);
                }}
                disabled={hasBulkPending}
              >
                Clear
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void runBulkEnable();
                }}
                loading={bulkEnableInbounds.isPending}
                disabled={hasBulkPending}
              >
                Enable Selected
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void runBulkDisable();
                }}
                loading={bulkDisableInbounds.isPending}
                disabled={hasBulkPending}
              >
                Disable Selected
              </Button>
                {canDeleteInbounds ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      void runBulkDelete();
                    }}
                    loading={bulkDeleteInbounds.isPending}
                    disabled={hasBulkPending}
                  >
                    Delete Selected
                  </Button>
                ) : null}
            </div>
          </div>
        </Card>
      ) : null}

      {activeTab === 'templates' ? (
        <Card>
          <div className="mb-4 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-brand-500" />
            <h2 className="text-lg font-semibold text-foreground">Template Library</h2>
          </div>
          <div className="space-y-5">
            {TEMPLATE_CATEGORY_ORDER.map((category) => {
              const templates = templatesByCategory[category];
              if (templates.length === 0) {
                return null;
              }

              const categoryMeta = TEMPLATE_CATEGORY_LABEL[category];

              return (
                <div key={category}>
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{categoryMeta.title}</p>
                      <p className="text-xs text-muted">{categoryMeta.hint}</p>
                    </div>
                    <span className="rounded-full border border-line/70 bg-panel/70 px-2.5 py-1 text-xs text-muted">
                      {templates.length} template{templates.length > 1 ? 's' : ''}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {templates.map((template) => (
                      <div key={template.id} className="rounded-xl border border-line/70 bg-card/65 p-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="mr-1 text-sm font-semibold text-foreground">{template.name}</p>
                          <span className="rounded-md border border-line/70 bg-panel/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/90">
                            {template.values.protocol}
                          </span>
                          <span className="rounded-md border border-line/70 bg-panel/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/90">
                            {template.values.network}
                          </span>
                          <span className="rounded-md border border-line/70 bg-panel/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/90">
                            {template.values.security}
                          </span>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted">{template.description}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {template.highlights.map((highlight) => (
                            <span
                              key={`${template.id}-${highlight}`}
                              className="rounded-md border border-brand-500/25 bg-brand-500/10 px-2 py-0.5 text-[10px] font-medium text-brand-700 dark:text-brand-300"
                            >
                              {highlight}
                            </span>
                          ))}
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setPreviewTemplate(template)}
                          >
                            <Eye className="mr-1 h-4 w-4" />
                            Preview
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              openAddModal(templateToDraft(template));
                            }}
                          >
                            Use Template
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      {activeTab === 'compatibility' ? (
        <ProtocolCompatibilityPanel onQuickCreate={openQuickCreateForProtocol} />
      ) : null}

      {activeTab === 'inbounds' && isLoading ? (
        <Card>
          <div className="space-y-4 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 rounded-xl border border-line/40 p-4">
                <Skeleton className="h-8 w-20 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/5" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-8 w-8 rounded-lg" />
              </div>
            ))}
          </div>
        </Card>
      ) : activeTab === 'inbounds' && inbounds.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <p className="mb-4 text-muted">No inbounds configured yet.</p>
            <Button onClick={() => openAddModal()}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Inbound
            </Button>
          </div>
        </Card>
      ) : activeTab === 'inbounds' ? (
        <div className="space-y-4">
          <Card className="p-4">
            <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-xl border border-line/70 bg-panel/60 p-3">
                <p className="text-xs uppercase tracking-wide text-muted">Total Inbounds</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{inbounds.length}</p>
              </div>
              <div className="rounded-xl border border-line/70 bg-panel/60 p-3">
                <p className="text-xs uppercase tracking-wide text-muted">Online Clients</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{onlineUuidSet.size}</p>
              </div>
              <div className="rounded-xl border border-line/70 bg-panel/60 p-3">
                <p className="text-xs uppercase tracking-wide text-muted">Expanded Rows</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{expandedInboundIds.length}</p>
              </div>
            </div>
          </Card>

          <Card className={tableVisibilityClass}>
            <div className="overflow-x-auto">
              <table className="min-w-[1080px] w-full text-sm">
                <thead className="bg-panel/70">
                  <tr className="border-b border-line/70 text-left text-xs uppercase tracking-wide text-muted">
                    <th className="px-3 py-3">Select</th>
                    <th className="px-3 py-3">Details</th>
                    <th className="px-3 py-3">Enabled</th>
                    <th className="px-3 py-3">Remark</th>
                    <th className="px-3 py-3">Port</th>
                    <th className="px-3 py-3">Protocol</th>
                    <th className="px-3 py-3">Clients</th>
                    <th className="px-3 py-3">Traffic</th>
                    <th className="px-3 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inbounds.map((inbound) => {
                    const clients = clientsByInbound.get(inbound.id) || [];
                    const onlineClients = clients.filter((client) => onlineUuidSet.has(client.uuid)).length;
                    const usedTraffic = clients.reduce((total, client) => total + client.totalUsed, 0);
                    const totalLimit = clients.reduce((total, client) => total + client.dataLimit, 0);
                    const trafficPercent = totalLimit > 0 ? Math.min((usedTraffic / totalLimit) * 100, 100) : 0;
                    const isExpanded = expandedInboundIds.includes(inbound.id);

                    return (
                      <React.Fragment key={inbound.id}>
                        <tr className="border-b border-line/70 hover:bg-panel/35">
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={selectedInboundIds.includes(inbound.id)}
                              onChange={() => toggleInboundSelection(inbound.id)}
                              className="h-4 w-4 rounded border-line/70 bg-card text-brand-500 focus:ring-brand-500/50"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <button
                              type="button"
                              onClick={() => toggleInboundExpanded(inbound.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-line/70 px-2 py-1 text-xs text-muted transition-colors hover:bg-card/80 hover:text-foreground"
                            >
                              {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              {isExpanded ? 'Hide' : 'Show'}
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            <button
                              type="button"
                              onClick={() => toggleInbound.mutate(inbound.id)}
                              className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs ${
                                inbound.enabled
                                  ? 'border-green-400/50 bg-green-500/10 text-green-300'
                                  : 'border-amber-400/50 bg-amber-500/10 text-amber-300'
                              }`}
                            >
                              {inbound.enabled ? 'On' : 'Off'}
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-col gap-1">
                              <span className="font-medium text-foreground">{inbound.remark || inbound.tag}</span>
                              <span className="text-xs text-muted">{inbound.tag}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">{inbound.port}</span>
                              <button
                                type="button"
                                onClick={() => randomizeInboundPort.mutate(inbound.id)}
                                disabled={randomizeInboundPort.isPending && randomizingPortId === inbound.id}
                                className="inline-flex items-center gap-1 rounded-md border border-line/70 px-2 py-1 text-xs text-muted transition-colors hover:bg-card/80 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                                title="Assign random free port"
                              >
                                <Shuffle className="h-3.5 w-3.5" />
                                Random
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${protocolColor[inbound.protocol]}`}>
                                {inbound.protocol}
                              </span>
                              <span className="text-xs text-muted">{inbound.network}/{inbound.security}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="space-y-1">
                              <p className="text-foreground">{onlineClients} online / {clients.length} total</p>
                              <p className="text-xs text-muted">Assigned: {inbound._count?.userInbounds || 0}</p>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="w-40">
                              <p className="text-xs text-muted">
                                {formatBytes(usedTraffic)} / {totalLimit > 0 ? formatBytes(totalLimit) : '∞'}
                              </p>
                              <div className="mt-1 h-2 rounded-full bg-panel/80">
                                <div
                                  className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-600"
                                  style={{ width: `${trafficPercent}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setProfileInbound(inbound)}
                                title="Client templates"
                                aria-label="Open client templates"
                              >
                                <FileCode2 className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDrawerInbound(inbound)}
                                title="Open inbound details"
                                aria-label="Open inbound details"
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => cloneInbound.mutate(inbound)}
                                loading={cloningId === inbound.id}
                                title="Clone inbound"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openCloneEditor(inbound)}
                                title="Clone and edit inbound"
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setDraftInbound(null);
                                  setEditingInbound(inbound);
                                }}
                                title="Edit inbound"
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              {canDeleteInbounds ? (
                                <Button variant="ghost" size="sm" onClick={() => void handleDelete(inbound.id)} title="Delete inbound">
                                  <Trash2 className="h-4 w-4 text-red-500" />
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>

                        {isExpanded ? (
                          <tr className="border-b border-line/70 bg-panel/30">
                            <td colSpan={9} className="px-4 py-4">
                              {clients.length === 0 ? (
                                <p className="text-sm text-muted">No clients assigned to this inbound yet.</p>
                              ) : (
                                <div className="overflow-x-auto">
                                  <table className="min-w-[880px] w-full text-sm">
                                    <thead>
                                      <tr className="text-left text-xs uppercase tracking-wide text-muted">
                                        <th className="px-2 py-2">Client</th>
                                        <th className="px-2 py-2">Online</th>
                                        <th className="px-2 py-2">Status</th>
                                        <th className="px-2 py-2">Traffic</th>
                                        <th className="px-2 py-2">Expiry</th>
                                        <th className="px-2 py-2">Action</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {clients.map((client) => {
                                        const isOnline = onlineUuidSet.has(client.uuid);
                                        const limit = client.dataLimit;
                                        const ratio = limit > 0 ? Math.min((client.totalUsed / limit) * 100, 100) : 0;
                                        const daysLeft = getDaysLeft(client.expireDate);
                                        return (
                                          <tr key={`${inbound.id}-${client.id}`} className="border-t border-line/70">
                                            <td className="px-2 py-2">
                                              <div className="flex flex-col">
                                                <span className="font-medium text-foreground">{client.email}</span>
                                                <span className="text-xs text-muted">{client.uuid.slice(0, 10)}...</span>
                                              </div>
                                            </td>
                                            <td className="px-2 py-2">
                                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                                                isOnline
                                                  ? 'bg-green-500/15 text-green-300'
                                                  : 'bg-zinc-500/15 text-zinc-300'
                                              }`}>
                                                {isOnline ? 'Online' : 'Offline'}
                                              </span>
                                            </td>
                                            <td className="px-2 py-2">
                                              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs ${
                                                client.status === 'ACTIVE'
                                                  ? 'bg-emerald-500/15 text-emerald-300'
                                                  : 'bg-amber-500/15 text-amber-300'
                                              }`}>
                                                {client.status}
                                              </span>
                                            </td>
                                            <td className="px-2 py-2">
                                              <div className="w-48">
                                                <p className="text-xs text-muted">
                                                  {formatBytes(client.totalUsed)} / {limit > 0 ? formatBytes(limit) : '∞'}
                                                </p>
                                                <div className="mt-1 h-2 rounded-full bg-panel/80">
                                                  <div
                                                    className="h-2 rounded-full bg-gradient-to-r from-brand-500 to-brand-600"
                                                    style={{ width: `${ratio}%` }}
                                                  />
                                                </div>
                                              </div>
                                            </td>
                                            <td className="px-2 py-2 text-xs text-muted">
                                              {daysLeft === null ? 'N/A' : daysLeft > 0 ? `${daysLeft}d left` : 'Expired'}
                                            </td>
                                            <td className="px-2 py-2">
                                              <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => navigate(`/users/${client.id}`)}
                                              >
                                                View
                                              </Button>
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className={cardsVisibilityClass}>
            {inbounds.map((inbound) => {
              const clients = clientsByInbound.get(inbound.id) || [];
              const onlineClients = clients.filter((client) => onlineUuidSet.has(client.uuid)).length;
              return (
                <Card key={`mobile-${inbound.id}`} className="transition-shadow hover:shadow-lg">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${protocolColor[inbound.protocol]}`}>
                          {inbound.protocol}
                        </span>
                        <h3 className="mt-2 text-base font-semibold text-foreground">{inbound.remark || inbound.tag}</h3>
                        <p className="text-xs text-muted">Port {inbound.port} • {inbound.network}/{inbound.security}</p>
                      </div>
                      <Badge variant={inbound.enabled ? 'success' : 'warning'}>{inbound.enabled ? 'Active' : 'Disabled'}</Badge>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Clients</span>
                      <span className="text-foreground">{onlineClients} online / {clients.length} total</span>
                    </div>

                    <div className="flex flex-wrap gap-2 border-t border-line/70 pt-3">
                      <Button variant="ghost" size="sm" onClick={() => toggleInbound.mutate(inbound.id)}>
                        {inbound.enabled ? <PowerOff className="mr-1 h-4 w-4" /> : <Power className="mr-1 h-4 w-4" />}
                        {inbound.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => randomizeInboundPort.mutate(inbound.id)} loading={randomizingPortId === inbound.id}>
                        <Shuffle className="mr-1 h-4 w-4" />
                        Random Port
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setProfileInbound(inbound)}>
                        <FileCode2 className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDrawerInbound(inbound)}>
                        <Eye className="h-4 w-4" />
                        Details
                      </Button>
                      {canDeleteInbounds ? (
                        <Button variant="ghost" size="sm" onClick={() => void handleDelete(inbound.id)}>
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      ) : null}

      {showMyanmarPackModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-2 backdrop-blur-sm sm:items-center sm:p-4">
          <div className="w-full max-w-xl rounded-2xl border border-line/80 bg-card/95 shadow-soft">
            <div className="border-b border-line/70 px-5 py-4">
              <h3 className="text-lg font-semibold text-foreground">Apply Myanmar Resilience Pack</h3>
              <p className="mt-1 text-sm text-muted">
                Creates three optimized profiles: VLESS REALITY XHTTP, VLESS WS TLS, and Trojan WS TLS.
              </p>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Server Address</label>
                <input
                  value={myanmarPackForm.serverAddress}
                  onChange={(event) =>
                    setMyanmarPackForm((previous) => ({ ...previous, serverAddress: event.target.value }))
                  }
                  placeholder="your.domain.com"
                  className="w-full rounded-lg border border-line/70 bg-panel/60 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">Server Name (SNI)</label>
                  <input
                    value={myanmarPackForm.serverName}
                    onChange={(event) =>
                      setMyanmarPackForm((previous) => ({ ...previous, serverName: event.target.value }))
                    }
                    placeholder="your.domain.com"
                    className="w-full rounded-lg border border-line/70 bg-panel/60 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">CDN Host (optional)</label>
                  <input
                    value={myanmarPackForm.cdnHost}
                    onChange={(event) =>
                      setMyanmarPackForm((previous) => ({ ...previous, cdnHost: event.target.value }))
                    }
                    placeholder="cdn.your.domain.com"
                    className="w-full rounded-lg border border-line/70 bg-panel/60 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Fallback Ports</label>
                <input
                  value={myanmarPackForm.fallbackPorts}
                  onChange={(event) =>
                    setMyanmarPackForm((previous) => ({ ...previous, fallbackPorts: event.target.value }))
                  }
                  placeholder="8443,9443"
                  className="w-full rounded-lg border border-line/70 bg-panel/60 px-3 py-2 text-sm text-foreground focus:border-brand-500/60 focus:outline-none"
                />
                <p className="mt-1 text-xs text-muted">Comma-separated ports used for WS/TLS fallback profiles.</p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-line/70 bg-panel/45 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">Assign to Users</p>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={selectAllMyanmarPackUsers}>
                        All
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={clearMyanmarPackUsers}>
                        Clear
                      </Button>
                    </div>
                  </div>
                  <p className="mb-2 text-xs text-muted">
                    Optional. Adds created profiles to selected users without removing existing keys.
                  </p>
                  <div className="max-h-40 space-y-1 overflow-auto pr-1">
                    {assignableUsers.length === 0 ? (
                      <p className="text-xs text-muted">No users found.</p>
                    ) : (
                      assignableUsers.map((user) => {
                        const userId = Number(user.id);
                        return (
                          <label key={`mm-pack-user-${userId}`} className="flex items-center gap-2 rounded-md px-1 py-1 text-xs text-foreground hover:bg-panel/55">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 rounded border-line/70 bg-card/90"
                              checked={selectedMyanmarUserSet.has(userId)}
                              onChange={(event) => toggleMyanmarPackUser(userId, event.target.checked)}
                            />
                            <span className="truncate">{user.email}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-line/70 bg-panel/45 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">Assign to Groups</p>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="sm" onClick={selectAllMyanmarPackGroups}>
                        All
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={clearMyanmarPackGroups}>
                        Clear
                      </Button>
                    </div>
                  </div>
                  <p className="mb-2 text-xs text-muted">
                    Optional. Merges created profiles into selected groups while keeping existing assignments.
                  </p>
                  <div className="max-h-40 space-y-1 overflow-auto pr-1">
                    {assignableGroupsSorted.length === 0 ? (
                      <p className="text-xs text-muted">No groups found.</p>
                    ) : (
                      assignableGroupsSorted.map((group) => {
                        const groupId = Number(group.id);
                        return (
                          <label key={`mm-pack-group-${groupId}`} className="flex items-center gap-2 rounded-md px-1 py-1 text-xs text-foreground hover:bg-panel/55">
                            <input
                              type="checkbox"
                              className="h-3.5 w-3.5 rounded border-line/70 bg-card/90"
                              checked={selectedMyanmarGroupSet.has(groupId)}
                              onChange={(event) => toggleMyanmarPackGroup(groupId, event.target.checked)}
                            />
                            <span className="truncate">{group.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>

              {myanmarPackPreview?.planned && myanmarPackPreview.planned.length > 0 ? (
                <div className="space-y-2 rounded-lg border border-line/70 bg-panel/50 p-3">
                  <p className="text-sm font-medium text-foreground">Preview Plan</p>
                  <div className="space-y-1 text-xs text-muted">
                    {myanmarPackPreview.planned.map((profile, index) => (
                      <div key={`${profile.tag || profile.protocol || index}`} className="flex items-center justify-between gap-2 rounded-md bg-panel/60 px-2 py-1">
                        <span className="text-foreground">
                          {String(profile.protocol || 'INBOUND')} • {String(profile.network || 'TCP')} • {String(profile.security || 'NONE')}
                        </span>
                        <span>{String(profile.port || '-')}</span>
                      </div>
                    ))}
                  </div>
                  {myanmarPackPreview.warnings && myanmarPackPreview.warnings.length > 0 ? (
                    <div className="space-y-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-xs text-amber-300">
                      {myanmarPackPreview.warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="flex items-center gap-3 border-t border-line/70 px-5 py-4">
              <Button
                variant="secondary"
                onClick={() => {
                  void applyMyanmarPack(true);
                }}
                loading={applyMyanmarPackMutation.isPending}
                className="flex-1"
              >
                Preview Plan
              </Button>
              <Button
                onClick={() => {
                  void applyMyanmarPack(false);
                }}
                loading={applyMyanmarPackMutation.isPending}
                className="flex-1"
              >
                Apply Pack
              </Button>
              <Button variant="secondary" onClick={() => setShowMyanmarPackModal(false)} className="flex-1">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {(showAddModal || editingInbound) ? (
        <InboundFormModal
          inbound={editingInbound || undefined}
          initialValues={draftInbound || undefined}
          onClose={closeModal}
          onSuccess={async () => {
            closeModal();
            await queryClient.invalidateQueries({ queryKey: ['inbounds'] });
          }}
        />
      ) : null}

      {profileInbound ? (
        <InboundClientProfileModal
          inbound={profileInbound}
          onClose={() => setProfileInbound(null)}
        />
      ) : null}

      {drawerInbound ? (
        <InboundClientsDrawer
          inbound={drawerInbound}
          clients={clientsByInbound.get(drawerInbound.id) || []}
          sessionsByUuid={sessionsByUuid}
          actionLoadingKey={clientActionLoadingKey}
          onClose={() => setDrawerInbound(null)}
          onViewUser={(userId) => navigate(`/users/${userId}`)}
          onToggleAccess={(client) => {
            void runClientAction(
              `u${client.id}-toggle`,
              async () => {
                await apiClient.post(`/users/${client.id}/inbounds/${drawerInbound.id}/toggle`, {
                  enabled: !client.enabled
                });
              },
              'Failed to toggle user key access'
            );
          }}
          onResetTraffic={(client) => {
            void runClientAction(
              `u${client.id}-reset`,
              async () => {
                await apiClient.post(`/users/${client.id}/reset-traffic`);
              },
              'Failed to reset user traffic'
            );
          }}
          onExtendExpiry={(client, days) => {
            void runClientAction(
              `u${client.id}-extend${days}`,
              async () => {
                await apiClient.post(`/users/${client.id}/extend-expiry`, { days });
              },
              'Failed to extend user expiry'
            );
          }}
          onDisableUser={(client) => {
            void runClientAction(
              `u${client.id}-disable`,
              async () => {
                await apiClient.put(`/users/${client.id}`, { status: 'DISABLED' });
              },
              'Failed to disable user'
            );
          }}
          onDecreasePriority={(client) => {
            void runClientAction(
              `u${client.id}-priority-down`,
              async () => {
                await apiClient.patch(`/users/${client.id}/inbounds/${drawerInbound.id}/priority`, {
                  priority: Math.max(1, Number(client.priority || 100) - 1)
                });
              },
              'Failed to update key priority'
            );
          }}
          onIncreasePriority={(client) => {
            void runClientAction(
              `u${client.id}-priority-up`,
              async () => {
                await apiClient.patch(`/users/${client.id}/inbounds/${drawerInbound.id}/priority`, {
                  priority: Math.min(9999, Number(client.priority || 100) + 1)
                });
              },
              'Failed to update key priority'
            );
          }}
        />
      ) : null}

      {previewTemplate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-3xl rounded-2xl border border-line/80 bg-card/95 p-5 shadow-soft">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-semibold text-foreground">{previewTemplate.name}</h3>
                <p className="mt-1 text-sm text-muted">{previewTemplate.description}</p>
              </div>
            </div>

            <div className="rounded-xl border border-line/70 bg-panel/60 p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Template JSON Preview</p>
              <pre className="max-h-[48vh] overflow-auto rounded-lg bg-card/80 p-3 text-xs text-foreground">
                {JSON.stringify(templateToDraft(previewTemplate), null, 2)}
              </pre>
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setPreviewTemplate(null)}>
                Close
              </Button>
              <Button
                onClick={() => {
                  openAddModal(templateToDraft(previewTemplate));
                  setPreviewTemplate(null);
                }}
              >
                Use Template
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmState)}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        tone="danger"
        loading={confirmLoading}
        onCancel={() => {
          if (!confirmLoading) {
            setConfirmState(null);
          }
        }}
        onConfirm={() => {
          void handleConfirmDelete();
        }}
      />

      {isFetching && !isLoading ? (
        <div className="fixed bottom-24 right-4 z-40 rounded-full border border-line/80 bg-card/90 px-3 py-1 text-xs text-muted shadow-soft lg:bottom-6">
          Refreshing inbounds...
        </div>
      ) : null}
    </div>
  );
};

export const InboundsPage = Inbounds;
