import { TypedVariableModel } from '@grafana/data';

// $__conditionalAll(cond, $var): keeps cond when the variable has a concrete
// selection, drops to 1=1 on "All"; interpolated frontend-side, backend never sees it
//
// adapted from the ClickHouse datasource (Apache-2.0),
// https://github.com/grafana/clickhouse-datasource; see NOTICE
export function applyConditionalAll(rawQuery: string, templateVars: TypedVariableModel[]): string {
  if (!rawQuery) {
    return rawQuery;
  }
  const macro = '$__conditionalAll(';
  // scan right-to-left; a malformed occurrence (wrong arg count) is left in place and skipped
  let macroIndex = rawQuery.lastIndexOf(macro);

  while (macroIndex !== -1) {
    const params = getMacroArgs(rawQuery, macroIndex + macro.length - 1);
    if (params.length === 2) {
      const templateVarParam = params[1].trim();
      const templateVar = VAR_REGEX.exec(templateVarParam);
      let phrase = params[0];
      if (templateVar) {
        const variable = templateVars.find((x) => x.name === templateVar[0]) as any;
        if (isAllSelected(variable?.current?.value)) {
          phrase = '1=1';
        }
      }
      // splice by offset, not String.replace: the raw-SQL condition must not be read
      // as a replacement pattern ($&, $', $$ would corrupt it)
      const matchLength = macro.length + params[0].length + 1 + params[1].length + 1;
      rawQuery = rawQuery.slice(0, macroIndex) + phrase + rawQuery.slice(macroIndex + matchLength);
    }
    // step strictly left of this occurrence so we terminate and skip any malformed macro left in place
    macroIndex = rawQuery.lastIndexOf(macro, macroIndex - 1);
  }
  return rawQuery;
}

const VAR_REGEX = /(?<=\$\{)[\w\d]+(?=\})|(?<=\$)[\w\d]+/;

// Grafana marks "All" as the $__all sentinel or an empty selection, scalar or array
function isAllSelected(value: unknown): boolean {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.length === 0 || values.some((v) => v === '' || v === '$__all');
}

// split the macro's args at the top level, respecting nested parens and quoted
// literals (so a comma/paren inside 'a,b' doesn't miscount args). openParenIndex
// points at the opening '('; returns [] when the parens don't balance.
function getMacroArgs(query: string, openParenIndex: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = openParenIndex + 1;
  let inString = false;
  for (let i = openParenIndex; i < query.length; i++) {
    const ch = query[i];
    if (inString) {
      if (ch === "'") {
        // a doubled '' is an escaped quote: stay inside the literal
        if (query[i + 1] === "'") {
          i++;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
    } else if (ch === '(') {
      depth++;
      if (depth === 1) {
        start = i + 1;
      }
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        args.push(query.substring(start, i));
        return args;
      }
    } else if (ch === ',' && depth === 1) {
      args.push(query.substring(start, i));
      start = i + 1;
    }
  }
  return [];
}
