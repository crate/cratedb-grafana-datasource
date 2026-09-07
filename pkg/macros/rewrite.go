package macros

import "strings"

const (
	timeGroupMacro = "$__timeGroup"
	timeGroupCall  = timeGroupMacro + "("
)

// RewriteTrailingTimeGroup turns a bare `$__timeGroup(...),` projection into
// `$__timeGroupAlias(...),` before interpolation, so a bucket in the select list
// gets the "time" alias Grafana expects. Only calls at paren depth 0 of the
// outermost SELECT's projection list qualify: `GROUP BY $__timeGroup(...), host`,
// a call nested in a function argument, and one inside a subquery all have to
// keep the bare form to stay valid SQL.
func RewriteTrailingTimeGroup(sql string) string {
	start, end := projectionSpan(sql)
	if start < 0 {
		return sql
	}

	var out strings.Builder
	out.WriteString(sql[:start])
	depth := 0
	for i := start; i < end; {
		if n := quotedLen(sql[i:]); n > 0 {
			out.WriteString(sql[i : i+n])
			i += n
			continue
		}
		if depth == 0 && strings.HasPrefix(sql[i:], timeGroupCall) {
			if args := callEnd(sql, i+len(timeGroupMacro)); args > 0 {
				if comma := commaAfter(sql, args, end); comma > 0 {
					out.WriteString("$__timeGroupAlias")
					out.WriteString(sql[i+len(timeGroupMacro) : args])
					out.WriteByte(',')
					i = comma + 1
					continue
				}
			}
		}
		switch sql[i] {
		case '(':
			depth++
		case ')':
			depth--
		}
		out.WriteByte(sql[i])
		i++
	}
	out.WriteString(sql[end:])
	return out.String()
}

// projectionSpan bounds the outermost SELECT's projection list: the offset just
// past that SELECT and the offset of the FROM closing it, or the end of the
// statement when there is none. A CTE's own SELECT and FROM sit at paren depth
// above 0 and are passed over, as is a FROM inside EXTRACT(... FROM ...).
// Returns -1 when the statement has no top-level SELECT.
func projectionSpan(sql string) (int, int) {
	start := -1
	depth := 0
	for i := 0; i < len(sql); {
		if n := quotedLen(sql[i:]); n > 0 {
			i += n
			continue
		}
		switch sql[i] {
		case '(':
			depth++
		case ')':
			depth--
		}
		if depth == 0 {
			if start < 0 && keywordAt(sql, i, "SELECT") {
				i += len("SELECT")
				start = i
				continue
			}
			if start >= 0 && keywordAt(sql, i, "FROM") {
				return start, i
			}
		}
		i++
	}
	if start < 0 {
		return -1, -1
	}
	return start, len(sql)
}

// quotedLen returns the byte length of the single- or double-quoted literal
// starting at s, or 0 when s does not start one. A doubled quote escapes.
func quotedLen(s string) int {
	if len(s) == 0 || (s[0] != '\'' && s[0] != '"') {
		return 0
	}
	quote := s[0]
	for i := 1; i < len(s); i++ {
		if s[i] != quote {
			continue
		}
		if i+1 < len(s) && s[i+1] == quote {
			i++
			continue
		}
		return i + 1
	}
	return len(s)
}

// callEnd returns the offset just past the ')' matching the '(' at open, or -1
// when the argument list is unterminated.
func callEnd(sql string, open int) int {
	depth := 0
	for i := open; i < len(sql); {
		if n := quotedLen(sql[i:]); n > 0 {
			i += n
			continue
		}
		switch sql[i] {
		case '(':
			depth++
		case ')':
			depth--
			if depth == 0 {
				return i + 1
			}
		}
		i++
	}
	return -1
}

// commaAfter returns the offset of the comma reachable from i across whitespace
// alone, or -1 when anything else comes first.
func commaAfter(sql string, i, end int) int {
	for ; i < end; i++ {
		switch sql[i] {
		case ' ', '\t', '\n', '\r':
		case ',':
			return i
		default:
			return -1
		}
	}
	return -1
}

func keywordAt(sql string, i int, keyword string) bool {
	if i+len(keyword) > len(sql) || !strings.EqualFold(sql[i:i+len(keyword)], keyword) {
		return false
	}
	if i > 0 && isWordByte(sql[i-1]) {
		return false
	}
	return i+len(keyword) == len(sql) || !isWordByte(sql[i+len(keyword)])
}

func isWordByte(b byte) bool {
	return b == '_' || b == '$' ||
		('0' <= b && b <= '9') ||
		('a' <= b && b <= 'z') ||
		('A' <= b && b <= 'Z')
}
