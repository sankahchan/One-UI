import { useForm } from 'react-hook-form';

import type { InboundPayload, Network, Protocol, Security } from '../../types';
import { Button } from '../atoms/Button';
import { Card } from '../atoms/Card';
import { Input } from '../atoms/Input';

interface InboundFormProps {
  loading?: boolean;
  onSubmit: (payload: InboundPayload) => Promise<void> | void;
}

interface InboundFormValues {
  port: number;
  protocol: Protocol;
  tag: string;
  remark: string;
  network: Network;
  security: Security;
  serverAddress: string;
  serverName: string;
  wsPath: string;
  wsHost: string;
  alpn: string;
}

const PROTOCOLS: Protocol[] = ['VLESS', 'VMESS', 'TROJAN', 'SHADOWSOCKS', 'SOCKS', 'HTTP', 'DOKODEMO_DOOR', 'WIREGUARD', 'MTPROTO'];
const NETWORKS: Network[] = ['TCP', 'WS', 'HTTPUPGRADE', 'XHTTP', 'GRPC', 'HTTP'];
const SECURITIES: Security[] = ['NONE', 'TLS', 'REALITY'];

export function InboundForm({ loading = false, onSubmit }: InboundFormProps) {
  const { register, handleSubmit } = useForm<InboundFormValues>({
    defaultValues: {
      port: 443,
      protocol: 'VLESS',
      network: 'WS',
      security: 'TLS',
      tag: 'vless-ws',
      remark: '',
      serverAddress: '',
      serverName: '',
      wsPath: '/vless',
      wsHost: '',
      alpn: '["h2","http/1.1"]'
    }
  });

  return (
    <Card>
      <h3 className="mb-4 text-base font-semibold text-slate-900">Create Inbound</h3>
      <form
        className="grid grid-cols-1 gap-4 md:grid-cols-2"
        onSubmit={handleSubmit(async (values) => {
          await onSubmit({
            port: values.port,
            protocol: values.protocol,
            tag: values.tag,
            remark: values.remark,
            network: values.network,
            security: values.security,
            serverAddress: values.serverAddress,
            serverName: values.serverName,
            wsPath: values.wsPath,
            wsHost: values.wsHost,
            alpn: values.alpn
          });
        })}
      >
        <Input type="number" label="Port" min={1} max={65535} {...register('port', { valueAsNumber: true })} />

        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium text-slate-200">Protocol</span>
          <select className="rounded-lg border border-slate-700 bg-surface-800 px-3 py-2" {...register('protocol')}>
            {PROTOCOLS.map((protocol) => (
              <option key={protocol} value={protocol}>
                {protocol}
              </option>
            ))}
          </select>
        </label>

        <Input label="Tag" {...register('tag')} />
        <Input label="Remark" {...register('remark')} />

        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium text-slate-200">Network</span>
          <select className="rounded-lg border border-slate-700 bg-surface-800 px-3 py-2" {...register('network')}>
            {NETWORKS.map((network) => (
              <option key={network} value={network}>
                {network}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium text-slate-200">Security</span>
          <select className="rounded-lg border border-slate-700 bg-surface-800 px-3 py-2" {...register('security')}>
            {SECURITIES.map((security) => (
              <option key={security} value={security}>
                {security}
              </option>
            ))}
          </select>
        </label>

        <Input label="Server Address" {...register('serverAddress')} />
        <Input label="Server Name" {...register('serverName')} />
        <Input label="WebSocket Path" {...register('wsPath')} />
        <Input label="WebSocket Host" {...register('wsHost')} />
        <Input className="md:col-span-2" label="ALPN (JSON)" {...register('alpn')} />

        <div className="md:col-span-2">
          <Button className="w-full" loading={loading} type="submit">
            Create Inbound
          </Button>
        </div>
      </form>
    </Card>
  );
}
