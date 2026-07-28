import { interpolateVariable } from './interpolate';

describe('interpolateVariable', () => {
  it('quotes an array selection as a literal list', () => {
    expect(interpolateVariable(['Berlin', 'Vienna'], { multi: true })).toBe("'Berlin','Vienna'");
  });

  it('quotes a single value of a multi-capable variable', () => {
    expect(interpolateVariable('Berlin', { multi: true })).toBe("'Berlin'");
    expect(interpolateVariable('Berlin', { includeAll: true })).toBe("'Berlin'");
  });

  it('leaves a single-value variable unquoted for identifier positions', () => {
    expect(interpolateVariable('demo_metrics', {})).toBe('demo_metrics');
  });

  it('escapes embedded quotes in every path', () => {
    expect(interpolateVariable("O'Brien", { multi: true })).toBe("'O''Brien'");
    expect(interpolateVariable(["O'Brien"], { multi: true })).toBe("'O''Brien'");
    // unquoted single values still cannot break out of a surrounding literal
    expect(interpolateVariable("O'Brien", {})).toBe("O''Brien");
  });

  it('passes numbers through', () => {
    expect(interpolateVariable(42, { multi: true })).toBe(42);
  });

  it('quotes numeric array members', () => {
    expect(interpolateVariable([1, 2], { multi: true })).toBe("'1','2'");
  });
});
