import { ColumnHint, ColumnMeta } from '../types';
import { findColumnByHint } from './columnHeuristics';

const demoMetrics: ColumnMeta[] = [
  { name: 'host', type: 'text' },
  { name: 'ts', type: 'timestamp with time zone' },
  { name: 'value', type: 'double precision' },
];

const demoLogs: ColumnMeta[] = [
  { name: 'ts', type: 'timestamp with time zone' },
  { name: 'message', type: 'text' },
  { name: 'level', type: 'text' },
  { name: 'host', type: 'text' },
];

describe('findColumnByHint', () => {
  it('picks the conventionally named time column', () => {
    expect(findColumnByHint(demoMetrics, ColumnHint.Time)?.name).toBe('ts');
  });

  it('requires the data type to fit the role, not just the name', () => {
    // a text column named "time" is not a usable time axis
    const columns: ColumnMeta[] = [
      { name: 'time', type: 'text' },
      { name: 'recorded', type: 'timestamp with time zone' },
    ];
    expect(findColumnByHint(columns, ColumnHint.Time)?.name).toBe('recorded');
  });

  it('falls back to any timestamp column when no name matches', () => {
    const columns: ColumnMeta[] = [
      { name: 'host', type: 'text' },
      { name: 'recorded', type: 'timestamp without time zone' },
    ];
    expect(findColumnByHint(columns, ColumnHint.Time)?.name).toBe('recorded');
  });

  it('finds message and level columns for logs', () => {
    expect(findColumnByHint(demoLogs, ColumnHint.LogMessage)?.name).toBe('message');
    expect(findColumnByHint(demoLogs, ColumnHint.LogLevel)?.name).toBe('level');
  });

  it('prefers earlier patterns over later ones', () => {
    const columns: ColumnMeta[] = [
      { name: 'msg', type: 'text' },
      { name: 'body', type: 'text' },
    ];
    expect(findColumnByHint(columns, ColumnHint.LogMessage)?.name).toBe('body');
  });

  it('yields nothing for log roles without a fitting text column', () => {
    expect(findColumnByHint(demoMetrics, ColumnHint.LogMessage)).toBeUndefined();
    expect(findColumnByHint([], ColumnHint.Time)).toBeUndefined();
  });
});
