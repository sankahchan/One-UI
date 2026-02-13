import apiClient from '../api/client';
import { groupsApi } from '../api/groups';
import { inboundsApi } from '../api/inbounds';
import { usersApi } from '../api/users';
import { getOnlineUsers } from '../api/xray';
import { queryClient } from '../lib/queryClient';

type PrefetchOptions = {
  includeData?: boolean;
  force?: boolean;
};

type DataPrefetcher = (path: string) => Promise<void>;

const modulePrefetchers: Record<string, () => Promise<unknown>> = {
  '/dashboard': () => import('../pages/Dashboard'),
  '/users': () => import('../pages/Users'),
  '/groups': () => import('../pages/Groups'),
  '/users/:id': () => import('../pages/UserDetail'),
  '/inbounds': () => import('../pages/Inbounds'),
  '/settings': () => import('../pages/Settings')
};

const defaultUsersQueryParams = {
  page: 1,
  limit: 50,
  search: '',
  status: undefined as string | undefined
};

const defaultGroupsQueryParams = {
  page: 1,
  limit: 20,
  search: '',
  includeDisabled: true
};

const defaultGroupTemplatesQueryParams = {
  page: 1,
  limit: 20,
  search: ''
};

const DATA_PREFETCH_COOLDOWN_MS = 20_000;
const prefetchedModuleKeys = new Set<string>();
const prefetchedDataAt = new Map<string, number>();

function normalizeRouteKey(path: string) {
  if (path.startsWith('/users/')) {
    return '/users/:id';
  }
  if (path.startsWith('/groups/')) {
    return '/groups';
  }
  return path;
}

function parseUserId(path: string) {
  const match = path.match(/^\/users\/(\d+)$/);
  if (!match) {
    return null;
  }
  const id = Number.parseInt(match[1], 10);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return id;
}

const dataPrefetchers: Record<string, DataPrefetcher> = {
  '/dashboard': async () => {
    const [statsResult, onlineUsersResult] = await Promise.allSettled([
      apiClient.get('/users/stats'),
      getOnlineUsers()
    ]);

    if (statsResult.status === 'fulfilled') {
      queryClient.setQueryData(['system-stats'], statsResult.value);
    }
    if (onlineUsersResult.status === 'fulfilled') {
      queryClient.setQueryData(['online-users'], onlineUsersResult.value);
    }
  },
  '/users': async () => {
    const usersResponse = await usersApi.getUsers(defaultUsersQueryParams);
    queryClient.setQueryData(['users', defaultUsersQueryParams], usersResponse);
  },
  '/groups': async () => {
    const [groupsResponse, templatesResponse] = await Promise.all([
      groupsApi.list(defaultGroupsQueryParams),
      groupsApi.listTemplates(defaultGroupTemplatesQueryParams)
    ]);

    queryClient.setQueryData(['groups', defaultGroupsQueryParams], groupsResponse);
    queryClient.setQueryData(['group-policy-templates', defaultGroupTemplatesQueryParams], templatesResponse);
  },
  '/inbounds': async () => {
    const inboundsResponse = await inboundsApi.getInbounds();
    queryClient.setQueryData(['inbounds'], inboundsResponse.data ?? []);
  },
  '/users/:id': async (path: string) => {
    const userId = parseUserId(path);
    if (!userId) {
      return;
    }

    const [userResponse, devicesResponse] = await Promise.all([
      usersApi.getUserById(userId),
      usersApi.getUserDevices(userId, 60)
    ]);

    queryClient.setQueryData(['user', userId], userResponse);
    queryClient.setQueryData(['user-devices', userId, 60], devicesResponse);
  }
};

export function prefetchRoute(path: string, options: PrefetchOptions = {}) {
  const key = normalizeRouteKey(path);
  const includeData = options.includeData ?? true;
  const force = options.force ?? false;

  const modulePrefetch = modulePrefetchers[key];
  if (modulePrefetch && (force || !prefetchedModuleKeys.has(key))) {
    prefetchedModuleKeys.add(key);
    void modulePrefetch();
  }

  if (!includeData) {
    return;
  }

  const dataPrefetch = dataPrefetchers[key];
  if (!dataPrefetch) {
    return;
  }

  const lastPrefetchedAt = prefetchedDataAt.get(path) ?? 0;
  if (!force && Date.now() - lastPrefetchedAt < DATA_PREFETCH_COOLDOWN_MS) {
    return;
  }

  prefetchedDataAt.set(path, Date.now());
  void dataPrefetch(path).catch(() => {
    // Ignore prefetch failures. Active views will retry with regular queries.
  });
}
