import { CheatSheet } from './components/CheatSheet';
import { ConfigEditor } from './components/ConfigEditor';
import { QueryEditor } from './components/QueryEditor';
import { CrateDBDatasource } from './datasource';
import { plugin } from './module';

describe('plugin wiring', () => {
  it('registers the datasource class and every editor component', () => {
    expect(plugin.DataSourceClass).toBe(CrateDBDatasource);
    expect(plugin.components.QueryEditor).toBe(QueryEditor);
    expect(plugin.components.ConfigEditor).toBe(ConfigEditor);
    // QueryEditorHelp must stay wired, or the editor's "?" help panel disappears
    expect(plugin.components.QueryEditorHelp).toBe(CheatSheet);
  });
});
