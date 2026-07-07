import { DataSourcePlugin } from '@grafana/data';

import { CheatSheet } from './components/CheatSheet';
import { ConfigEditor } from './components/ConfigEditor';
import { QueryEditor } from './components/QueryEditor';
import { CrateDBDatasource } from './datasource';
import { CrateDBOptions, CrateDBQuery } from './types';

export const plugin = new DataSourcePlugin<CrateDBDatasource, CrateDBQuery, CrateDBOptions>(CrateDBDatasource)
  .setConfigEditor(ConfigEditor)
  .setQueryEditor(QueryEditor)
  .setQueryEditorHelp(CheatSheet);
