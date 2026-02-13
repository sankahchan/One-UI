import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, RefreshCw, Save } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import apiClient, { API_URL } from '../../api/client';
import { Card } from '../../components/atoms/Card';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../store/authStore';

interface ConnectionLog {
  id: number;
  userId: number;
  inboundId: number;
  clientIp: string;
  action: string;
  timestamp: string;
  user?: { email: string };
  inbound?: { tag: string; port: number; protocol: string };
}

interface SystemAuditLog {
  id: number;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  message: string;
  metadata?: Record<string, unknown> | null;
  timestamp: string;
}

type XrayLogType = 'access' | 'error' | 'output';
type XrayLogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'UNKNOWN';
type XrayLogProtocol =
  | 'VLESS'
  | 'VMESS'
  | 'TROJAN'
  | 'SHADOWSOCKS'
  | 'SOCKS'
  | 'HTTP'
  | 'DOKODEMO_DOOR'
  | 'WIREGUARD'
  | 'MTPROTO'
  | 'UNKNOWN';

interface XrayParsedLogEntry {
  raw: string;
  timestamp: string;
  level: XrayLogLevel;
  protocol: XrayLogProtocol;
  ip: string;
  user: string;
}

interface XrayLogSnapshot {
  type: XrayLogType;
  path: string;
  missing: boolean;
  lines: string[];
  entries: XrayParsedLogEntry[];
  summary: {
    total: number;
    levels: Partial<Record<XrayLogLevel, number>>;
    protocols: Partial<Record<XrayLogProtocol, number>>;
  };
  filters: {
    search: string;
    level: string;
    protocol: string;
    ip: string;
    user: string;
  };
  timestamp: string;
}

const AuditTrailPanel: React.FC = () => {
  const token = useAuthStore((state) => state.token);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(30);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | ''>('');
  const [live, setLive] = useState(true);
  const [streamStatus, setStreamStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [streamError, setStreamError] = useState('');
  const [snapshot, setSnapshot] = useState<{ logs: SystemAuditLog[]; generatedAt?: string } | null>(null);

  const logsQuery = useQuery({
    queryKey: ['system-audit-logs', page, limit, search, level],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit)
      });
      if (search.trim()) {
        params.set('search', search.trim());
      }
      if (level) {
        params.set('level', level);
      }
      const response = await apiClient.get(`/logs/system?${params.toString()}`);
      return response.data as {
        logs: SystemAuditLog[];
        pagination: { page: number; totalPages: number; total: number; limit: number };
      };
    },
    enabled: !live
  });

  useEffect(() => {
    if (!logsQuery.data || live) {
      return;
    }
    setSnapshot({
      logs: logsQuery.data.logs || [],
      generatedAt: new Date().toISOString()
    });
  }, [live, logsQuery.data]);

  useEffect(() => {
    if (!live) {
      setStreamStatus('idle');
      setStreamError('');
      return;
    }

    if (!token) {
      setStreamStatus('error');
      setStreamError('Missing authentication token');
      return;
    }

    const MAX_RECONNECT_ATTEMPTS = 5;
    const abortController = new AbortController();
    const decoder = new TextDecoder();
    let buffer = '';
    let active = true;
    let reconnectCount = 0;
    let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null;

    const scheduleReconnect = () => {
      reconnectCount += 1;
      if (!active || abortController.signal.aborted || reconnectCount > MAX_RECONNECT_ATTEMPTS) {
        setStreamStatus('error');
        setStreamError(reconnectCount > MAX_RECONNECT_ATTEMPTS ? 'Stream unavailable after multiple retries.' : 'Stream disconnected.');
        return;
      }
      const delayMs = Math.min(1000 * (2 ** Math.max(0, reconnectCount - 1)), 15_000);
      setStreamStatus('connecting');
      setStreamError(`Stream disconnected. Retrying in ${(delayMs / 1000).toFixed(0)}s...`);
      reconnectTimer = window.setTimeout(() => { void connect(); }, delayMs);
    };

    const connect = async () => {
      setStreamStatus('connecting');
      setStreamError('');

      try {
        const params = new URLSearchParams({
          limit: String(limit),
          interval: '2000'
        });
        if (search.trim()) {
          params.set('search', search.trim());
        }
        if (level) {
          params.set('level', level);
        }

        const response = await fetch(`${API_URL}/logs/system/stream?${params.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream'
          },
          signal: abortController.signal,
          cache: 'no-store'
        });

        if (!response.ok || !response.body) {
          throw new Error(`Audit stream unavailable (${response.status})`);
        }

        if (!active) {
          return;
        }

        setStreamStatus('connected');
        const reader = response.body.getReader();

        while (active) {
          const { done, value } = await reader.read();
          if (done) {
            if (!abortController.signal.aborted && active) {
              scheduleReconnect();
            }
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() || '';

          for (const chunk of chunks) {
            const lines = chunk.split('\n');
            let eventName = 'message';
            const dataLines: string[] = [];

            for (const line of lines) {
              if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim());
              }
            }

            if (dataLines.length === 0) {
              continue;
            }

            const rawData = dataLines.join('\n');
            if (eventName === 'snapshot') {
              try {
                const parsed = JSON.parse(rawData) as { logs?: SystemAuditLog[]; generatedAt?: string };
                if (active) {
                  setSnapshot({
                    logs: parsed.logs || [],
                    generatedAt: parsed.generatedAt
                  });
                }
              } catch {
                // Ignore malformed frame.
              }
            } else if (eventName === 'error') {
              try {
                const parsed = JSON.parse(rawData) as { message?: string };
                if (active) {
                  setStreamStatus('error');
                  setStreamError(parsed.message || 'Audit stream error');
                }
              } catch {
                if (active) {
                  setStreamStatus('error');
                  setStreamError(rawData || 'Audit stream error');
                }
              }
            }
          }
        }
      } catch (error: any) {
        if (!abortController.signal.aborted && active) {
          setStreamError(error?.message || 'Failed to connect to audit stream');
          scheduleReconnect();
        }
      }
    };

    void connect();

    return () => {
      active = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      abortController.abort();
    };
  }, [level, limit, live, search, token]);

  const auditLogs = snapshot?.logs || [];
  const pagination = logsQuery.data?.pagination;

  const levelClassMap: Record<string, string> = {
    INFO: 'bg-blue-100 text-blue-700 dark:bg-blue-900/35 dark:text-blue-300',
    WARNING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/35 dark:text-amber-300',
    ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/35 dark:text-red-300',
    CRITICAL: 'bg-purple-100 text-purple-700 dark:bg-purple-900/35 dark:text-purple-300'
  };

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Audit Trail</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Review system actions, policy applies, and critical operational events.
            </p>
          </div>
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
              streamStatus === 'connected'
                ? 'bg-green-100 text-green-700 dark:bg-green-900/35 dark:text-green-300'
                : streamStatus === 'connecting'
                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/35 dark:text-yellow-300'
                : streamStatus === 'error'
                ? 'bg-red-100 text-red-700 dark:bg-red-900/35 dark:text-red-300'
                : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
            }`}
          >
            {live ? `live:${streamStatus}` : 'snapshot mode'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
          <Input
            placeholder="Search message..."
            value={search}
            onChange={(event) => {
              setPage(1);
              setSearch(event.target.value);
            }}
            className="lg:col-span-2"
          />
          <select
            value={level}
            onChange={(event) => {
              setPage(1);
              setLevel(event.target.value as 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | '');
            }}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            <option value="">All Levels</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="ERROR">ERROR</option>
            <option value="CRITICAL">CRITICAL</option>
          </select>
          <select
            value={limit}
            onChange={(event) => setLimit(Number.parseInt(event.target.value, 10))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            <option value={20}>20 rows</option>
            <option value={30}>30 rows</option>
            <option value={50}>50 rows</option>
            <option value={100}>100 rows</option>
          </select>
          <Button variant={live ? 'secondary' : 'primary'} onClick={() => setLive((previous) => !previous)}>
            {live ? 'Pause Live' : 'Resume Live'}
          </Button>
        </div>

        {streamError ? (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/25 dark:text-red-300">
            {streamError}
          </div>
        ) : null}

        {logsQuery.isLoading && !live ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading audit logs...</p>
        ) : auditLogs.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No audit logs found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Time</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Level</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Message</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Metadata</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
                {auditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                      {new Date(log.timestamp).toLocaleString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">
                      <span className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${levelClassMap[log.level] || 'bg-gray-100 text-gray-700'}`}>
                        {log.level}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">{log.message}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-300">
                      <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 p-2 dark:bg-gray-800/70">
                        {log.metadata ? JSON.stringify(log.metadata, null, 2) : '-'}
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!live && pagination ? (
          <div className="flex items-center justify-between pt-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((prev) => prev - 1)}>
              Previous
            </Button>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </Card>
  );
};

const XrayLiveLogsPanel: React.FC = () => {
  const token = useAuthStore((state) => state.token);
  const toast = useToast();
  const logRef = useRef<HTMLPreElement | null>(null);
  const [logType, setLogType] = useState<XrayLogType>('access');
  const [lineLimit, setLineLimit] = useState(200);
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<XrayLogLevel | ''>('');
  const [protocol, setProtocol] = useState<XrayLogProtocol | ''>('');
  const [ipFilter, setIpFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [live, setLive] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [streamStatus, setStreamStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [streamError, setStreamError] = useState('');
  const [snapshot, setSnapshot] = useState<XrayLogSnapshot | null>(null);
  const [copied, setCopied] = useState(false);

  const tailQuery = useQuery({
    queryKey: ['xray-log-tail', logType, lineLimit, search, level, protocol, ipFilter, userFilter],
    queryFn: async () => {
      const params = new URLSearchParams({
        type: logType,
        lines: String(lineLimit)
      });
      if (search.trim()) {
        params.set('search', search.trim());
      }
      if (level) {
        params.set('level', level);
      }
      if (protocol) {
        params.set('protocol', protocol);
      }
      if (ipFilter.trim()) {
        params.set('ip', ipFilter.trim());
      }
      if (userFilter.trim()) {
        params.set('user', userFilter.trim());
      }

      const response = await apiClient.get(`/logs/xray/tail?${params.toString()}`);
      return response.data as XrayLogSnapshot;
    },
    enabled: !live,
    refetchInterval: !live ? 5_000 : false
  });

  useEffect(() => {
    if (tailQuery.data) {
      setSnapshot(tailQuery.data);
    }
  }, [tailQuery.data]);

  useEffect(() => {
    if (!live) {
      setStreamStatus('idle');
      setStreamError('');
      return;
    }

    if (!token) {
      setStreamStatus('error');
      setStreamError('Missing authentication token');
      return;
    }

    const MAX_RECONNECT_ATTEMPTS = 5;
    const abortController = new AbortController();
    const decoder = new TextDecoder();
    let buffer = '';
    let active = true;
    let reconnectCount = 0;
    let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null;

    const scheduleReconnect = () => {
      reconnectCount += 1;
      if (!active || abortController.signal.aborted || reconnectCount > MAX_RECONNECT_ATTEMPTS) {
        setStreamStatus('error');
        setStreamError(reconnectCount > MAX_RECONNECT_ATTEMPTS ? 'Stream unavailable after multiple retries.' : 'Stream disconnected.');
        return;
      }
      const delayMs = Math.min(1000 * (2 ** Math.max(0, reconnectCount - 1)), 15_000);
      setStreamStatus('connecting');
      setStreamError(`Stream disconnected. Retrying in ${(delayMs / 1000).toFixed(0)}s...`);
      reconnectTimer = window.setTimeout(() => { void connect(); }, delayMs);
    };

    const connect = async () => {
      setStreamStatus('connecting');
      setStreamError('');

      try {
        const params = new URLSearchParams({
          type: logType,
          lines: String(lineLimit),
          interval: '2000'
        });
        if (search.trim()) {
          params.set('search', search.trim());
        }
        if (level) {
          params.set('level', level);
        }
        if (protocol) {
          params.set('protocol', protocol);
        }
        if (ipFilter.trim()) {
          params.set('ip', ipFilter.trim());
        }
        if (userFilter.trim()) {
          params.set('user', userFilter.trim());
        }

        const response = await fetch(`${API_URL}/logs/xray/stream?${params.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream'
          },
          signal: abortController.signal,
          cache: 'no-store'
        });

        if (!response.ok || !response.body) {
          throw new Error(`Stream unavailable (${response.status})`);
        }

        if (!active) {
          return;
        }

        setStreamStatus('connected');
        const reader = response.body.getReader();

        while (active) {
          const { done, value } = await reader.read();
          if (done) {
            if (!abortController.signal.aborted && active) {
              scheduleReconnect();
            }
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() || '';

          for (const chunk of chunks) {
            const lines = chunk.split('\n');
            let eventName = 'message';
            const dataLines: string[] = [];

            for (const line of lines) {
              if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim());
              }
            }

            if (dataLines.length === 0) {
              continue;
            }

            const rawData = dataLines.join('\n');
            if (eventName === 'snapshot') {
              try {
                const nextSnapshot = JSON.parse(rawData) as XrayLogSnapshot;
                if (active) {
                  setSnapshot(nextSnapshot);
                }
              } catch {
                // Ignore malformed stream frame.
              }
            } else if (eventName === 'error') {
              try {
                const parsed = JSON.parse(rawData) as { message?: string };
                if (active) {
                  setStreamError(parsed.message || 'Stream error');
                }
              } catch {
                if (active) {
                  setStreamError(rawData || 'Stream error');
                }
              }
            }
          }
        }
      } catch (error: any) {
        if (!abortController.signal.aborted && active) {
          setStreamError(error?.message || 'Failed to connect to Xray logs stream');
          scheduleReconnect();
        }
      }
    };

    void connect();

    return () => {
      active = false;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      abortController.abort();
    };
  }, [live, token, logType, lineLimit, search, level, protocol, ipFilter, userFilter]);

  useEffect(() => {
    if (!autoScroll || !logRef.current) {
      return;
    }

    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [snapshot?.timestamp, autoScroll]);

  const displayedLogs = useMemo(() => snapshot?.lines ?? [], [snapshot?.lines]);
  const parsedEntries = useMemo(() => snapshot?.entries ?? [], [snapshot?.entries]);
  const summary = snapshot?.summary;

  const refreshTail = async () => {
    if (live) {
      return;
    }
    await tailQuery.refetch();
  };

  const copyLogs = async () => {
    try {
      await navigator.clipboard.writeText(displayedLogs.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error('Copy failed', 'Failed to copy logs');
    }
  };

  const downloadLogs = () => {
    const blob = new Blob([displayedLogs.join('\n')], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `xray-${logType}-logs-${new Date().toISOString()}.log`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Xray Live Logs</h3>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
              Inspect access, error, and output logs in real time.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${
                streamStatus === 'connected'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/35 dark:text-green-300'
                  : streamStatus === 'connecting'
                  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/35 dark:text-yellow-300'
                  : streamStatus === 'error'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/35 dark:text-red-300'
                  : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
              }`}
            >
              {streamStatus}
            </span>
            {snapshot?.missing ? (
              <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-700 dark:bg-red-900/35 dark:text-red-300">
                File missing
              </span>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <select
            value={logType}
            onChange={(event) => setLogType(event.target.value as XrayLogType)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            <option value="access">access.log</option>
            <option value="error">error.log</option>
            <option value="output">output.log</option>
          </select>

          <select
            value={lineLimit}
            onChange={(event) => setLineLimit(Number.parseInt(event.target.value, 10))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            <option value={100}>Last 100 lines</option>
            <option value={200}>Last 200 lines</option>
            <option value={500}>Last 500 lines</option>
            <option value={1000}>Last 1000 lines</option>
          </select>

          <Input
            placeholder="Search logs..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="xl:col-span-2"
          />

          <select
            value={level}
            onChange={(event) => setLevel(event.target.value as XrayLogLevel | '')}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            <option value="">All Levels</option>
            <option value="DEBUG">DEBUG</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="ERROR">ERROR</option>
            <option value="UNKNOWN">UNKNOWN</option>
          </select>

          <select
            value={protocol}
            onChange={(event) => setProtocol(event.target.value as XrayLogProtocol | '')}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          >
            <option value="">All Protocols</option>
            <option value="VLESS">VLESS</option>
            <option value="VMESS">VMESS</option>
            <option value="TROJAN">TROJAN</option>
            <option value="SHADOWSOCKS">SHADOWSOCKS</option>
            <option value="SOCKS">SOCKS</option>
            <option value="HTTP">HTTP</option>
            <option value="DOKODEMO_DOOR">DOKODEMO_DOOR</option>
            <option value="WIREGUARD">WIREGUARD</option>
            <option value="MTPROTO">MTPROTO</option>
            <option value="UNKNOWN">UNKNOWN</option>
          </select>

          <Input
            placeholder="Filter IP..."
            value={ipFilter}
            onChange={(event) => setIpFilter(event.target.value)}
          />

          <Input
            placeholder="Filter user/email/uuid..."
            value={userFilter}
            onChange={(event) => setUserFilter(event.target.value)}
          />

          <div className="flex items-center gap-2">
            <Button
              variant={live ? 'secondary' : 'primary'}
              className="flex-1"
              onClick={() => setLive((previous) => !previous)}
            >
              {live ? 'Pause' : 'Resume'}
            </Button>
          </div>
        </div>

        {summary ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Matched Lines</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">{summary.total}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">ERROR</p>
              <p className="text-sm font-semibold text-red-600 dark:text-red-400">{summary.levels.ERROR || 0}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">WARNING</p>
              <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">{summary.levels.WARNING || 0}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
              <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">TOP PROTOCOL</p>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {Object.entries(summary.protocols).sort((a, b) => (b[1] || 0) - (a[1] || 0))[0]?.[0] || 'N/A'}
              </p>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void refreshTail();
            }}
            disabled={live}
            loading={tailQuery.isFetching}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAutoScroll((previous) => !previous)}>
            {autoScroll ? 'Auto-scroll: ON' : 'Auto-scroll: OFF'}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => { void copyLogs(); }}>
            <Copy className="mr-2 h-4 w-4" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button variant="secondary" size="sm" onClick={downloadLogs}>
            <Save className="mr-2 h-4 w-4" />
            Download
          </Button>
          <span className="text-xs text-gray-600 dark:text-gray-400">Entries: {parsedEntries.length}</span>
          {snapshot?.path ? (
            <span className="text-xs text-gray-600 dark:text-gray-400">Path: {snapshot.path}</span>
          ) : null}
        </div>

        {streamError ? (
          <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-900/25 dark:text-red-300">
            {streamError}
          </div>
        ) : null}

        <pre
          ref={logRef}
          className="max-h-[420px] overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs leading-5 text-gray-800 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
        >
          {displayedLogs.length > 0 ? displayedLogs.join('\n') : 'No log lines available.'}
        </pre>
      </div>
    </Card>
  );
};

const ConnectionLogsSettings: React.FC = () => {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState({ clientIp: '', action: '' });

  const { data: logsData, isLoading, refetch } = useQuery({
    queryKey: ['connection-logs', page, filter],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (filter.clientIp) params.set('clientIp', filter.clientIp);
      if (filter.action) params.set('action', filter.action);
      const response = await apiClient.get(`/logs/connections?${params.toString()}`);
      return response.data?.data as { logs: ConnectionLog[]; total: number; pages: number };
    },
    refetchInterval: 10000
  });

  const { data: stats } = useQuery({
    queryKey: ['connection-logs-stats'],
    queryFn: async () => {
      const response = await apiClient.get('/logs/connections/stats');
      return response.data?.data as { total: number; today: number; thisWeek: number };
    }
  });

  return (
    <div className="space-y-6">
      <AuditTrailPanel />

      <XrayLiveLogsPanel />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm text-gray-600 dark:text-gray-400">Total Logs</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats?.total?.toLocaleString() || 0}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-600 dark:text-gray-400">Today</p>
          <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{stats?.today?.toLocaleString() || 0}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-600 dark:text-gray-400">This Week</p>
          <p className="text-2xl font-bold text-green-600 dark:text-green-400">{stats?.thisWeek?.toLocaleString() || 0}</p>
        </Card>
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Connection Logs</h3>
          <div className="flex gap-2">
            <Input
              placeholder="Filter by IP..."
              value={filter.clientIp}
              onChange={(e) => setFilter(f => ({ ...f, clientIp: e.target.value }))}
              className="w-40"
            />
            <select
              value={filter.action}
              onChange={(e) => setFilter(f => ({ ...f, action: e.target.value }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            >
              <option value="">All Actions</option>
              <option value="connect">Connect</option>
              <option value="disconnect">Disconnect</option>
            </select>
            <Button variant="secondary" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-gray-500 dark:text-gray-400">Loading...</p>
        ) : !logsData?.logs?.length ? (
          <p className="text-gray-500 dark:text-gray-400">No connection logs yet.</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Time</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">User</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Inbound</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">IP</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
                  {logsData.logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {new Date(log.timestamp).toLocaleString()}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">
                        {log.user?.email || `User #${log.userId}`}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {log.inbound ? `${log.inbound.tag} (${log.inbound.protocol})` : `Inbound #${log.inboundId}`}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {log.clientIp}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm">
                        <span className={`inline-flex rounded-full px-2 text-xs font-semibold leading-5 ${log.action === 'connect'
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                          }`}>
                          {log.action}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <Button
                variant="secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <span className="text-sm text-gray-600 dark:text-gray-400">
                Page {page} of {logsData.pages}
              </span>
              <Button
                variant="secondary"
                disabled={page === logsData.pages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default ConnectionLogsSettings;
