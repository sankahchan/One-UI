export interface User {
    username: string;
    status: 'active' | 'disabled' | 'limited' | 'expired' | 'on_hold';
    used_traffic: number;         // bytes
    data_limit: number | null;    // bytes, null = unlimited
    expire: number | null;        // unix timestamp, null = never
    subscription_url: string;
    links: string[];              // ['vless://...', 'vmess://...']
    proxies: Record<string, object>;
    inbounds: Record<string, string[]>;
    online_at: string | null;
    note: string | null;
    created_at: string;
}

export interface SystemStats {
    mem_total: number;
    mem_used: number;
    cpu_cores: number;
    cpu_usage: number;
    total_user: number;
    users_active: number;
    users_disabled: number;
    users_on_hold: number;
    users_expired: number;
    users_limited: number;
    incoming_bandwidth: number;
    outgoing_bandwidth: number;
}

export interface CreateUserInput {
    username: string;
    dataLimitGB: number;   // 0 = unlimited
    expireDays: number;    // 0 = never
    note?: string;
}

export interface UpdateUserInput {
    dataLimitGB?: number;
    expireDays?: number;
    status?: 'active' | 'disabled';
    note?: string;
}

export interface UsersResponse {
    users: User[];
    total: number;
}

export type InboundsMap = Record<string, string[]>;
