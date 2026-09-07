package macros

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRewriteTrailingTimeGroup(t *testing.T) {
	cases := []struct {
		name string
		sql  string
		want string
	}{
		{
			"bare projection gains the alias",
			`SELECT $__timeGroup("ts", $__interval), avg(value) FROM t`,
			`SELECT $__timeGroupAlias("ts", $__interval), avg(value) FROM t`,
		},
		{
			"whitespace before the comma still counts",
			`SELECT $__timeGroup("ts", '1m') , avg(value) FROM t`,
			`SELECT $__timeGroupAlias("ts", '1m'), avg(value) FROM t`,
		},
		{
			"no comma stays untouched",
			`SELECT avg(value) FROM t GROUP BY $__timeGroup("ts", '1m')`,
			`SELECT avg(value) FROM t GROUP BY $__timeGroup("ts", '1m')`,
		},
		{
			"closing paren after the call stays untouched",
			`SELECT max($__timeGroup("ts", '1m')) FROM t`,
			`SELECT max($__timeGroup("ts", '1m')) FROM t`,
		},
		{
			"explicit alias form stays untouched",
			`SELECT $__timeGroupAlias("ts", '1m'), avg(value) FROM t`,
			`SELECT $__timeGroupAlias("ts", '1m'), avg(value) FROM t`,
		},
		{
			"every occurrence is rewritten",
			`SELECT $__timeGroup(a, '1m'), $__timeGroup(b, '5m'), c FROM t`,
			`SELECT $__timeGroupAlias(a, '1m'), $__timeGroupAlias(b, '5m'), c FROM t`,
		},
		{
			"expression argument with nested parens still gains the alias",
			`SELECT $__timeGroup(date_trunc('hour', "ts"), '1m'), avg(value) FROM t`,
			`SELECT $__timeGroupAlias(date_trunc('hour', "ts"), '1m'), avg(value) FROM t`,
		},
		{
			"trailing comma in GROUP BY stays untouched",
			`SELECT avg(value) FROM t GROUP BY $__timeGroup("ts", '1m'), host`,
			`SELECT avg(value) FROM t GROUP BY $__timeGroup("ts", '1m'), host`,
		},
		{
			"trailing comma in ORDER BY stays untouched",
			`SELECT avg(value) FROM t ORDER BY $__timeGroup("ts", '1m'), host`,
			`SELECT avg(value) FROM t ORDER BY $__timeGroup("ts", '1m'), host`,
		},
		{
			"only the projection occurrence is rewritten",
			`SELECT $__timeGroup("ts", '1m'), host, avg(value) FROM t GROUP BY $__timeGroup("ts", '1m'), host`,
			`SELECT $__timeGroupAlias("ts", '1m'), host, avg(value) FROM t GROUP BY $__timeGroup("ts", '1m'), host`,
		},
		{
			"a string literal holding FROM does not close the projection",
			`SELECT $__timeGroup("ts", '1m'), 'FROM t' AS src FROM t GROUP BY $__timeGroup("ts", '1m'), src`,
			`SELECT $__timeGroupAlias("ts", '1m'), 'FROM t' AS src FROM t GROUP BY $__timeGroup("ts", '1m'), src`,
		},
		{
			"only the outermost SELECT of a WITH clause is rewritten",
			`WITH b AS (SELECT $__timeGroup("ts", '1m'), v FROM t) SELECT $__timeGroup("ts", '1m'), v FROM b`,
			`WITH b AS (SELECT $__timeGroup("ts", '1m'), v FROM t) SELECT $__timeGroupAlias("ts", '1m'), v FROM b`,
		},
		{
			"a call nested in a projection subquery stays untouched",
			`SELECT (SELECT $__timeGroup("ts", '1m'), v FROM u LIMIT 1), w FROM t`,
			`SELECT (SELECT $__timeGroup("ts", '1m'), v FROM u LIMIT 1), w FROM t`,
		},
		{
			"a call passed as a function argument stays untouched",
			`SELECT greatest($__timeGroup("ts", '1m'), "ts"), v FROM t`,
			`SELECT greatest($__timeGroup("ts", '1m'), "ts"), v FROM t`,
		},
		{
			"three-argument form gains the alias too",
			`SELECT $__timeGroup("ts", '1m', 0), count(*) FROM t`,
			`SELECT $__timeGroupAlias("ts", '1m', 0), count(*) FROM t`,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, RewriteTrailingTimeGroup(tc.sql))
		})
	}
}
