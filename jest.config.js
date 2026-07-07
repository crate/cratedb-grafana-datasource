// force timezone to UTC to allow tests to work regardless of local timezone
// generally used by snapshots, but can affect specific tests
process.env.TZ = 'UTC';

const baseConfig = require('./.config/jest.config');
const { grafanaESModules, nodeModulesToTransform } = require('./.config/jest/utils');

module.exports = {
  ...baseConfig,
  // ESM-only packages reached through @grafana/data (marked) and
  // @grafana/ui's date pickers (react-calendar and friends)
  transformIgnorePatterns: [
    nodeModulesToTransform([
      ...grafanaESModules,
      'lodash-es',
      'marked',
      'react-calendar',
      'get-user-locale',
      'memoize',
      'mimic-function',
      '@wojtekmaj/date-utils',
    ]),
  ],
};
