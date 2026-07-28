package macros

import "regexp"

// trailingTimeGroup matches a $__timeGroup(...) bare projection (comma-terminated,
// whitespace tolerated). Args allow one level of nested parens, so an expression
// arg like date_trunc('hour', x) still matches.
var trailingTimeGroup = regexp.MustCompile(`\$__timeGroup\(((?:[^()]|\([^()]*\))*)\)\s*,`)

// RewriteTrailingTimeGroup turns every `$__timeGroup(...),` into `$__timeGroupAlias(...),`
// before interpolation, so a bare bucket projection gets the "time" alias Grafana expects.
func RewriteTrailingTimeGroup(sql string) string {
	return trailingTimeGroup.ReplaceAllString(sql, "$$__timeGroupAlias(${1}),")
}
