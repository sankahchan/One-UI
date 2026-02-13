import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';

import { getToast } from '../utils/toastBridge';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      getToast()?.error('Request failed', error.message);
    }
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      getToast()?.error('Action failed', error.message);
    }
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000
    }
  }
});

