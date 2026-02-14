import React from 'react';
import { Database } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import apiClient from '../../api/client';
import { Card } from '../../components/atoms/Card';
import { Button } from '../../components/atoms/Button';
import { useToast } from '../../hooks/useToast';

const BackupSettings: React.FC = () => {
  const toast = useToast();
  const { t } = useTranslation();

  const createBackup = useMutation({
    mutationFn: async () => {
      await apiClient.post('/backup/create');
    },
    onSuccess: () => {
      toast.success(
        t('common.success', { defaultValue: 'Success' }),
        t('backupSettings.toast.created', { defaultValue: 'Backup created successfully.' })
      );
    },
    onError: (error: any) => {
      toast.error(
        t('common.error', { defaultValue: 'Error' }),
        error?.message || t('backupSettings.toast.failed', { defaultValue: 'Failed to create backup' })
      );
    }
  });

  return (
    <div className="space-y-6">
      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          {t('backupSettings.manual.title', { defaultValue: 'Manual backup' })}
        </h3>
        <p className="mb-4 text-gray-600 dark:text-gray-400">
          {t('backupSettings.manual.body', {
            defaultValue: 'Create a full backup of your database, SSL certificates, and configuration files.'
          })}
        </p>
        <Button onClick={() => createBackup.mutate()} loading={createBackup.isPending} className="w-full">
          <Database className="mr-2 h-4 w-4" />
          {t('backupSettings.manual.createNow', { defaultValue: 'Create backup now' })}
        </Button>
      </Card>

      <Card>
        <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
          {t('backupSettings.scheduled.title', { defaultValue: 'Scheduled backups' })}
        </h3>
        <div className="space-y-3">
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">
              {t('backupSettings.scheduled.scheduleLabel', { defaultValue: 'Schedule' })}:
            </span>
            <span className="font-medium dark:text-gray-200">
              {t('backupSettings.scheduled.scheduleValue', { defaultValue: 'Daily at 2:00 AM' })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">
              {t('backupSettings.scheduled.retentionLabel', { defaultValue: 'Retention' })}:
            </span>
            <span className="font-medium dark:text-gray-200">
              {t('backupSettings.scheduled.retentionValue', { defaultValue: '7 days' })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-600 dark:text-gray-400">
              {t('backupSettings.scheduled.locationLabel', { defaultValue: 'Location' })}:
            </span>
            <span className="text-xs font-medium dark:text-gray-300">/var/backups/xray-panel</span>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default BackupSettings;
