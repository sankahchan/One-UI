import { Outline } from "./script-definitions";

export default class OutlineClient {
    constructor(
        public apiUrl: string,
        public certSha256: string
    ) {}

    static fromConfig(config: string): OutlineClient {
        const json = JSON.parse(config) as { apiUrl: string; certSha256: string };

        return new OutlineClient(json.apiUrl, json.certSha256);
    }

    async server(): Promise<Outline.Server> {
        const response = await this.fetchWrapper("/server", "GET");

        return await response.json();
    }

    async metricsTransfer(): Promise<Outline.Metrics> {
        const response = await this.fetchWrapper("/metrics/transfer", "GET");

        return await response.json();
    }

    async keys(): Promise<Outline.AccessKey[]> {
        const response = await this.fetchWrapper("/access-keys", "GET");

        const result = await response.json();

        return result.accessKeys.map((accessKey: any) => {
            accessKey.dataLimitInBytes = accessKey.dataLimit?.bytes;

            return accessKey;
        });
    }

    async deleteKey(id: string): Promise<void> {
        await this.fetchWrapper(`/access-keys/${id}`, "DELETE");
    }

    async setDataLimitForKey(id: string, limitInBytes: number): Promise<void> {
        await this.fetchWrapper(`/access-keys/${id}/data-limit`, "PUT", {
            limit: { bytes: limitInBytes }
        });
    }

    async removeDataLimitForKey(id: string): Promise<void> {
        await this.fetchWrapper(`/access-keys/${id}/data-limit`, "DELETE");
    }

    private async fetchWrapper(
        endpoint: string,
        method: string,
        body?: any,
        timeout: number = 8 * 1000
    ): Promise<Response> {
        const headers: HeadersInit = {
            "Content-Type": "application/json",
            Accept: "application/json"
        };

        const controller = new AbortController();
        const signal = controller.signal;

        const options: RequestInit = {
            method,
            headers,
            signal
        };

        if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
            options.body = JSON.stringify(body);
        }

        const url = `${this.apiUrl}${endpoint}`;

        const fetchPromise = fetch(url, options);

        const timeoutPromise = new Promise<Response>((_, reject) =>
            setTimeout(() => {
                controller.abort();
                reject(new Error("Request timed out"));
            }, timeout)
        );

        const response = await Promise.race([fetchPromise, timeoutPromise]);

        if (!response.ok) {
            throw new Error(`HTTP error - Status code: ${response.status} (${response.statusText})`);
        }

        return response;
    }
}
