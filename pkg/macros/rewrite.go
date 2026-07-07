package macros

import "regexp"

// trailingTimeGroup matches a $__timeGroup(...) call used as a bare projection
// (followed by a comma, whitespace tolerated).
var trailingTimeGroup = regexp.MustCompile(`\$__timeGroup\(([^)]*)\)\s*,`)

// RewriteTrailingTimeGroup turns every `$__timeGroup(...),` into `$__timeGroupAlias(...),`
// before interpolation, so a bare bucket projection gets the "time" alias Grafana expects.
func RewriteTrailingTimeGroup(sql string) string {
	return trailingTimeGroup.ReplaceAllString(sql, "$$__timeGroupAlias(${1}),")
}
