import type { XrayUpdatePreflightCheck } from '../api/xray';

function getMetadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string
): string | null {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function getPreflightFixCommands(check: XrayUpdatePreflightCheck): string[] {
  const scriptPath =
    getMetadataString(check.metadata, 'scriptPath') || '/opt/one-ui/scripts/update-xray-core.sh';
  const composeFilePath =
    getMetadataString(check.metadata, 'composeFilePath') || '/opt/one-ui/docker-compose.yml';
  const containerName = getMetadataString(check.metadata, 'containerName') || 'xray-core';
  const serviceName = getMetadataString(check.metadata, 'serviceName') || 'xray';
  const command = getMetadataString(check.metadata, 'command');
  const lockName = getMetadataString(check.metadata, 'lockName') || 'one-ui-xray-update';
  const ownerId = getMetadataString(check.metadata, 'ownerId');
  const expiresAt = getMetadataString(check.metadata, 'expiresAt');

  switch (check.id) {
    case 'update-script':
      return [
        `export XRAY_UPDATE_SCRIPT=${scriptPath}`,
        'echo $XRAY_UPDATE_SCRIPT',
        'Restart backend service after env changes.'
      ];
    case 'update-script-executable':
      return [`chmod +x ${scriptPath}`, `ls -l ${scriptPath}`];
    case 'compose-file':
      return [`export COMPOSE_FILE=${composeFilePath}`, `ls -l ${composeFilePath}`];
    case 'docker-daemon':
      return [
        'docker version',
        'docker ps',
        'sudo systemctl status docker',
        'sudo systemctl restart docker'
      ];
    case 'xray-container':
      return [
        `docker ps --filter "name=^/${containerName}$"`,
        `docker compose up -d ${serviceName}`
      ];
    case 'xray-version-read':
      return [
        `docker logs --tail=120 ${containerName}`,
        'sudo mkdir -p /var/log/xray && sudo touch /var/log/xray/access.log /var/log/xray/error.log /var/log/xray/output.log',
        'sudo chown -R 65532:65532 /var/log/xray && sudo chmod 755 /var/log/xray && sudo chmod 664 /var/log/xray/*.log',
        `docker compose restart ${serviceName}`,
        `docker exec ${containerName} xray version`
      ];
    case 'update-script-dry-run':
      return [command || `${scriptPath} --stable --canary --no-restart --dry-run --yes`];
    case 'update-lock':
      return [
        ownerId && expiresAt
          ? `Lock active (${lockName}) by ${ownerId} until ${expiresAt}. Wait for release or investigate stuck job.`
          : `Inspect lock ${lockName} and wait for release before retrying.`,
        'Retry preflight after lock is released.'
      ];
    default:
      return [];
  }
}

export function getPreflightMetadataString(
  check: XrayUpdatePreflightCheck | undefined,
  key: string
): string | null {
  return getMetadataString(check?.metadata, key);
}
