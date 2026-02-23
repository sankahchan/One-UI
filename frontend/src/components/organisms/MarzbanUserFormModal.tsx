import React, { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createUser, updateUser } from '../../lib/api/users';
import type { User, CreateUserInput, UpdateUserInput } from '../../types/marzban';
import { Button } from '../atoms/Button';
import { Input } from '../atoms/Input';
import { useToast } from '../../hooks/useToast';

interface Props {
    user: User | null;
    isOpen: boolean;
    onClose: () => void;
}

export const MarzbanUserFormModal: React.FC<Props> = ({ user, isOpen, onClose }) => {
    const [username, setUsername] = useState('');
    const [dataLimitGB, setDataLimitGB] = useState(0);
    const [expireDays, setExpireDays] = useState(0);
    const [status, setStatus] = useState<'active' | 'disabled'>('active');
    const [note, setNote] = useState('');

    const queryClient = useQueryClient();
    const toast = useToast();

    useEffect(() => {
        if (user) {
            setUsername(user.username);
            // Roughly map bytes to GB strictly for viewing bounds
            setDataLimitGB(user.data_limit ? Math.ceil(user.data_limit / 1073741824) : 0);

            // Epoch parsing
            if (user.expire) {
                const remainingMs = (user.expire * 1000) - Date.now();
                setExpireDays(Math.max(0, Math.ceil(remainingMs / (1000 * 60 * 60 * 24))));
            } else {
                setExpireDays(0);
            }
            setStatus(user.status === 'active' ? 'active' : 'disabled');
            setNote(user.note || '');
        } else {
            setUsername('');
            setDataLimitGB(0);
            setExpireDays(0);
            setStatus('active');
            setNote('');
        }
    }, [user]);

    const createMutation = useMutation({
        mutationFn: (data: CreateUserInput) => createUser(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['marzban-users'] });
            toast.success('Success', 'User created successfully');
            onClose();
        },
        onError: (err: any) => {
            toast.error('Error', err.message || 'Failed to create user');
        }
    });

    const updateMutation = useMutation({
        mutationFn: ({ name, data }: { name: string; data: UpdateUserInput }) => updateUser(name, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['marzban-users'] });
            toast.success('Success', 'User updated successfully');
            onClose();
        },
        onError: (err: any) => {
            toast.error('Error', err.message || 'Failed to update user');
        }
    });

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (user) {
            updateMutation.mutate({
                name: user.username,
                data: { dataLimitGB, expireDays, status, note }
            });
        } else {
            createMutation.mutate({
                username, dataLimitGB, expireDays, note
            });
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
                <div className="flex items-center justify-between border-b border-line px-6 py-4">
                    <h2 className="text-lg font-semibold text-foreground">
                        {user ? `Edit User: ${user.username}` : 'Add New Marzban User'}
                    </h2>
                    <button onClick={onClose} className="text-muted hover:text-foreground">✕</button>
                </div>

                <form onSubmit={handleSubmit} className="p-6">
                    <div className="space-y-4">
                        {!user && (
                            <div>
                                <label className="mb-1 block text-sm font-medium text-muted">Username</label>
                                <Input
                                    required
                                    pattern="[a-zA-Z0-9_-]+"
                                    placeholder="john_doe"
                                    value={username}
                                    onChange={e => setUsername(e.target.value)}
                                />
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="mb-1 block text-sm font-medium text-muted">Data Limit (GB)</label>
                                <Input
                                    type="number"
                                    min="0"
                                    step="0.1"
                                    placeholder="0 = unlimited"
                                    value={dataLimitGB}
                                    onChange={e => setDataLimitGB(Number(e.target.value))}
                                />
                                <p className="mt-1 text-xs text-muted">0 for unlimited</p>
                            </div>

                            <div>
                                <label className="mb-1 block text-sm font-medium text-muted">Expire Days</label>
                                <Input
                                    type="number"
                                    min="0"
                                    placeholder="0 = never"
                                    value={expireDays}
                                    onChange={e => setExpireDays(Number(e.target.value))}
                                />
                                <p className="mt-1 text-xs text-muted">0 for never</p>
                            </div>
                        </div>

                        {user && (
                            <div>
                                <label className="mb-1 block text-sm font-medium text-muted">Status</label>
                                <select
                                    className="w-full rounded-md border border-line bg-panel px-3 py-2 text-sm text-foreground focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                                    value={status}
                                    onChange={e => setStatus(e.target.value as any)}
                                >
                                    <option value="active">Active</option>
                                    <option value="disabled">Disabled</option>
                                </select>
                            </div>
                        )}

                        <div>
                            <label className="mb-1 block text-sm font-medium text-muted">Note (Optional)</label>
                            <Input
                                placeholder="Optional notes..."
                                value={note}
                                onChange={e => setNote(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="mt-6 flex justify-end gap-3">
                        <Button type="button" variant="ghost" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={createMutation.isPending || updateMutation.isPending}
                        >
                            {(createMutation.isPending || updateMutation.isPending) ? 'Saving...' : 'Save User'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};
