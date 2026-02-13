import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createXrayConfigSnapshot,
  getXrayConfigSnapshots,
  getXrayConfDirStatus,
  getXrayGeodataStatus,
  getXrayRoutingProfile,
  getXrayRollbackBackups,
  getXrayUpdateReleaseIntel,
  getXrayUpdateHistory,
  getXrayUpdatePreflight,
  getXrayUpdatePolicy,
  getOnlineUsers,
  rollbackXrayConfigSnapshot,
  getXrayConfig,
  getXrayStatus,
  reloadXrayConfig,
  restartXray,
  runXrayCanaryUpdate,
  runXrayFullUpdate,
  runXrayRollback,
  runXrayUpdateUnlock,
  syncXrayConfDir,
  updateXrayGeodata,
  updateXrayRoutingProfile,
  type OnlineUsersResponse,
  type XrayActionResult,
  type XrayConfig,
  type XrayConfigSnapshotList,
  type XrayGeodataStatus,
  type XrayReleaseIntel,
  type XrayRoutingProfile,
  type XrayStatus,
  type XrayUpdateHistoryResponse,
  type XrayUpdatePreflight,
  type XrayUpdatePolicy,
  type XrayUpdateRunResult,
  type XrayUpdateUnlockRequest,
  type XrayUpdateUnlockResult,
  type XrayRollbackRequest
} from '../api/xray';

interface UseOnlineUsersOptions {
  refetchInterval?: number | false;
  staleTime?: number;
}

export const useOnlineUsers = (options: UseOnlineUsersOptions = {}) => {
  const refetchInterval = options.refetchInterval === undefined ? 10_000 : options.refetchInterval;
  const staleTime = options.staleTime === undefined ? 5_000 : options.staleTime;

  return useQuery<OnlineUsersResponse>({
    queryKey: ['online-users'],
    queryFn: getOnlineUsers,
    refetchInterval,
    staleTime
  });
};

export const useXrayStatus = () => {
  return useQuery<XrayStatus>({
    queryKey: ['xray-status'],
    queryFn: getXrayStatus,
    refetchInterval: 15_000,
    staleTime: 5_000
  });
};

export const useXrayConfig = (enabled = false) => {
  return useQuery<XrayConfig>({
    queryKey: ['xray-config'],
    queryFn: getXrayConfig,
    enabled,
    staleTime: 10_000
  });
};

export const useReloadXrayConfig = () => {
  const queryClient = useQueryClient();

  return useMutation<XrayActionResult>({
    mutationFn: reloadXrayConfig,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['xray-status'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-config'] });
      void queryClient.invalidateQueries({ queryKey: ['online-users'] });
    }
  });
};

export const useRestartXray = () => {
  const queryClient = useQueryClient();

  return useMutation<XrayActionResult>({
    mutationFn: restartXray,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['xray-status'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-config'] });
      void queryClient.invalidateQueries({ queryKey: ['online-users'] });
    }
  });
};

export const useXrayUpdatePolicy = () => {
  return useQuery<XrayUpdatePolicy>({
    queryKey: ['xray-update-policy'],
    queryFn: getXrayUpdatePolicy,
    refetchInterval: 30_000,
    staleTime: 10_000
  });
};

export const useXrayUpdatePreflight = (enabled = true) => {
  return useQuery<XrayUpdatePreflight>({
    queryKey: ['xray-update-preflight'],
    queryFn: getXrayUpdatePreflight,
    enabled,
    refetchInterval: 15_000,
    staleTime: 5_000
  });
};

export const useXrayUpdateHistory = (page = 1, limit = 20) => {
  return useQuery<XrayUpdateHistoryResponse>({
    queryKey: ['xray-update-history', page, limit],
    queryFn: () => getXrayUpdateHistory({ page, limit }),
    refetchInterval: 15_000,
    staleTime: 5_000
  });
};

export const useRunXrayCanaryUpdate = () => {
  const queryClient = useQueryClient();

  return useMutation<XrayUpdateRunResult, Error, { channel?: 'stable' | 'latest'; image?: string; noRollback?: boolean }>({
    mutationFn: runXrayCanaryUpdate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['xray-update-policy'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-update-preflight'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-update-history'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-status'] });
    }
  });
};

export const useRunXrayFullUpdate = () => {
  const queryClient = useQueryClient();

  return useMutation<XrayUpdateRunResult, Error, { channel?: 'stable' | 'latest'; image?: string; noRollback?: boolean; force?: boolean }>({
    mutationFn: runXrayFullUpdate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['xray-update-policy'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-update-preflight'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-update-history'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-status'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-config'] });
      void queryClient.invalidateQueries({ queryKey: ['online-users'] });
    }
  });
};

export const useXrayRollbackBackups = (enabled = true) => {
  return useQuery<string[]>({
    queryKey: ['xray-update-backups'],
    queryFn: getXrayRollbackBackups,
    enabled,
    refetchInterval: enabled ? 30_000 : false,
    staleTime: 10_000
  });
};

export const useRunXrayRollback = () => {
  const queryClient = useQueryClient();

  return useMutation<XrayUpdateRunResult, Error, XrayRollbackRequest>({
    mutationFn: runXrayRollback,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['xray-update-policy'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-update-preflight'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-update-history'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-update-backups'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-status'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-config'] });
      void queryClient.invalidateQueries({ queryKey: ['online-users'] });
    }
  });
};

export const useRunXrayUpdateUnlock = () => {
  const queryClient = useQueryClient();

  return useMutation<XrayUpdateUnlockResult, Error, XrayUpdateUnlockRequest>({
    mutationFn: runXrayUpdateUnlock,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['xray-update-preflight'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-update-policy'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-update-history'] });
    }
  });
};

export const useXrayUpdateReleaseIntel = (enabled = true) => {
  return useQuery<XrayReleaseIntel>({
    queryKey: ['xray-update-release-intel'],
    queryFn: () => getXrayUpdateReleaseIntel(),
    enabled,
    refetchInterval: 300_000,
    staleTime: 60_000
  });
};

export const useRefreshXrayUpdateReleaseIntel = () => {
  const queryClient = useQueryClient();
  return useMutation<XrayReleaseIntel>({
    mutationFn: () => getXrayUpdateReleaseIntel({ force: true }),
    onSuccess: (data) => {
      queryClient.setQueryData(['xray-update-release-intel'], data);
    }
  });
};

export const useXrayConfigSnapshots = (enabled = true) => {
  return useQuery<XrayConfigSnapshotList>({
    queryKey: ['xray-config-snapshots'],
    queryFn: () => getXrayConfigSnapshots({ limit: 50 }),
    enabled,
    refetchInterval: 30_000,
    staleTime: 5_000
  });
};

export const useCreateXrayConfigSnapshot = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createXrayConfigSnapshot,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['xray-config-snapshots'] });
    }
  });
};

export const useRollbackXrayConfigSnapshot = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: rollbackXrayConfigSnapshot,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['xray-config-snapshots'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-status'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-config'] });
    }
  });
};

export const useXrayRoutingProfile = (enabled = true) => {
  return useQuery<XrayRoutingProfile>({
    queryKey: ['xray-routing-profile'],
    queryFn: getXrayRoutingProfile,
    enabled,
    staleTime: 10_000
  });
};

export const useUpdateXrayRoutingProfile = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateXrayRoutingProfile,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['xray-routing-profile'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-config'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-status'] });
    }
  });
};

export const useXrayGeodataStatus = (enabled = true) => {
  return useQuery<XrayGeodataStatus>({
    queryKey: ['xray-geodata-status'],
    queryFn: () => getXrayGeodataStatus({ includeHash: false }),
    enabled,
    refetchInterval: 60_000,
    staleTime: 5_000
  });
};

export const useUpdateXrayGeodata = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateXrayGeodata,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['xray-geodata-status'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-config'] });
      void queryClient.invalidateQueries({ queryKey: ['xray-status'] });
    }
  });
};

export const useXrayConfDirStatus = (enabled = true) => {
  return useQuery({
    queryKey: ['xray-confdir-status'],
    queryFn: getXrayConfDirStatus,
    enabled,
    refetchInterval: 60_000,
    staleTime: 5_000
  });
};

export const useSyncXrayConfDir = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: syncXrayConfDir,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['xray-confdir-status'] });
    }
  });
};
