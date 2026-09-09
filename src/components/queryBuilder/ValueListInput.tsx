import React, { useState } from 'react';

import { Input } from '@grafana/ui';

interface Props {
  values: string[];
  placeholder?: string;
  width?: number;
  onCommit: (values: string[], run: boolean) => void;
}

// IN / NOT IN take a list, edited as comma-separated text. The text is held as
// a draft while typing — parsing every keystroke would swallow the separator
// the moment it is typed — and re-adopted whenever the list itself changes, so
// a row that shifts after a delete shows its own values.
export function ValueListInput({ values, placeholder, width, onCommit }: Props) {
  const joined = values.join(', ');
  const [draft, setDraft] = useState(joined);
  const [adopted, setAdopted] = useState(joined);

  // React's adjust-state-during-render pattern: the list changing under the
  // editor (a row shifted by a delete) replaces the draft.
  if (joined !== adopted) {
    setAdopted(joined);
    setDraft(joined);
  }

  const commit = () =>
    onCommit(
      draft
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
      true
    );

  return (
    <Input
      value={draft}
      placeholder={placeholder}
      width={width}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
        }
      }}
    />
  );
}
