package macros

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
)

// FillMode selects what a gap-filled bucket carries in every non-time field.
type FillMode int

const (
	// FillNone is a two-argument group macro: gaps stay gaps.
	FillNone FillMode = iota
	FillNull
	FillPrevious
	FillValue
)

// Fill is the optional third argument of $__timeGroup / $__timeGroupAlias.
// Value is only meaningful for FillValue.
type Fill struct {
	Mode  FillMode
	Value float64
}

// ParseFill reads a fill argument: NULL, previous, or a numeric literal.
func ParseFill(arg string) (Fill, error) {
	trimmed := strings.Trim(arg, `'" `)
	switch strings.ToLower(trimmed) {
	case "null":
		return Fill{Mode: FillNull}, nil
	case "previous":
		return Fill{Mode: FillPrevious}, nil
	}
	value, err := strconv.ParseFloat(trimmed, 64)
	if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
		return Fill{}, fmt.Errorf("unsupported fill value %q: expected NULL, previous or a number", arg)
	}
	return Fill{Mode: FillValue, Value: value}, nil
}

// groupMacroCall matches every bucketing macro that takes a fill argument.
var groupMacroCall = regexp.MustCompile(`\$__(?:timeGroup|unixEpochGroup)(?:Alias)?\b`)

// GroupFill reports the bucket width and fill mode of the first three-argument
// bucketing macro in the query, for the backend to fill the response with (the
// SQL cannot). A call the macro would reject yields false, so interpolation is
// the single place that reports the error.
func GroupFill(query *sqlutil.Query) (time.Duration, Fill, bool) {
	for _, at := range groupMacroCall.FindAllStringIndex(query.RawSQL, -1) {
		args, ok := splitCallArgs(query.RawSQL[at[1]:])
		if !ok || len(args) != 3 {
			continue
		}
		interval, err := parseInterval(query, args[1])
		if err != nil {
			continue
		}
		fill, err := ParseFill(args[2])
		if err != nil {
			continue
		}
		return interval, fill, true
	}
	return 0, Fill{}, false
}

// splitCallArgs reads a parenthesised argument list at the start of s. Only the
// parenthesis depth separates arguments, matching how sqlutil.Interpolate splits
// them, so this sees exactly what the macro is handed.
func splitCallArgs(s string) ([]string, bool) {
	if !strings.HasPrefix(s, "(") {
		return nil, false
	}
	var (
		args  []string
		arg   strings.Builder
		depth int
	)
	for _, r := range s {
		switch r {
		case '(':
			depth++
			if depth == 1 {
				continue
			}
		case ')':
			depth--
			if depth == 0 {
				return append(args, strings.TrimSpace(arg.String())), true
			}
		case ',':
			if depth == 1 {
				args = append(args, strings.TrimSpace(arg.String()))
				arg.Reset()
				continue
			}
		}
		arg.WriteRune(r)
	}
	return nil, false
}
