import React from 'react';
import { Layers } from 'lucide-react';

import type { Inbound } from '../../types';
import { protocolCompatibility } from '../../data/protocolCompatibility';
import { Badge } from '../atoms/Badge';
import { Button } from '../atoms/Button';
import { Card } from '../atoms/Card';

interface ProtocolCompatibilityPanelProps {
  onQuickCreate: (protocol: Inbound['protocol']) => void;
}

export const ProtocolCompatibilityPanel: React.FC<ProtocolCompatibilityPanelProps> = ({ onQuickCreate }) => {
  return (
    <Card>
      <div className="mb-4 flex items-center gap-2">
        <Layers className="h-4 w-4 text-brand-500" />
        <h2 className="text-lg font-semibold text-foreground">Protocol Compatibility Matrix</h2>
      </div>

      <div className="space-y-3">
        {protocolCompatibility.map((item) => (
          <div
            key={item.protocol}
            className="rounded-xl border border-line/70 bg-card/65 p-4"
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <p className="text-base font-semibold text-foreground">{item.title}</p>
                  <Badge variant="info">{item.protocol}</Badge>
                </div>
                <p className="text-sm text-muted">{item.useCase}</p>
                <p className="text-xs text-muted">{item.recommendation}</p>

                <div className="pt-1">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Networks</p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.networks.map((network) => (
                      <span
                        key={`${item.protocol}-${network}`}
                        className="rounded-md border border-line/70 bg-panel/70 px-2 py-1 text-xs font-medium text-foreground"
                      >
                        {network}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Security</p>
                  <div className="flex flex-wrap gap-1.5">
                    {item.security.map((security) => (
                      <span
                        key={`${item.protocol}-${security}`}
                        className="rounded-md border border-line/70 bg-panel/70 px-2 py-1 text-xs font-medium text-foreground"
                      >
                        {security}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Supported Clients</p>
                  <p className="text-xs text-foreground/90">{item.clients.join(' · ')}</p>
                </div>
              </div>

              <div className="md:pl-4">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => onQuickCreate(item.protocol)}
                  className="w-full md:w-auto"
                >
                  Quick Create
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
};

