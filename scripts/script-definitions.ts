// Script-specific definitions (no React dependency)

export enum LoggerContext {
    OutlineSyncJob = "outline-sync-job",
    HealthCheckJob = "health-check-job",
    DakJob = "dak-job"
}

export enum HealthCheckNotificationType {
    Telegram = "Telegram"
}

export enum DataLimitUnit {
    Bytes = "Bytes",
    KB = "KB",
    MB = "MB",
    GB = "GB"
}

export interface DynamicAccessKeyStats {
    name: string;
    path: string;
    expiresAt: Date | null;
    validityPeriod: string | null;
    dataLimit: number | null;
    dataUsage: number;
    usageStartedAt: Date | null;
    prefix: string | null;
    isSelfManaged: boolean;
}

export namespace Outline {
    export interface Server {
        name: string;
        serverId: string;
        metricsEnabled: boolean;
        createdTimestampMs: number;
        version: string;
        portForNewAccessKeys: number;
        hostnameForAccessKeys: string;
    }

    export interface Metrics {
        bytesTransferredByUserId: { [id: string]: number };
    }

    export interface AccessKey {
        id: string;
        name: string;
        password: string;
        port: number;
        method: string;
        accessUrl: string;
        dataLimitInBytes?: number;
    }
}
