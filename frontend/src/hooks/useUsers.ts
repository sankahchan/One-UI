import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  usersApi,
  getUserSessions,
  bulkCreateUsers,
  bulkDelete,
  bulkResetTraffic,
  bulkExtendExpiry,
  bulkUpdateStatus,
  bulkRotateUserKeys,
  bulkRevokeUserKeys,
  rotateUserKeys,
  revokeUserKeys,
  regenerateSubscriptionToken,
  getUserActivity,
  killUser
} from '../api/users';
import { API_URL } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type {
  ApiResponse,
  SubscriptionInfo,
  User,
  UserDeviceSessionResponse,
  UserActivityPayload,
  UserActivityQueryParams,
  UserSessionSnapshotResponse,
  TelemetrySyncStatus
} from '../types';

export const useUsers = (params = {}) => {
  return useQuery<ApiResponse<User[]>>({
    queryKey: ['users', params],
    queryFn: () => usersApi.getUsers(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000
  });
};

export const useUser = (id: number) => {
  return useQuery<ApiResponse<User>>({
    queryKey: ['user', id],
    queryFn: () => usersApi.getUserById(id),
    enabled: !!id,
    staleTime: 30_000
  });
};

export const useUserDevices = (
  id: number,
  windowMinutes = 60,
  options: { refetchInterval?: number | false; staleTime?: number } = {}
) => {
  return useQuery<ApiResponse<UserDeviceSessionResponse>>({
    queryKey: ['user-devices', id, windowMinutes],
    queryFn: () => usersApi.getUserDevices(id, windowMinutes),
    enabled: !!id,
    staleTime: options.staleTime ?? 15_000,
    refetchInterval: options.refetchInterval
  });
};

export const useUserSessions = (
  userIds: number[],
  options: {
    refetchInterval?: number | false;
    staleTime?: number;
    includeOffline?: boolean;
    live?: boolean;
    streamInterval?: number;
  } = {}
) => {
  const token = useAuthStore((state) => state.token);
  const [streamData, setStreamData] = useState<UserSessionSnapshotResponse | null>(null);
  const [streamStatus, setStreamStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [streamError, setStreamError] = useState('');
  const [lastSnapshotAt, setLastSnapshotAt] = useState<string | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const live = options.live !== false;
  const includeOffline = options.includeOffline ?? true;
  const idsParam = useMemo(
    () => userIds.filter((id) => Number.isInteger(id) && id > 0).join(','),
    [userIds]
  );
  const streamInterval = Number.isInteger(options.streamInterval)
    ? Math.min(Math.max(options.streamInterval as number, 500), 10000)
    : 2000;
  const fallbackInterval = options.refetchInterval ?? 10_000;

  const query = useQuery<UserSessionSnapshotResponse>({
    queryKey: ['user-sessions', userIds, options.includeOffline ?? true],
    queryFn: () => getUserSessions(userIds, { includeOffline: options.includeOffline ?? true, limit: Math.max(1, userIds.length) }),
    enabled: userIds.length > 0,
    refetchInterval: live ? (streamStatus === 'connected' ? false : fallbackInterval) : fallbackInterval,
    staleTime: options.staleTime ?? 5_000
  });

  useEffect(() => {
    if (!live) {
      setStreamStatus('idle');
      setStreamError('');
      setReconnectAttempts(0);
      return;
    }

    if (userIds.length === 0) {
      setStreamStatus('idle');
      setStreamError('');
      setReconnectAttempts(0);
      setStreamData(null);
      return;
    }

    if (!token) {
      setStreamStatus('error');
      setStreamError('Missing auth token');
      return;
    }

    const abortController = new AbortController();
    const decoder = new TextDecoder();
    let buffer = '';
    let active = true;
    let reconnectTimer: ReturnType<typeof window.setTimeout> | null = null;
    let reconnectCount = 0;

    const clearReconnectTimer = () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const MAX_RECONNECT_ATTEMPTS = 10;

    const scheduleReconnect = (reason?: string) => {
      if (!active || abortController.signal.aborted) {
        return;
      }

      reconnectCount += 1;
      setReconnectAttempts(reconnectCount);

      if (reconnectCount > MAX_RECONNECT_ATTEMPTS) {
        setStreamStatus('error');
        setStreamError('Live stream unavailable after multiple retries. Falling back to polling.');
        return;
      }

      const delayMs = Math.min(1000 * (2 ** Math.max(0, reconnectCount - 1)), 15_000);

      setStreamStatus('connecting');
      setStreamError(reason || `Stream disconnected. Retrying in ${(delayMs / 1000).toFixed(0)}s...`);

      clearReconnectTimer();
      reconnectTimer = window.setTimeout(() => {
        void connect();
      }, delayMs);
    };

    const connect = async () => {
      if (!active || abortController.signal.aborted) {
        return;
      }

      setStreamStatus('connecting');
      if (reconnectCount === 0) {
        setStreamError('');
      }

      try {
        const params = new URLSearchParams({
          userIds: idsParam,
          includeOffline: String(includeOffline),
          limit: String(userIds.length || 200),
          interval: String(streamInterval)
        });

        const response = await fetch(`${API_URL}/users/sessions/stream?${params.toString()}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream'
          },
          signal: abortController.signal,
          cache: 'no-store'
        });

        if (!response.ok || !response.body) {
          throw new Error(`Live session stream unavailable (${response.status})`);
        }

        if (!active) {
          return;
        }

        setStreamStatus('connected');
        setStreamError('');
        reconnectCount = 0;
        setReconnectAttempts(0);
        const reader = response.body.getReader();

        while (active) {
          const { done, value } = await reader.read();
          if (done) {
            if (!abortController.signal.aborted) {
              scheduleReconnect('Live stream ended unexpectedly.');
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
                const payload = JSON.parse(rawData) as UserSessionSnapshotResponse;
                if (active) {
                  setStreamData(payload);
                  setLastSnapshotAt(payload.generatedAt || new Date().toISOString());
                  setStreamStatus('connected');
                  setStreamError('');
                }
              } catch {
                // Ignore malformed stream frame.
              }
            } else if (eventName === 'error') {
              try {
                const parsed = JSON.parse(rawData) as { message?: string };
                if (active) {
                  setStreamError(parsed.message || 'Live stream error');
                  setStreamStatus('error');
                  scheduleReconnect(parsed.message || 'Live stream error');
                }
              } catch {
                if (active) {
                  setStreamError(rawData || 'Live stream error');
                  setStreamStatus('error');
                  scheduleReconnect(rawData || 'Live stream error');
                }
              }
            }
          }
        }
      } catch (error: any) {
        if (!abortController.signal.aborted && active) {
          setStreamStatus('error');
          const errorMessage = error?.message || 'Failed to connect live stream';
          setStreamError(errorMessage);
          scheduleReconnect(errorMessage);
        }
      }
    };

    void connect();

    return () => {
      active = false;
      clearReconnectTimer();
      abortController.abort();
    };
  }, [fallbackInterval, includeOffline, idsParam, live, streamInterval, token, userIds.length]);

  return {
    ...query,
    data: streamData || query.data,
    streamStatus,
    streamError,
    lastSnapshotAt,
    reconnectAttempts
  };
};

export const useTelemetrySyncStatus = (options: { refetchInterval?: number | false; staleTime?: number } = {}) => {
  return useQuery<ApiResponse<TelemetrySyncStatus>>({
    queryKey: ['users-telemetry-sync-status'],
    queryFn: () => usersApi.getTelemetrySyncStatus(),
    staleTime: options.staleTime ?? 5_000,
    refetchInterval: options.refetchInterval ?? 5_000
  });
};

export const useRunFallbackAutotune = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => usersApi.runFallbackAutotune(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['users-telemetry-sync-status'] });
    }
  });
};

export const useRunUserDiagnostics = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload?: { windowMinutes?: number; portProbeTimeoutMs?: number } }) =>
      usersApi.runDiagnostics(id, payload || {}),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['user', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['users-telemetry-sync-status'] });
    }
  });
};

export const useCreateUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: usersApi.createUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    }
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => usersApi.updateUser(id, data),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user', variables.id] });
    }
  });
};

export const useDeleteUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: usersApi.deleteUser,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    }
  });
};

export const useRevokeUserDevice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, fingerprint }: { id: number; fingerprint: string }) =>
      usersApi.revokeUserDevice(id, fingerprint),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['user-devices', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
    }
  });
};

export const useKillUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => killUser(id),
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user', id] });
      void queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
    }
  });
};

export const useResetTraffic = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: usersApi.resetTraffic,
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user', id] });
    }
  });
};

export const useExtendExpiry = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, days }: { id: number; days: number }) => usersApi.extendExpiry(id, days),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user', variables.id] });
    }
  });
};

export const useToggleUserInbound = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, inboundId, enabled }: { id: number; inboundId: number; enabled?: boolean }) =>
      usersApi.toggleUserInbound(id, inboundId, enabled),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['user', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['inbounds'] });
    }
  });
};

export const useUpdateUserInboundPriority = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, inboundId, priority }: { id: number; inboundId: number; priority: number }) =>
      usersApi.updateUserInboundPriority(id, inboundId, priority),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['user', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['inbounds-users-directory'] });
    }
  });
};

export const useReorderUserInbounds = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, assignments }: { id: number; assignments: Array<{ inboundId: number; priority: number; enabled?: boolean }> }) =>
      usersApi.reorderUserInbounds(id, assignments),
    onSuccess: (_result, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['user', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['inbounds-users-directory'] });
    }
  });
};

export const useSubscriptionInfo = (id: number) => {
  return useQuery<ApiResponse<SubscriptionInfo>>({
    queryKey: ['subscription-info', id],
    queryFn: () => usersApi.getSubscriptionInfo(id),
    enabled: !!id
  });
};

export const useUserActivity = (id: number, params: UserActivityQueryParams = {}) => {
  return useQuery<UserActivityPayload>({
    queryKey: ['user-activity', id, params],
    queryFn: () => getUserActivity(id, params),
    enabled: !!id,
    placeholderData: keepPreviousData,
    staleTime: 10_000
  });
};

export const useBulkDelete = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userIds: number[]) => bulkDelete(userIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    }
  });
};

export const useBulkCreateUsers = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: bulkCreateUsers,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    }
  });
};

export const useBulkResetTraffic = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userIds: number[]) => bulkResetTraffic(userIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    }
  });
};

export const useBulkExtendExpiry = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userIds, days }: { userIds: number[]; days: number }) => bulkExtendExpiry(userIds, days),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    }
  });
};

export const useBulkUpdateStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userIds, status }: { userIds: number[]; status: string }) => bulkUpdateStatus(userIds, status),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    }
  });
};

export const useRotateUserKeys = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data?: any }) => rotateUserKeys(id, data || {}),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['subscription-info', variables.id] });
    }
  });
};

export const useRevokeUserKeys = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: number; data?: any }) => revokeUserKeys(id, data || {}),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user', variables.id] });
      void queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
      void queryClient.invalidateQueries({ queryKey: ['subscription-info', variables.id] });
    }
  });
};

export const useRegenerateSubscriptionToken = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => regenerateSubscriptionToken(id),
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user', id] });
      void queryClient.invalidateQueries({ queryKey: ['subscription-info', id] });
      void queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
    }
  });
};

export const useBulkRotateUserKeys = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userIds, data }: { userIds: number[]; data?: any }) => bulkRotateUserKeys(userIds, data || {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
    }
  });
};

export const useBulkRevokeUserKeys = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userIds, data }: { userIds: number[]; data?: any }) => bulkRevokeUserKeys(userIds, data || {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      void queryClient.invalidateQueries({ queryKey: ['user-sessions'] });
    }
  });
};
