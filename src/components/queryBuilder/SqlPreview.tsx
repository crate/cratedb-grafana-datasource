import React from 'react';

import { css } from '@emotion/css';

import { GrafanaTheme2 } from '@grafana/data';
import { useStyles2 } from '@grafana/ui';

const getStyles = (theme: GrafanaTheme2) => ({
  pre: css({
    margin: 0,
    padding: theme.spacing(1),
    width: '100%',
    backgroundColor: theme.colors.background.secondary,
    color: theme.colors.text.primary,
    fontFamily: theme.typography.fontFamilyMonospace,
    fontSize: theme.typography.bodySmall.fontSize,
    whiteSpace: 'pre-wrap',
  }),
});

// the SQL the current builder state runs; empty state shows what is missing
export function SqlPreview({ sql }: { sql: string }) {
  const styles = useStyles2(getStyles);
  return (
    <pre className={styles.pre} data-testid="sql-preview">
      {sql || '-- select a table (and a time column for time series / logs) to build a query'}
    </pre>
  );
}
