const axios = require('axios');
const env = require('../config/env');
const logger = require('../config/logger');

class MarzbanService {
    constructor() {
        this.accessToken = null;
        this.refreshInterval = null;
        this.baseUrl = env.MARZBAN_BASE_URL.replace(/\/+$/, '');
        this.authConfig = {
            username: env.MARZBAN_ADMIN_USERNAME,
            password: env.MARZBAN_ADMIN_PASSWORD,
            interval: env.MARZBAN_TOKEN_REFRESH_INTERVAL || 3300000
        };

        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 10000
        });

        // Request interceptor to attach bearer token
        this.client.interceptors.request.use((config) => {
            if (this.accessToken && !config.url.includes('/api/admin/token')) {
                config.headers.Authorization = `Bearer ${this.accessToken}`;
            }
            return config;
        });

        // Response interceptor to handle 401s
        this.client.interceptors.response.use(
            (response) => response,
            async (error) => {
                const originalRequest = error.config;
                if (
                    error.response &&
                    error.response.status === 401 &&
                    !originalRequest._retry &&
                    !originalRequest.url.includes('/api/admin/token')
                ) {
                    logger.warn('Marzban authentication 401 Unauthorized, attempting to refresh token');
                    originalRequest._retry = true;
                    try {
                        await this.authenticate();
                        return this.client(originalRequest);
                    } catch (refreshError) {
                        logger.error('Marzban token refresh on 401 failed', { message: refreshError.message });
                        return Promise.reject(refreshError);
                    }
                }
                return Promise.reject(error);
            }
        );
    }

    async initialize() {
        if (!this.baseUrl) {
            logger.info('Marzban Base URL is not set. Marzban integration is disabled.');
            return false;
        }

        try {
            await this.authenticate();
            this.startRefreshTicker();
            logger.info('Marzban integration completely initialized');
            return true;
        } catch (error) {
            logger.error('Failed to initialize Marzban integration on startup', { message: error.message });
            // We don't halt the process, we'll let it retry on the first actual request or next tick
            this.startRefreshTicker();
            return false;
        }
    }

    async authenticate() {
        if (!this.authConfig.username || !this.authConfig.password) {
            throw new Error('Marzban administrator credentials are not fully configured in environment variables.');
        }

        // Must be application/x-www-form-urlencoded
        const formData = new URLSearchParams();
        formData.append('username', this.authConfig.username);
        formData.append('password', this.authConfig.password);

        try {
            const response = await axios.post(`${this.baseUrl}/api/admin/token`, formData, {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                timeout: 10000
            });

            if (response.data && response.data.access_token) {
                this.accessToken = response.data.access_token;
                logger.info('Marzban access token successfully acquired');
                return true;
            }
            throw new Error('Invalid authentication response from Marzban');
        } catch (error) {
            logger.error('Marzban underlying authentication failed', {
                message: error.message,
                response: error.response?.data
            });
            throw error;
        }
    }

    startRefreshTicker() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        this.refreshInterval = setInterval(async () => {
            logger.info('Executing scheduled Marzban token refresh');
            try {
                await this.authenticate();
            } catch (error) {
                logger.error('Scheduled Marzban token refresh failed', { message: error.message });
            }
        }, this.authConfig.interval);
    }

    /**
     * Main helper wrapper for Marzban fetch actions
     * @param {string} path 
     * @param {import('axios').AxiosRequestConfig} options 
     * @returns {Promise<any>}
     */
    async marzbanFetch(path, options = {}) {
        if (!this.baseUrl) {
            throw new Error('Marzban integration is not configured');
        }

        try {
            const response = await this.client({
                url: path,
                ...options
            });
            return response.data;
        } catch (error) {
            // Re-throw standardized error or original error
            throw error;
        }
    }
}

module.exports = new MarzbanService();
