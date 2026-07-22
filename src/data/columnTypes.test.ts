import { columnKind } from './columnTypes';

describe('columnKind', () => {
  it.each([
    ['timestamp with time zone', 'time'],
    ['timestamp without time zone', 'time'],
    ['date', 'time'],
    ['smallint', 'number'],
    ['integer', 'number'],
    ['bigint', 'number'],
    ['numeric', 'number'],
    ['real', 'number'],
    ['double precision', 'number'],
    ['boolean', 'boolean'],
    ['text', 'string'],
    ['character varying', 'string'],
    ['ip', 'string'],
    ['object', 'other'],
    ['object(dynamic)', 'other'],
    ['geo_point', 'other'],
    ['geo_shape', 'other'],
    ['text_array', 'other'],
    ['integer_array', 'other'],
    ['interval', 'other'],
  ])('%s → %s', (dataType, expected) => {
    expect(columnKind(dataType)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(columnKind('TIMESTAMP WITH TIME ZONE')).toBe('time');
    expect(columnKind('Text')).toBe('string');
  });
});
