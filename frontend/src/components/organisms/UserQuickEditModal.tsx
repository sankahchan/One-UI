import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { X } from 'lucide-react';

import { useUpdateUser } from '../../hooks/useUsers';
import type { User } from '../../types';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';

interface UserQuickEditModalProps {
  user: User;
  onClose: () => void;
  onSuccess: () => void;
}

interface QuickEditForm {
  dataLimitGb: number;
  expireDate: string;
  ipLimit: number;
  deviceLimit: number;
}

function toLocalDateInputValue(dateInput: string | Date): string {
  const date = new Date(dateInput);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function UserQuickEditModal({ user, onClose, onSuccess }: UserQuickEditModalProps) {
  const [submitError, setSubmitError] = useState('');
  const updateUser = useUpdateUser();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors }
  } = useForm<QuickEditForm>({
    defaultValues: {
      dataLimitGb: Math.max(1, Math.round(Number(user.dataLimit || 0) / 1024 ** 3)),
      expireDate: toLocalDateInputValue(user.expireDate),
      ipLimit: Math.max(0, Number(user.ipLimit || 0)),
      deviceLimit: Math.max(0, Number(user.deviceLimit || 0))
    }
  });

  useEffect(() => {
    reset({
      dataLimitGb: Math.max(1, Math.round(Number(user.dataLimit || 0) / 1024 ** 3)),
      expireDate: toLocalDateInputValue(user.expireDate),
      ipLimit: Math.max(0, Number(user.ipLimit || 0)),
      deviceLimit: Math.max(0, Number(user.deviceLimit || 0))
    });
  }, [reset, user.dataLimit, user.deviceLimit, user.expireDate, user.ipLimit]);

  const onSubmit = async (data: QuickEditForm) => {
    setSubmitError('');

    const now = new Date();
    const targetDate = new Date(`${data.expireDate}T23:59:59`);
    const diffMs = targetDate.getTime() - now.getTime();
    const expiryDays = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

    try {
        await updateUser.mutateAsync({
          id: user.id,
          data: {
            dataLimit: Number(data.dataLimitGb),
            expiryDays,
            ipLimit: Number(data.ipLimit),
            deviceLimit: Number(data.deviceLimit)
          }
        });
      onSuccess();
    } catch (error: any) {
      setSubmitError(error?.message || 'Failed to update user');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-2 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line/80 bg-card/95 shadow-soft backdrop-blur-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line/80 bg-card/95 p-5">
          <div>
            <h2 className="text-xl font-bold text-foreground">Quick Edit</h2>
            <p className="text-sm text-muted">{user.email}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-muted transition-colors hover:bg-card hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 p-5 sm:p-6">
          {submitError ? (
            <div className="rounded-xl border border-red-500/35 bg-red-500/10 px-4 py-3 text-sm text-red-500 dark:text-red-300">
              {submitError}
            </div>
          ) : null}

          <Input
            label="Data Limit (GB)"
            type="number"
            {...register('dataLimitGb', {
              valueAsNumber: true,
              required: 'Data limit is required',
              min: { value: 1, message: 'Minimum 1 GB' }
            })}
            error={errors.dataLimitGb?.message}
          />

          <Input
            label="Expiry Date"
            type="date"
            {...register('expireDate', {
              required: 'Expiry date is required'
            })}
            error={errors.expireDate?.message}
          />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="IP Limit (0 = unlimited)"
              type="number"
              {...register('ipLimit', {
                valueAsNumber: true,
                min: { value: 0, message: 'Minimum 0' }
              })}
              error={errors.ipLimit?.message}
            />
            <Input
              label="Device Limit (0 = unlimited)"
              type="number"
              {...register('deviceLimit', {
                valueAsNumber: true,
                min: { value: 0, message: 'Minimum 0' }
              })}
              error={errors.deviceLimit?.message}
            />
          </div>

          <p className="rounded-lg border border-line/70 bg-panel/60 px-3 py-2 text-xs text-muted">
            Expiry is stored as days from now. We convert this date automatically when saving.
          </p>

          <div className="flex gap-2">
            <Button type="submit" className="flex-1" loading={updateUser.isPending}>
              Save Changes
            </Button>
            <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
