// Script-specific actions (no Next.js dependency)
import { Telegraf } from "telegraf";

import prisma from "@/prisma/db";
import OutlineClient from "./script-outline-client";

export type TelegramNotificationChannelConfig = {
    apiUrl: string;
    botToken: string;
    chatId: string;
    messageTemplate: string;
};

export type ServerWithHealthCheck = {
    id: number;
    name: string;
    hostnameOrIp: string;
    healthCheck: {
        notificationChannelId: number | null;
    } | null;
};

export async function removeAccessKeyForScript(
    serverId: number,
    accessKeyId: number,
    apiId: string
): Promise<void> {
    const server = await prisma.server.findUnique({
        where: { id: serverId }
    });

    if (!server) {
        throw new Error("Server not found");
    }

    const client = OutlineClient.fromConfig(server.managementJson);
    await client.deleteKey(apiId);

    await prisma.accessKey.delete({
        where: { id: accessKeyId }
    });
}

export async function removeSelfManagedDynamicAccessKeyAccessKeys(id: number): Promise<void> {
    const pattern = `self-managed-dak-access-key-${id}`;
    const accessKeys = await prisma.accessKey.findMany({
        where: {
            name: { contains: pattern }
        }
    });

    if (accessKeys.length > 0) {
        for (const accessKey of accessKeys) {
            await removeAccessKeyForScript(accessKey.serverId, accessKey.id, accessKey.apiId);
        }
    }
}

export async function sendNotificationViaTelegramChannel(
    server: ServerWithHealthCheck,
    errorMessage: string
): Promise<void> {
    if (!server.healthCheck?.notificationChannelId) {
        return;
    }

    const channel = await prisma.notificationChannel.findUnique({
        where: { id: server.healthCheck.notificationChannelId }
    });

    if (!channel) {
        return;
    }

    const config = JSON.parse(channel.config ?? "{}") as TelegramNotificationChannelConfig;

    const bot = new Telegraf(config.botToken, {
        telegram: {
            apiRoot: config.apiUrl
        }
    });

    const userId = config.chatId;

    const message = config.messageTemplate
        .replaceAll("{{errorMessage}}", errorMessage)
        .replaceAll("{{serverName}}", server.name)
        .replaceAll("{{serverHostnameOrIp}}", server.hostnameOrIp);

    await bot.telegram.sendMessage(userId, message, {
        parse_mode: "Markdown",
        link_preview_options: {
            is_disabled: true
        }
    });
}
