import React, { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';

import { authApi } from '../../api/auth';
import apiClient from '../../api/client';
import { Card } from '../../components/atoms/Card';
import { Button } from '../../components/atoms/Button';
import { Input } from '../../components/atoms/Input';
import { useToast } from '../../hooks/useToast';

interface TelegramSettingsForm {
  botToken?: string;
  adminIds?: string;
}

const TelegramSettings: React.FC = () => {
  const { register, handleSubmit } = useForm<TelegramSettingsForm>();
  const toast = useToast();
  const [telegramIdInput, setTelegramIdInput] = useState('');

  const {
    data: telegramLinkStatus,
    isLoading: isTelegramLinkLoading,
    refetch: refetchTelegramLink
  } = useQuery({
    queryKey: ['telegram-link-status'],
    queryFn: () => authApi.getTelegramLink()
  });

  const saveSettings = useMutation({
    mutationFn: async (data: TelegramSettingsForm) => {
      await apiClient.put('/settings/telegram', data);
    },
    onSuccess: () => {
      toast.success('Telegram settings saved', 'Restart backend to apply changes.');
    },
    onError: (error: any) => {
      toast.error('Save failed', error?.message || 'Failed to save Telegram settings');
    }
  });

  useEffect(() => {
    if (telegramLinkStatus?.telegramId) {
      setTelegramIdInput(telegramLinkStatus.telegramId);
    } else {
      setTelegramIdInput('');
    }
  }, [telegramLinkStatus?.telegramId]);

  const linkTelegram = useMutation({
    mutationFn: async () => authApi.linkTelegram(telegramIdInput),
    onSuccess: async () => {
      await refetchTelegramLink();
      toast.success('Telegram linked', 'Telegram account linked to current admin.');
    },
    onError: (error: any) => {
      toast.error('Link failed', error?.message || 'Failed to link Telegram account');
    }
  });

  const unlinkTelegram = useMutation({
    mutationFn: async () => authApi.unlinkTelegram(),
    onSuccess: async () => {
      await refetchTelegramLink();
      toast.success('Telegram unlinked', 'Telegram account unlinked from current admin.');
    },
    onError: (error: any) => {
      toast.error('Unlink failed', error?.message || 'Failed to unlink Telegram account');
    }
  });

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Telegram Admin Link</h3>
        {isTelegramLinkLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">Loading Telegram link status...</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/50">
              <p className="text-sm text-gray-600 dark:text-gray-300">
                Status:{' '}
                <span className={telegramLinkStatus?.linked ? 'font-semibold text-green-600 dark:text-green-400' : 'font-semibold text-yellow-600 dark:text-yellow-400'}>
                  {telegramLinkStatus?.linked ? 'Linked' : 'Not linked'}
                </span>
              </p>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Current ID: {telegramLinkStatus?.telegramId || 'None'}
              </p>
            </div>

            <Input
              label="Telegram ID"
              value={telegramIdInput}
              onChange={(event) => setTelegramIdInput(event.target.value)}
              placeholder="123456789"
            />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Button
                onClick={() => linkTelegram.mutate()}
                loading={linkTelegram.isPending}
                disabled={!telegramIdInput.trim()}
              >
                Link Telegram
              </Button>
              <Button
                variant="secondary"
                onClick={() => unlinkTelegram.mutate()}
                loading={unlinkTelegram.isPending}
                disabled={!telegramLinkStatus?.linked}
              >
                Unlink Telegram
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">Telegram Bot Configuration</h3>

        <form onSubmit={handleSubmit((data) => saveSettings.mutate(data))} className="space-y-4">
          <Input
            label="Bot Token"
            {...register('botToken')}
            placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
          />

          <Input
            label="Admin Chat IDs (comma-separated)"
            {...register('adminIds')}
            placeholder="123456789,987654321"
          />

          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-900/50 dark:bg-yellow-900/20">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              <strong>How to get your Chat ID:</strong>
              <br />
              1. Message @userinfobot on Telegram
              <br />
              2. It will reply with your Chat ID
              <br />
              3. Add it to the field above
            </p>
          </div>

          <Button type="submit" className="w-full" loading={saveSettings.isPending}>
            <Save className="mr-2 h-4 w-4" />
            Save Settings
          </Button>
        </form>
      </Card>
    </div>
  );
};

export default TelegramSettings;
