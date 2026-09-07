import React from 'react';

import { Input } from '@grafana/ui';

interface Props {
  value: string;
  placeholder?: string;
  width?: number;
  onCommit: (value: string, run: boolean) => void;
}

// controlled so a middle-row delete can't leave stale text on a shifted row;
// typing updates state without running, blur/Enter runs
export function CommitOnBlurInput({ value, placeholder, width, onCommit }: Props) {
  return (
    <Input
      value={value}
      placeholder={placeholder}
      width={width}
      onChange={(event) => onCommit(event.currentTarget.value, false)}
      onBlur={(event) => onCommit(event.currentTarget.value, true)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          onCommit(event.currentTarget.value, true);
        }
      }}
    />
  );
}
