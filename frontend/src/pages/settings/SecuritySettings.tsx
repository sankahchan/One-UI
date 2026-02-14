import React, { useEffect, useState } from 'react';
import { Shield, Trash2 } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { authApi } from '../../api/auth';
import apiClient from '../../api/client';
import { Card } from '../../components/atoms/Card';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { useToast } from '../../hooks/useToast';
import { useAuthStore } from '../../store/authStore';

interface AuthAdminProfile {
  id: number;
  username: string;
  role: string;
  email?: string;
  twoFactorEnabled?: boolean;
}

interface TwoFactorSetupData {
  secret: string;
  issuer: string;
  otpAuthUrl: string;
}

interface SecurityRule {
  id: number;
  name: string;
  enabled: boolean;
  action: 'ALLOW' | 'BLOCK';
  targetType: 'IP' | 'CIDR' | 'COUNTRY';
  targetValue: string;
  priority: number;
  hitCount: number | string;
  lastMatchedAt?: string | null;
  note?: string | null;
}

interface SecurityPolicies {
  requireTwoFactorForSuperAdmin: boolean;
  strictSessionBinding: boolean;
  requirePrivateIp: boolean;
  secretsEncryptionConfigured: boolean;
  secretsEncryptionRequired: boolean;
}

interface SecurityEventLog {
  id: number;
  level: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  message: string;
  metadata?: Record<string, unknown> | null;
  timestamp: string;
}

interface NotificationChannelRoute {
  webhook: boolean;
  telegram: boolean;
  systemLog: boolean;
}

interface NotificationRouteMatrix {
  default: NotificationChannelRoute;
  routes: Record<string, NotificationChannelRoute>;
}

interface NotificationConfig {
  routeMatrix: NotificationRouteMatrix;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
}

type SecurityEventLevelFilter = 'ALL' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
type SecurityEventTypeFilter = 'ALL' | 'AUTH' | 'POLICY' | 'RULE' | 'ACCESS';
type SecurityEventWindow = '15m' | '1h' | '24h' | '7d' | '30d';

const SECURITY_EVENT_TYPE_SEARCH: Record<SecurityEventTypeFilter, string> = {
  ALL: 'SECURITY_',
  AUTH: 'SECURITY_AUTH_',
  POLICY: 'SECURITY_POLICIES_',
  RULE: 'SECURITY_RULE_',
  ACCESS: 'SECURITY_IP_ALLOWLIST_'
};

const SECURITY_CHANGE_ROUTE_KEYS = [
  'security.policy.updated',
  'security.allowlist.updated',
  'security.rule.created',
  'security.rule.updated',
  'security.rule.toggled',
  'security.rule.deleted'
] as const;

function normalizeRoute(base: NotificationChannelRoute | undefined, fallback: NotificationChannelRoute): NotificationChannelRoute {
  const source = base || fallback;
  return {
    webhook: Boolean(source.webhook),
    telegram: Boolean(source.telegram),
    systemLog: Boolean(source.systemLog)
  };
}

function resolveRoute(matrix: NotificationRouteMatrix | undefined, key: string): NotificationChannelRoute {
  const fallback = normalizeRoute(matrix?.default, {
    webhook: true,
    telegram: false,
    systemLog: true
  });
  return normalizeRoute(matrix?.routes?.[key], fallback);
}

function getWindowStartIso(windowValue: SecurityEventWindow) {
  const now = Date.now();
  const map: Record<SecurityEventWindow, number> = {
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };
  return new Date(now - map[windowValue]).toISOString();
}

function toEventLabel(rawMessage: string) {
  return String(rawMessage || '')
    .replace(/^SECURITY_/, '')
    .replace(/_/g, ' ')
    .trim();
}

function escapeCsv(value: unknown) {
  const normalized = String(value ?? '');
  const escaped = normalized.replace(/"/g, '""');
  return `"${escaped}"`;
}

const SecuritySettings: React.FC = () => {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useTranslation();
  const authAdmin = useAuthStore((state) => state.admin);
  const setAuthAdmin = useAuthStore((state) => state.setAdmin);
  const isSuperAdmin = authAdmin?.role === 'SUPER_ADMIN';
  const [setupData, setSetupData] = useState<TwoFactorSetupData | null>(null);
  const [profileUsername, setProfileUsername] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [enableOtp, setEnableOtp] = useState('');
  const [disableOtp, setDisableOtp] = useState('');
  const [allowlistInput, setAllowlistInput] = useState('');
  const [forceCurrentIp, setForceCurrentIp] = useState(false);
  const [requirePrivateIp, setRequirePrivateIp] = useState(false);
  const [requireTwoFactorForSuperAdmin, setRequireTwoFactorForSuperAdmin] = useState(false);
  const [strictSessionBinding, setStrictSessionBinding] = useState(false);
  const [secretsEncryptionRequired, setSecretsEncryptionRequired] = useState(false);
  const [secretsEncryptionConfigured, setSecretsEncryptionConfigured] = useState(false);
  const [ruleName, setRuleName] = useState('');
  const [ruleAction, setRuleAction] = useState<'ALLOW' | 'BLOCK'>('BLOCK');
  const [ruleTargetType, setRuleTargetType] = useState<'IP' | 'CIDR' | 'COUNTRY'>('IP');
  const [ruleTargetValue, setRuleTargetValue] = useState('');
  const [rulePriority, setRulePriority] = useState(100);
  const [criticalSecurityTelegram, setCriticalSecurityTelegram] = useState(false);
  const [failedLoginTelegram, setFailedLoginTelegram] = useState(false);
  const [securityChangeTelegram, setSecurityChangeTelegram] = useState(false);
  const [securityEventLevel, setSecurityEventLevel] = useState<SecurityEventLevelFilter>('ALL');
  const [securityEventType, setSecurityEventType] = useState<SecurityEventTypeFilter>('ALL');
  const [securityEventWindow, setSecurityEventWindow] = useState<SecurityEventWindow>('24h');

  const securityEventSearch = SECURITY_EVENT_TYPE_SEARCH[securityEventType];

  const { data: adminProfile, isLoading } = useQuery({
    queryKey: ['auth-me'],
    queryFn: async () => authApi.me() as Promise<AuthAdminProfile>
  });

  const adminSessionsQuery = useQuery({
    queryKey: ['auth-sessions'],
    queryFn: async () => authApi.getSessions({ limit: 20 }),
    refetchInterval: 10_000
  });

  const allowlistQuery = useQuery({
    queryKey: ['security-ip-allowlist'],
    queryFn: async () => {
      const response = await apiClient.get('/settings/security/ip-allowlist');
      return response.data as { entries: string[]; raw: string; count: number; requirePrivateIp?: boolean };
    },
    enabled: isSuperAdmin
  });

  const securityRulesQuery = useQuery({
    queryKey: ['security-rules'],
    queryFn: async () => {
      const response = await apiClient.get('/settings/security/rules');
      return (response.data?.rules || []) as SecurityRule[];
    },
    enabled: isSuperAdmin
  });

  const securityPoliciesQuery = useQuery({
    queryKey: ['security-policies'],
    queryFn: async () => {
      const response = await apiClient.get('/settings/security/policies');
      return response.data as SecurityPolicies;
    },
    enabled: isSuperAdmin
  });

  const securityEventsQuery = useQuery({
    queryKey: ['security-events', securityEventLevel, securityEventSearch, securityEventWindow],
    queryFn: async () => {
      const securityEventStart = getWindowStartIso(securityEventWindow);
      const response = await apiClient.get('/logs/system', {
        params: {
          page: 1,
          limit: 100,
          search: securityEventSearch,
          level: securityEventLevel === 'ALL' ? undefined : securityEventLevel,
          start: securityEventStart
        }
      });
      return (response.data?.logs || []) as SecurityEventLog[];
    },
    enabled: isSuperAdmin,
    refetchInterval: 5_000
  });

  const securityNotificationConfigQuery = useQuery({
    queryKey: ['notification-settings-security'],
    queryFn: async () => {
      const response = (await apiClient.get('/settings/notifications')) as ApiResponse<NotificationConfig>;
      return response.data as NotificationConfig;
    },
    enabled: isSuperAdmin
  });

  const securityEvents = securityEventsQuery.data || [];

  const handleDownloadSecurityEvents = (filename: string, content: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  const exportSecurityEventsJson = () => {
    const filename = `security-events-${new Date().toISOString()}.json`;
    handleDownloadSecurityEvents(
      filename,
      JSON.stringify(securityEvents, null, 2),
      'application/json;charset=utf-8'
    );
  };

  const exportSecurityEventsCsv = () => {
    const rows = [
      ['id', 'timestamp', 'level', 'event', 'user', 'ip', 'reason'].join(','),
      ...securityEvents.map((event) => {
        const metadata = (event.metadata || {}) as Record<string, unknown>;
        const username = typeof metadata.username === 'string'
          ? metadata.username
          : typeof metadata.actorUsername === 'string'
          ? metadata.actorUsername
          : '';
        const ip = typeof metadata.ip === 'string' ? metadata.ip : '';
        const reason = typeof metadata.reason === 'string' ? metadata.reason : '';
        return [
          escapeCsv(event.id),
          escapeCsv(event.timestamp),
          escapeCsv(event.level),
          escapeCsv(toEventLabel(event.message)),
          escapeCsv(username),
          escapeCsv(ip),
          escapeCsv(reason)
        ].join(',');
      })
    ].join('\n');

    const filename = `security-events-${new Date().toISOString()}.csv`;
    handleDownloadSecurityEvents(filename, rows, 'text/csv;charset=utf-8');
  };

  const saveSecurityEscalationMutation = useMutation({
    mutationFn: async () => {
      const matrix = securityNotificationConfigQuery.data?.routeMatrix;
      const defaultRoute = resolveRoute(matrix, '__default__');
      const currentRoutes = matrix?.routes || {};

      const routesPayload: Record<string, NotificationChannelRoute> = {
        'security.critical': {
          ...normalizeRoute(currentRoutes['security.critical'], defaultRoute),
          telegram: criticalSecurityTelegram
        },
        'auth.login.failed': {
          ...normalizeRoute(currentRoutes['auth.login.failed'], defaultRoute),
          telegram: failedLoginTelegram
        },
        'auth.login.telegram.failed': {
          ...normalizeRoute(currentRoutes['auth.login.telegram.failed'], defaultRoute),
          telegram: failedLoginTelegram
        }
      };

      SECURITY_CHANGE_ROUTE_KEYS.forEach((eventName) => {
        routesPayload[eventName] = {
          ...normalizeRoute(currentRoutes[eventName], defaultRoute),
          telegram: securityChangeTelegram
        };
      });

      await apiClient.put('/settings/notifications', {
        routes: routesPayload
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notification-settings-security'] }),
        queryClient.invalidateQueries({ queryKey: ['notification-settings'] })
      ]);
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('securitySettings.toast.escalationUpdated', { defaultValue: 'Security escalation rules updated.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('securitySettings.toast.escalationUpdateFailed', { defaultValue: 'Failed to update security escalation rules' })
      );
    }
  });

  const testSecurityAlertMutation = useMutation({
    mutationFn: async () => {
      await apiClient.post('/settings/notifications/test', {
        channel: 'all',
        event: 'security.critical',
        data: {
          source: 'security-settings-ui',
          message: 'Manual security escalation test',
          severity: 'critical',
          timestamp: new Date().toISOString()
        }
      });
    },
    onSuccess: () => {
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('securitySettings.toast.testAlertSent', { defaultValue: 'Test security alert dispatched to configured channels.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('securitySettings.toast.testAlertFailed', { defaultValue: 'Failed to send test security alert' })
      );
    }
  });

  const updateProfile = useMutation({
    mutationFn: async () => {
      const payload: {
        currentPassword: string;
        username?: string;
        newPassword?: string;
        confirmPassword?: string;
      } = {
        currentPassword
      };

      const normalizedUsername = profileUsername.trim();
      if (adminProfile && normalizedUsername && normalizedUsername !== adminProfile.username) {
        payload.username = normalizedUsername;
      }

      if (newPassword.trim()) {
        payload.newPassword = newPassword;
        payload.confirmPassword = confirmPassword;
      }

      return authApi.updateProfile(payload);
    },
    onSuccess: async (data) => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setProfileUsername(data.username);

      setAuthAdmin({
        id: data.id,
        username: data.username,
        role: data.role,
        email: data.email,
        twoFactorEnabled: data.twoFactorEnabled
      });

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['auth-me'] }),
        queryClient.invalidateQueries({ queryKey: ['auth-sessions'] })
      ]);
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        data.passwordChanged
          ? t('securitySettings.toast.profileUpdatedCredentials', { defaultValue: 'Credentials updated. Existing refresh sessions were revoked.' })
          : t('securitySettings.toast.profileUpdated', { defaultValue: 'Profile updated successfully.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('securitySettings.toast.profileUpdateFailed', { defaultValue: 'Failed to update profile' })
      );
    }
  });

  const setup2fa = useMutation({
    mutationFn: async () => authApi.setupTwoFactor(),
    onSuccess: (data) => {
      setSetupData(data);
      setEnableOtp('');
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('securitySettings.toast.otpSetupInitialized', { defaultValue: 'Scan the QR code and enter OTP to complete setup.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('securitySettings.toast.otpSetupFailed', { defaultValue: 'Failed to initialize 2FA setup' })
      );
    }
  });

  const enable2fa = useMutation({
    mutationFn: async (otp: string) => authApi.enableTwoFactor(otp),
    onSuccess: () => {
      setSetupData(null);
      setEnableOtp('');
      void queryClient.invalidateQueries({ queryKey: ['auth-me'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('securitySettings.toast.otpEnabled', { defaultValue: 'Two-factor authentication is now enabled.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('securitySettings.toast.otpEnableFailed', { defaultValue: 'Failed to enable 2FA' })
      );
    }
  });

  const disable2fa = useMutation({
    mutationFn: async (otp?: string) => authApi.disableTwoFactor(otp),
    onSuccess: () => {
      setDisableOtp('');
      setSetupData(null);
      void queryClient.invalidateQueries({ queryKey: ['auth-me'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('securitySettings.toast.otpDisabled', { defaultValue: 'Two-factor authentication has been disabled.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('securitySettings.toast.otpDisableFailed', { defaultValue: 'Failed to disable 2FA' })
      );
    }
  });

  const revokeSessions = useMutation({
    mutationFn: async () => authApi.logoutAll(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('securitySettings.toast.sessionsRevoked', {
          defaultValue: 'All refresh sessions revoked. Current access token remains valid until it expires.'
        })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('securitySettings.toast.sessionsRevokeFailed', { defaultValue: 'Failed to revoke sessions' })
      );
    }
  });

  const revokeSingleSession = useMutation({
    mutationFn: async (sid: string) => authApi.revokeSessionById(sid, false),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth-sessions'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('securitySettings.toast.sessionRevoked', { defaultValue: 'The selected session has been revoked.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('securitySettings.toast.sessionRevokeFailed', { defaultValue: 'Failed to revoke session' })
      );
    }
  });

  const updateAllowlist = useMutation({
    mutationFn: async () => {
      await apiClient.put('/settings/security/ip-allowlist', {
        allowlist: allowlistInput,
        forceCurrentIp
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['security-ip-allowlist'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('securitySettings.toast.allowlistUpdated', { defaultValue: 'Admin access policy updated.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('securitySettings.toast.allowlistUpdateFailed', { defaultValue: 'Failed to update IP allowlist' })
      );
    }
  });

  const updateSecurityPolicies = useMutation({
    mutationFn: async () => {
      await apiClient.put('/settings/security/policies', {
        requireTwoFactorForSuperAdmin,
        strictSessionBinding,
        requirePrivateIp,
        secretsEncryptionRequired
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['security-policies'] }),
        queryClient.invalidateQueries({ queryKey: ['security-ip-allowlist'] })
      ]);
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('securitySettings.toast.policiesUpdated', { defaultValue: 'Security policies updated.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('securitySettings.toast.policiesUpdateFailed', { defaultValue: 'Failed to update security policies' })
      );
    }
  });

  const createSecurityRule = useMutation({
    mutationFn: async () => {
      await apiClient.post('/settings/security/rules', {
        name: ruleName,
        action: ruleAction,
        targetType: ruleTargetType,
        targetValue: ruleTargetValue,
        priority: rulePriority,
        enabled: true
      });
    },
    onSuccess: async () => {
      setRuleName('');
      setRuleTargetValue('');
      setRulePriority(100);
      await queryClient.invalidateQueries({ queryKey: ['security-rules'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('securitySettings.toast.ruleCreated', { defaultValue: 'Security rule created successfully.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('securitySettings.toast.ruleCreateFailed', { defaultValue: 'Failed to create security rule' })
      );
    }
  });

  const toggleSecurityRule = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => {
      await apiClient.patch(`/settings/security/rules/${id}/enabled`, { enabled });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['security-rules'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('securitySettings.toast.ruleUpdated', { defaultValue: 'Security rule status updated.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('securitySettings.toast.ruleUpdateFailed', { defaultValue: 'Failed to update security rule' })
      );
    }
  });

  const deleteSecurityRule = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/settings/security/rules/${id}`);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['security-rules'] });
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('securitySettings.toast.ruleDeleted', { defaultValue: 'Security rule deleted.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('securitySettings.toast.ruleDeleteFailed', { defaultValue: 'Failed to delete security rule' })
      );
    }
  });

  useEffect(() => {
    if (!allowlistQuery.data) {
      return;
    }
    setAllowlistInput(allowlistQuery.data.raw || '');
  }, [allowlistQuery.data]);

  useEffect(() => {
    if (!securityPoliciesQuery.data) {
      return;
    }

    setRequireTwoFactorForSuperAdmin(Boolean(securityPoliciesQuery.data.requireTwoFactorForSuperAdmin));
    setStrictSessionBinding(Boolean(securityPoliciesQuery.data.strictSessionBinding));
    setRequirePrivateIp(Boolean(securityPoliciesQuery.data.requirePrivateIp));
    setSecretsEncryptionRequired(Boolean(securityPoliciesQuery.data.secretsEncryptionRequired));
    setSecretsEncryptionConfigured(Boolean(securityPoliciesQuery.data.secretsEncryptionConfigured));
  }, [securityPoliciesQuery.data]);

  useEffect(() => {
    if (!adminProfile?.username) {
      return;
    }

    setProfileUsername(adminProfile.username);
  }, [adminProfile?.username]);

  useEffect(() => {
    const matrix = securityNotificationConfigQuery.data?.routeMatrix;
    if (!matrix) {
      return;
    }

    const criticalRoute = resolveRoute(matrix, 'security.critical');
    const failedRoutePassword = resolveRoute(matrix, 'auth.login.failed');
    const failedRouteTelegram = resolveRoute(matrix, 'auth.login.telegram.failed');
    const securityChangeEnabled = SECURITY_CHANGE_ROUTE_KEYS.every(
      (eventName) => resolveRoute(matrix, eventName).telegram
    );

    setCriticalSecurityTelegram(Boolean(criticalRoute.telegram));
    setFailedLoginTelegram(Boolean(failedRoutePassword.telegram) && Boolean(failedRouteTelegram.telegram));
    setSecurityChangeTelegram(Boolean(securityChangeEnabled));
  }, [securityNotificationConfigQuery.data]);

  const normalizedUsername = profileUsername.trim();
  const hasUsernameChange = Boolean(
    adminProfile && normalizedUsername && normalizedUsername !== adminProfile.username
  );
  const hasPasswordChange = Boolean(newPassword.trim() || confirmPassword.trim());
  const canUpdateProfile = Boolean(currentPassword.trim()) && (hasUsernameChange || hasPasswordChange);

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Administrator Security</h3>
        {isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading profile...</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Username</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{adminProfile?.username}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Role</span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{adminProfile?.role}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Two-Factor Authentication</span>
              <span className={`font-medium ${adminProfile?.twoFactorEnabled ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                {adminProfile?.twoFactorEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
        )}
      </Card>

      {!isSuperAdmin ? (
        <Card>
          <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Security Administration</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Advanced security policies, allowlists, notification escalation, and rules engine are available to SUPER_ADMIN only.
          </p>
        </Card>
      ) : (
      <>
      <Card>
        <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Security Policies</h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Global security behavior for admin authentication and session handling.
        </p>

        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={requireTwoFactorForSuperAdmin}
              onChange={(event) => setRequireTwoFactorForSuperAdmin(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Require 2FA for all SUPER_ADMIN accounts
            </span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={strictSessionBinding}
              onChange={(event) => setStrictSessionBinding(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Strict session binding (invalidate refresh token on IP change)
            </span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={requirePrivateIp}
              onChange={(event) => setRequirePrivateIp(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Require private/internal IP for admin access
            </span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={secretsEncryptionRequired}
              onChange={(event) => setSecretsEncryptionRequired(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Require configured encryption key for secrets at rest
            </span>
          </label>

          <p className="text-xs text-gray-500 dark:text-gray-400">
            Encryption key configured: {secretsEncryptionConfigured ? 'Yes' : 'No'}
          </p>
        </div>

        <div className="mt-4">
          <Button onClick={() => updateSecurityPolicies.mutate()} loading={updateSecurityPolicies.isPending || securityPoliciesQuery.isFetching}>
            Save Security Policies
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Security Alert Escalation</h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Choose which security event categories should escalate to Telegram notifications.
        </p>

        <div className="space-y-3">
          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={criticalSecurityTelegram}
              onChange={(event) => setCriticalSecurityTelegram(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Critical security incidents (lockout, blocked access, high-risk auth failures)
            </span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={failedLoginTelegram}
              onChange={(event) => setFailedLoginTelegram(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Failed login attempts (password + Telegram auth)
            </span>
          </label>

          <label className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={securityChangeTelegram}
              onChange={(event) => setSecurityChangeTelegram(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              Security admin changes (policies, rules, IP allowlist updates)
            </span>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            onClick={() => saveSecurityEscalationMutation.mutate()}
            loading={saveSecurityEscalationMutation.isPending || securityNotificationConfigQuery.isFetching}
          >
            Save Escalation Rules
          </Button>
          <Button
            variant="secondary"
            onClick={() => testSecurityAlertMutation.mutate()}
            loading={testSecurityAlertMutation.isPending}
          >
            Send Test Security Alert
          </Button>
        </div>
      </Card>

      <Card>
        <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Recent Security Events</h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Live audit stream from admin authentication and security policy changes (refresh every 5 seconds).
        </p>

        <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Event Type</label>
            <select
              value={securityEventType}
              onChange={(event) => setSecurityEventType(event.target.value as SecurityEventTypeFilter)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              <option value="ALL">All Security Events</option>
              <option value="AUTH">Authentication</option>
              <option value="POLICY">Policy Changes</option>
              <option value="RULE">Rule Changes</option>
              <option value="ACCESS">IP Allowlist</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Severity</label>
            <select
              value={securityEventLevel}
              onChange={(event) => setSecurityEventLevel(event.target.value as SecurityEventLevelFilter)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              <option value="ALL">All levels</option>
              <option value="INFO">INFO</option>
              <option value="WARNING">WARNING</option>
              <option value="ERROR">ERROR</option>
              <option value="CRITICAL">CRITICAL</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Time Range</label>
            <select
              value={securityEventWindow}
              onChange={(event) => setSecurityEventWindow(event.target.value as SecurityEventWindow)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              <option value="15m">Last 15 minutes</option>
              <option value="1h">Last 1 hour</option>
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
          </div>

          <div className="flex flex-col justify-end gap-2 sm:flex-row sm:items-end xl:justify-end">
            <Button
              variant="secondary"
              onClick={() => {
                void securityEventsQuery.refetch();
              }}
              loading={securityEventsQuery.isFetching}
            >
              Refresh
            </Button>
            <Button variant="secondary" onClick={exportSecurityEventsCsv} disabled={securityEvents.length === 0}>
              Export CSV
            </Button>
            <Button variant="secondary" onClick={exportSecurityEventsJson} disabled={securityEvents.length === 0}>
              Export JSON
            </Button>
          </div>
        </div>

        {securityEventsQuery.isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading events...</p>
        ) : securityEvents.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">No security events found.</p>
        ) : (
          <div className="space-y-2">
            {securityEvents.map((event) => {
              const metadata = (event.metadata || {}) as Record<string, unknown>;
              const ip = typeof metadata.ip === 'string' ? metadata.ip : '';
              const username = typeof metadata.username === 'string'
                ? metadata.username
                : typeof metadata.actorUsername === 'string'
                ? metadata.actorUsername
                : '';
              const reason = typeof metadata.reason === 'string' ? metadata.reason : '';
              const cleanedMessage = toEventLabel(event.message);
              const levelClass = event.level === 'CRITICAL'
                ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                : event.level === 'ERROR'
                ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                : event.level === 'WARNING'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';

              return (
                <div key={event.id} className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${levelClass}`}>
                      {event.level}
                    </span>
                    <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                      {cleanedMessage || 'Security event'}
                    </span>
                    <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                      {new Date(event.timestamp).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    {username ? `User: ${username}` : 'User: system'}
                    {ip ? ` • IP: ${ip}` : ''}
                    {reason ? ` • Reason: ${reason}` : ''}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      </>
      )}

      <Card>
        <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Account Credentials</h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Change your administrator username and password. Current password verification is required.
        </p>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Input
            label="Username"
            value={profileUsername}
            onChange={(event) => setProfileUsername(event.target.value)}
            placeholder="admin"
          />
          <Input
            label="Current Password *"
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="Enter current password"
          />
          <Input
            label="New Password"
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="Leave empty to keep current password"
          />
          <Input
            label="Confirm New Password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            autoComplete="new-password"
            placeholder="Re-enter new password"
          />
        </div>

        <div className="mt-3 space-y-1 text-xs text-gray-500 dark:text-gray-400">
          <p>Password rules: 8-128 characters, include at least one letter and one number.</p>
          <p>When password changes, all refresh sessions are revoked for security.</p>
          {authAdmin?.username && adminProfile?.username && authAdmin.username !== adminProfile.username ? (
            <p className="text-amber-600 dark:text-amber-400">
              Session username is syncing. Refresh the page if the sidebar still shows old username.
            </p>
          ) : null}
        </div>

        <div className="mt-4">
          <Button
            onClick={() => updateProfile.mutate()}
            loading={updateProfile.isPending}
            disabled={!canUpdateProfile}
          >
            Save Credentials
          </Button>
        </div>
      </Card>

      {!adminProfile?.twoFactorEnabled ? (
        <Card>
          <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Enable Two-Factor Authentication</h3>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Protect admin access with a TOTP app like Google Authenticator, 1Password, or Authy.
          </p>

          {!setupData ? (
            <Button onClick={() => setup2fa.mutate()} loading={setup2fa.isPending}>
              <Shield className="mr-2 h-4 w-4" />
              Generate 2FA Setup
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col items-start gap-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700 md:flex-row">
                <div className="rounded-lg bg-white p-2">
                  <QRCodeSVG value={setupData.otpAuthUrl} size={164} />
                </div>
                <div className="space-y-2 text-sm">
                  <p className="text-gray-700 dark:text-gray-300">
                    Scan the QR with your authenticator app, then enter the OTP code to confirm.
                  </p>
                  <p className="font-mono text-xs text-gray-600 dark:text-gray-400 break-all">
                    Secret: {setupData.secret}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <Input
                  label="Verification OTP"
                  placeholder="123456"
                  value={enableOtp}
                  onChange={(event) => setEnableOtp(event.target.value)}
                />
                <Button
                  className="sm:self-end"
                  onClick={() => enable2fa.mutate(enableOtp.trim())}
                  loading={enable2fa.isPending}
                  disabled={enableOtp.trim().length < 6}
                >
                  Enable 2FA
                </Button>
              </div>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Disable Two-Factor Authentication</h3>
          <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
            Enter a valid OTP code to disable 2FA for this admin account.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Input
              label="Current OTP"
              placeholder="123456"
              value={disableOtp}
              onChange={(event) => setDisableOtp(event.target.value)}
            />
            <Button
              variant="danger"
              className="sm:self-end"
              onClick={() => disable2fa.mutate(disableOtp.trim())}
              loading={disable2fa.isPending}
              disabled={disableOtp.trim().length < 6}
            >
              Disable 2FA
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Session Controls</h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Revoke refresh tokens across all devices. This forces new login on other active sessions.
        </p>
        <div className="mb-4">
          <Button variant="secondary" onClick={() => revokeSessions.mutate()} loading={revokeSessions.isPending}>
            Revoke All Sessions
          </Button>
        </div>

        {adminSessionsQuery.isLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading active sessions...</p>
        ) : (
          <div className="space-y-2">
            {(adminSessionsQuery.data?.sessions || []).length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No active sessions found.</p>
            ) : (
              (adminSessionsQuery.data?.sessions || []).map((session) => (
                <div
                  key={session.sessionId}
                  className="rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                        session.current
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
                      }`}
                    >
                      {session.current ? 'Current' : 'Active'}
                    </span>
                    <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
                      {session.sessionId.slice(0, 16)}...
                    </span>
                    <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                      Expires: {new Date(session.expiresAt).toLocaleString()}
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                    {session.ipAddress ? `IP: ${session.ipAddress}` : 'IP: unknown'}
                    {session.lastUsedAt ? ` • Last used: ${new Date(session.lastUsedAt).toLocaleString()}` : ''}
                  </p>
                  {session.userAgent ? (
                    <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{session.userAgent}</p>
                  ) : null}

                  {!session.current ? (
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => revokeSingleSession.mutate(session.sessionId)}
                        loading={revokeSingleSession.isPending}
                      >
                        Revoke Session
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        )}
      </Card>

      {isSuperAdmin ? (
      <>
      <Card>
        <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Admin IP Allowlist</h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Restrict admin login/API access to specific IPs or CIDR blocks. Example:
          <span className="ml-1 font-mono">203.0.113.10,198.51.100.0/24</span>
        </p>

        <Input
          label="Allowed IPs / CIDRs (comma-separated)"
          value={allowlistInput}
          onChange={(event) => setAllowlistInput(event.target.value)}
          placeholder="Leave empty to allow all IPs"
        />

        <div className="mt-3 flex items-center gap-2">
          <input
            id="force-current-ip"
            type="checkbox"
            checked={forceCurrentIp}
            onChange={(event) => setForceCurrentIp(event.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
          />
          <label htmlFor="force-current-ip" className="text-sm text-gray-700 dark:text-gray-300">
            Force save even if current IP is not included
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => allowlistQuery.refetch()}
            loading={allowlistQuery.isFetching}
          >
            Refresh
          </Button>
          <Button onClick={() => updateAllowlist.mutate()} loading={updateAllowlist.isPending}>
            Save Allowlist
          </Button>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {allowlistQuery.data ? `${allowlistQuery.data.count} entr${allowlistQuery.data.count === 1 ? 'y' : 'ies'}` : 'Loading...'}
          </span>
        </div>
      </Card>

      <Card>
        <h3 className="mb-2 text-lg font-semibold text-gray-900 dark:text-white">Security Rules Engine</h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          Define ALLOW/BLOCK rules by exact IP, CIDR, or country code. Rules are matched by ascending priority.
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Input label="Rule Name" value={ruleName} onChange={(event) => setRuleName(event.target.value)} placeholder="Block suspicious IP" />
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Action</label>
            <select
              value={ruleAction}
              onChange={(event) => setRuleAction(event.target.value as 'ALLOW' | 'BLOCK')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              <option value="BLOCK">BLOCK</option>
              <option value="ALLOW">ALLOW</option>
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Target Type</label>
            <select
              value={ruleTargetType}
              onChange={(event) => setRuleTargetType(event.target.value as 'IP' | 'CIDR' | 'COUNTRY')}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
            >
              <option value="IP">IP</option>
              <option value="CIDR">CIDR</option>
              <option value="COUNTRY">COUNTRY</option>
            </select>
          </div>
          <Input
            label="Target Value"
            value={ruleTargetValue}
            onChange={(event) => setRuleTargetValue(event.target.value)}
            placeholder={ruleTargetType === 'COUNTRY' ? 'US' : ruleTargetType === 'CIDR' ? '203.0.113.0/24' : '203.0.113.9'}
          />
          <Input
            label="Priority"
            type="number"
            value={String(rulePriority)}
            onChange={(event) => setRulePriority(Number.parseInt(event.target.value || '100', 10))}
          />
          <div className="flex items-end">
            <Button
              className="w-full"
              onClick={() => createSecurityRule.mutate()}
              loading={createSecurityRule.isPending}
              disabled={!ruleName.trim() || !ruleTargetValue.trim()}
            >
              Add Rule
            </Button>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Rule</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Match</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Priority</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Hits</th>
                <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Enabled</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900">
              {(securityRulesQuery.data || []).map((rule) => (
                <tr key={rule.id}>
                  <td className="px-3 py-2 text-sm text-gray-900 dark:text-gray-100">{rule.name}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 dark:text-gray-300">
                    <span className={`mr-2 inline-flex rounded-full px-2 py-0.5 font-semibold ${
                      rule.action === 'BLOCK'
                        ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        : 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                    }`}>
                      {rule.action}
                    </span>
                    {rule.targetType}: {rule.targetValue}
                  </td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{rule.priority}</td>
                  <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-300">{String(rule.hitCount || 0)}</td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => toggleSecurityRule.mutate({ id: rule.id, enabled: !rule.enabled })}
                      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                        rule.enabled
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {rule.enabled ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => deleteSecurityRule.mutate(rule.id)}
                      className="text-red-600 transition-colors hover:text-red-500"
                      title="Delete rule"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
              {!securityRulesQuery.isLoading && (securityRulesQuery.data || []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
                    No security rules configured
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
      </>
      ) : null}
    </div>
  );
};

export default SecuritySettings;
