import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Admin {
  id: number;
  username: string;
  role: string;
  email?: string;
  twoFactorEnabled?: boolean;
}

interface AuthState {
  token: string | null;
  refreshToken: string | null;
  admin: Admin | null;
  isAuthenticated: boolean;
  login: (token: string, admin: Admin, refreshToken?: string) => void;
  setSession: (payload: { token: string; refreshToken?: string | null; admin?: Admin | null }) => void;
  setAdmin: (admin: Admin | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      admin: null,
      isAuthenticated: false,
      login: (token, admin, refreshToken = null) => {
        set({ token, refreshToken, admin, isAuthenticated: true });
      },
      setSession: ({ token, refreshToken, admin }) => {
        set((state) => ({
          token,
          refreshToken: refreshToken ?? state.refreshToken,
          admin: admin ?? state.admin,
          isAuthenticated: true
        }));
      },
      setAdmin: (admin) => {
        set((state) => ({
          admin,
          isAuthenticated: Boolean(state.token && admin)
        }));
      },
      logout: () => {
        set({ token: null, refreshToken: null, admin: null, isAuthenticated: false });
      }
    }),
    {
      name: 'auth-storage'
    }
  )
);
