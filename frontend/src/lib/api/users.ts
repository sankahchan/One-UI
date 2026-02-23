import apiClient from '../../api/client';
import type {
    User,
    SystemStats,
    CreateUserInput,
    UpdateUserInput,
    UsersResponse,
    InboundsMap
} from '../../types/marzban';

export interface MarzbanApiError {
    message: string;
    statusCode: number;
}

const handleApiError = (error: any): never => {
    const statusCode = error?.response?.data?.code || error?.response?.status || 500;
    const message = error?.response?.data?.message || error?.message || 'An unknown error occurred';

    const typedError: MarzbanApiError = {
        message,
        statusCode
    };

    throw typedError;
};

export async function getUsers(filters?: { status?: string; search?: string }): Promise<UsersResponse> {
    try {
        const params = new URLSearchParams();
        if (filters?.status) params.append('status', filters.status);
        if (filters?.search) params.append('search', filters.search);

        // Calls frontend base axios client matching ONE-UI express router root
        const response = await apiClient.get(`/users${params.toString() ? '?' + params.toString() : ''}`);
        return response.data;
    } catch (error) {
        return handleApiError(error);
    }
}

export async function createUser(data: CreateUserInput): Promise<User> {
    try {
        const response = await apiClient.post('/users', data);
        return response.data?.user;
    } catch (error) {
        return handleApiError(error);
    }
}

export async function getUser(username: string): Promise<User> {
    try {
        const response = await apiClient.get(`/users/${encodeURIComponent(username)}`);
        return response.data?.user;
    } catch (error) {
        return handleApiError(error);
    }
}

export async function updateUser(username: string, data: UpdateUserInput): Promise<User> {
    try {
        const response = await apiClient.put(`/users/${encodeURIComponent(username)}`, data);
        return response.data?.user;
    } catch (error) {
        return handleApiError(error);
    }
}

export async function deleteUser(username: string): Promise<void> {
    try {
        await apiClient.delete(`/users/${encodeURIComponent(username)}`);
    } catch (error) {
        return handleApiError(error);
    }
}

export async function resetTraffic(username: string): Promise<void> {
    try {
        await apiClient.post(`/users/${encodeURIComponent(username)}/reset-traffic`);
    } catch (error) {
        return handleApiError(error);
    }
}

export async function revokeSubscription(username: string): Promise<User> {
    try {
        const response = await apiClient.post(`/users/${encodeURIComponent(username)}/revoke-subscription`);
        return response.data?.user;
    } catch (error) {
        return handleApiError(error);
    }
}

export async function getSystemStats(): Promise<SystemStats> {
    try {
        const response = await apiClient.get('/system/stats');
        return response.data?.stats;
    } catch (error) {
        return handleApiError(error);
    }
}

export async function getInbounds(): Promise<InboundsMap> {
    try {
        const response = await apiClient.get('/system/inbounds');
        return response.data?.inbounds;
    } catch (error) {
        return handleApiError(error);
    }
}
