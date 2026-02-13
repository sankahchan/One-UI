import { useMutation, useQueryClient } from '@tanstack/react-query';

import * as authApi from '../api/auth';
import { useAuthStore } from '../store/authStore';
import type { LoginPayload } from '../types';

export function useAuth() {
  const queryClient = useQueryClient();
  const { login, logout, admin, isAuthenticated, refreshToken } = useAuthStore();

  const loginMutation = useMutation({
    mutationFn: (payload: LoginPayload) => authApi.login(payload),
    onSuccess: (result) => {
      login(result.token, result.admin, result.refreshToken);
    }
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await authApi.logout(refreshToken);
    },
    onSettled: () => {
      logout();
      void queryClient.invalidateQueries();
    }
  });

  return {
    admin,
    isAuthenticated,
    loginMutation,
    logoutMutation
  };
}
