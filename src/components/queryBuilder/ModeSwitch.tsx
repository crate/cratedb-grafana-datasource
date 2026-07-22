import React from 'react';

import { RadioButtonGroup } from '@grafana/ui';

import { BuilderMode } from '../../types';

interface Props {
  value: BuilderMode;
  onChange: (mode: BuilderMode) => void;
}

const MODES = [
  { label: 'Columns', value: BuilderMode.Simple, description: 'Select raw columns' },
  { label: 'Aggregate', value: BuilderMode.Aggregate, description: 'Aggregate functions with optional grouping' },
];

export function ModeSwitch({ value, onChange }: Props) {
  return <RadioButtonGroup options={MODES} value={value} onChange={onChange} />;
}
