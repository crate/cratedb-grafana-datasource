import React from 'react';

import { Input } from '@grafana/ui';

interface Props {
  value?: number;
  onChange: (limit?: number) => void;
}

export function LimitEditor({ value, onChange }: Props) {
  const commit = (text: string) => {
    const parsed = Number.parseInt(text, 10);
    onChange(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
  };
  return (
    <Input
      type="number"
      min={1}
      width={16}
      defaultValue={value ?? ''}
      placeholder="None"
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit(event.currentTarget.value);
        }
      }}
    />
  );
}
