import { ColumnKind } from '../types';

// information_schema.columns.data_type → the builder's value-editor kind.
// OBJECT, geo and array types are 'other': not filterable/aggregatable (mirrors
// the backend's ad-hoc key exclusions), though still selectable as raw columns.
export function columnKind(dataType: string): ColumnKind {
  const type = dataType.toLowerCase();
  if (type.endsWith('_array') || type.startsWith('object') || type.startsWith('geo_')) {
    return 'other';
  }
  if (type.startsWith('timestamp') || type === 'date') {
    return 'time';
  }
  switch (type) {
    case 'smallint':
    case 'integer':
    case 'bigint':
    case 'numeric':
    case 'real':
    case 'double precision':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'text':
    case 'character varying':
    case 'character':
    case 'ip':
      return 'string';
    default:
      return 'other';
  }
}
