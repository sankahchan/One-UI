import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { ArrowRight, Lock, LogIn, ShieldCheck, UserRound } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '../components/atoms/Button';
import { Input } from '../components/atoms/Input';
import { ThemeToggle } from '../components/molecules/ThemeToggle';
import { authApi, type TelegramLoginPayload, type LoginInfo } from '../api/auth';
import { useAuthStore } from '../store/authStore';

interface LoginForm {
  username: string;
  password: string;
  otp?: string;
}

type TelegramWindow = Window & {
  oneUiTelegramAuth?: (payload: TelegramLoginPayload) => void;
};

export const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login } = useAuthStore();
  const telegramContainerRef = useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [telegramLoading, setTelegramLoading] = useState(false);
  const [error, setError] = useState('');
  const [showOtp, setShowOtp] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<LoginForm>();

  const { data: loginInfo } = useQuery<LoginInfo>({
    queryKey: ['login-info'],
    queryFn: () => authApi.getLoginInfo(),
    staleTime: 5 * 60 * 1000
  });

  const { data: telegramConfig } = useQuery({
    queryKey: ['telegram-oauth-config'],
    queryFn: () => authApi.getTelegramConfig(),
    staleTime: 5 * 60 * 1000
  });

  // Auto-show OTP field when backend requires 2FA for SUPER_ADMIN
  useEffect(() => {
    if (loginInfo?.requireTwoFactorForSuperAdmin) {
      setShowOtp(true);
    }
  }, [loginInfo?.requireTwoFactorForSuperAdmin]);

  const handleTelegramAuth = useCallback(async (payload: TelegramLoginPayload) => {
    setTelegramLoading(true);
    setError('');
    try {
      const response = await authApi.loginWithTelegram(payload);
      login(response.token, response.admin, response.refreshToken);
      navigate('/dashboard');
    } catch (err: any) {
      setError(err?.message || 'Telegram login failed');
    } finally {
      setTelegramLoading(false);
    }
  }, [login, navigate]);

  useEffect(() => {
    const container = telegramContainerRef.current;
    if (!telegramConfig?.enabled || !telegramConfig.botUsername || !container) {
      return undefined;
    }

    const telegramWindow = window as TelegramWindow;
    telegramWindow.oneUiTelegramAuth = (payload: TelegramLoginPayload) => {
      void handleTelegramAuth(payload);
    };

    container.innerHTML = '';
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://telegram.org/js/telegram-widget.js?22';
    script.setAttribute('data-telegram-login', telegramConfig.botUsername);
    script.setAttribute('data-size', 'large');
    script.setAttribute('data-radius', '10');
    script.setAttribute('data-request-access', 'write');
    script.setAttribute('data-userpic', 'false');
    script.setAttribute('data-onauth', 'oneUiTelegramAuth(user)');
    container.appendChild(script);

    return () => {
      container.innerHTML = '';
      delete telegramWindow.oneUiTelegramAuth;
    };
  }, [telegramConfig?.enabled, telegramConfig?.botUsername, handleTelegramAuth]);

  const onSubmit = async (data: LoginForm) => {
    setLoading(true);
    setError('');

    try {
      const response = await authApi.login(data);
      login(response.token, response.admin, response.refreshToken);
      if (response.requiresTwoFactorSetup) {
        navigate('/settings?tab=security');
      } else {
        navigate('/dashboard');
      }
    } catch (err: any) {
      const message = err?.message || 'Login failed';
      setError(message);
      if (String(message).toLowerCase().includes('two-factor')) {
        setShowOtp(true);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-8 sm:px-6">
      <div className="absolute right-4 top-4 z-10 sm:right-6 sm:top-6">
        <ThemeToggle />
      </div>

      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-line/70 bg-card/82 shadow-[0_30px_75px_-45px_rgba(15,23,42,0.7)] backdrop-blur-2xl lg:grid-cols-[1.15fr_1fr]">
        <div className="relative hidden overflow-hidden border-r border-line/70 p-10 lg:block">
          <div className="absolute inset-0 bg-gradient-to-br from-brand-500/18 via-transparent to-brand-600/18" />
          <div className="relative z-10">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted">ONE-UI</p>
            <h1 className="mt-4 text-4xl font-bold leading-tight text-foreground">
              Sleek control for your network operations.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">
              Manage users, subscriptions, inbounds, and system health from one responsive dashboard designed for desktop and mobile workflows.
            </p>

            <div className="mt-10 space-y-3">
              <div className="glass flex items-center gap-3 rounded-xl px-4 py-3">
                <ShieldCheck className="h-5 w-5 text-brand-500" />
                <span className="text-sm font-medium text-foreground">JWT-secured admin access</span>
              </div>
              <div className="glass flex items-center gap-3 rounded-xl px-4 py-3">
                <Lock className="h-5 w-5 text-brand-500" />
                <span className="text-sm font-medium text-foreground">Encrypted credentials and role-based controls</span>
              </div>
            </div>
          </div>
        </div>

        <div className="p-6 sm:p-10">
          <div className="mb-8">
            <h2 className="text-3xl font-bold text-foreground">Welcome back</h2>
            <p className="mt-2 text-sm text-muted">Sign in to continue to the admin panel.</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {loginInfo?.requireTwoFactorForSuperAdmin ? (
              <div className="rounded-xl border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-sm text-brand-600 dark:text-brand-300">
                Two-factor authentication is required for SUPER_ADMIN accounts.
              </div>
            ) : null}

            {error ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
                {error}
              </div>
            ) : null}

            <Input
              label="Username"
              autoComplete="username"
              placeholder="Enter your username"
              {...register('username', { required: 'Username is required' })}
              error={errors.username?.message}
            />

            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              {...register('password', { required: 'Password is required' })}
              error={errors.password?.message}
            />

            {showOtp ? (
              <Input
                label="One-Time Password"
                placeholder="Enter 6-digit code"
                inputMode="numeric"
                autoComplete="one-time-code"
                {...register('otp', {
                  minLength: {
                    value: 6,
                    message: 'OTP must be at least 6 digits'
                  },
                  maxLength: {
                    value: 8,
                    message: 'OTP must be at most 8 digits'
                  }
                })}
                error={errors.otp?.message}
              />
            ) : null}

            <Button type="submit" className="mt-2 w-full" size="lg" loading={loading}>
              <LogIn className="mr-2 h-5 w-5" />
              Sign In
            </Button>

            {telegramConfig?.enabled ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3 text-xs text-muted">
                  <span className="h-px flex-1 bg-line/80" />
                  <span>or continue with Telegram</span>
                  <span className="h-px flex-1 bg-line/80" />
                </div>
                <div className="flex min-h-[44px] items-center justify-center rounded-xl border border-line/70 bg-card/70 p-2">
                  {telegramLoading ? (
                    <span className="text-sm text-muted">Signing in with Telegram...</span>
                  ) : (
                    <div ref={telegramContainerRef} />
                  )}
                </div>
              </div>
            ) : null}

            {!showOtp ? (
              <button
                type="button"
                className="w-full text-center text-xs text-muted underline-offset-4 transition hover:text-foreground hover:underline"
                onClick={() => setShowOtp(true)}
              >
                I use 2FA
              </button>
            ) : null}
          </form>

          <div className="mt-8 flex items-center justify-center gap-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5">
              <UserRound className="h-3.5 w-3.5 text-brand-500/60" />
              Role-based access
            </span>
            <span className="h-3 w-px bg-line/60" />
            <span className="inline-flex items-center gap-1.5">
              <ArrowRight className="h-3.5 w-3.5 text-brand-500/60" />
              Mobile-friendly panel
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export const LoginPage = Login;
