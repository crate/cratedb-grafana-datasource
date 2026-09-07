package plugin

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var (
	rangeFrom = time.Date(2026, 7, 3, 10, 0, 0, 0, time.UTC)
	rangeTo   = rangeFrom.Add(4 * time.Minute)
)

func bucket(minutes int) time.Time { return rangeFrom.Add(time.Duration(minutes) * time.Minute) }

// respond runs one query's frame through the two mutators the way sqlds does:
// the plan comes from MutateQueryData and reaches MutateResponse in the context.
func respond(t *testing.T, rawSQL string, format sqlutil.FormatQueryOption, frame *data.Frame) *data.Frame {
	t.Helper()
	return respondOver(t, rawSQL, format, frame, rangeFrom, rangeTo)
}

func respondOver(t *testing.T, rawSQL string, format sqlutil.FormatQueryOption, frame *data.Frame, from, to time.Time) *data.Frame {
	t.Helper()
	body, err := json.Marshal(struct {
		RawSQL string                    `json:"rawSql"`
		Format sqlutil.FormatQueryOption `json:"format"`
	}{rawSQL, format})
	require.NoError(t, err)

	driver := &CrateDB{}
	ctx, _ := driver.MutateQueryData(context.Background(), &backend.QueryDataRequest{
		Queries: []backend.DataQuery{{
			RefID:     frame.Name,
			JSON:      body,
			Interval:  time.Minute,
			TimeRange: backend.TimeRange{From: from, To: to},
		}},
	})

	frames, err := driver.MutateResponse(ctx, data.Frames{frame})
	require.NoError(t, err)
	require.Len(t, frames, 1)
	return frames[0]
}

func stamps(t *testing.T, frame *data.Frame, fieldIdx int) []time.Time {
	t.Helper()
	rows, err := frame.RowLen()
	require.NoError(t, err)
	out := make([]time.Time, 0, rows)
	for row := 0; row < rows; row++ {
		at, ok := frame.ConcreteAt(fieldIdx, row)
		require.True(t, ok, "row %d has no timestamp", row)
		out = append(out, at.(time.Time).UTC())
	}
	return out
}

// numbers reads a numeric column as float64, with nil for a NULL cell, so cases
// can compare across the underlying element types.
func numbers(t *testing.T, frame *data.Frame, fieldIdx int) []*float64 {
	t.Helper()
	rows, err := frame.RowLen()
	require.NoError(t, err)
	out := make([]*float64, rows)
	for row := 0; row < rows; row++ {
		if frame.Fields[fieldIdx].NilAt(row) {
			continue
		}
		value, err := frame.Fields[fieldIdx].FloatAt(row)
		require.NoError(t, err)
		out[row] = &value
	}
	return out
}

func number(v float64) *float64 { return &v }

func TestFillsBucketsTheQueryLeftEmpty(t *testing.T) {
	cases := []struct {
		name       string
		sql        string
		startOff   time.Duration
		at         []time.Time
		values     any
		wantAt     []time.Time
		wantValues []*float64
		wantType   data.FieldType
	}{
		{
			name:       "leading buckets",
			sql:        `SELECT $__timeGroupAlias("ts", '1m', NULL), avg(v) FROM t`,
			at:         []time.Time{bucket(2), bucket(3), bucket(4)},
			values:     []float64{7, 8, 9},
			wantAt:     []time.Time{bucket(0), bucket(1), bucket(2), bucket(3), bucket(4)},
			wantValues: []*float64{nil, nil, number(7), number(8), number(9)},
			wantType:   data.FieldTypeNullableFloat64,
		},
		{
			name:       "middle buckets",
			sql:        `SELECT $__timeGroupAlias("ts", '1m', NULL), avg(v) FROM t`,
			at:         []time.Time{bucket(0), bucket(2), bucket(4)},
			values:     []float64{7, 8, 9},
			wantAt:     []time.Time{bucket(0), bucket(1), bucket(2), bucket(3), bucket(4)},
			wantValues: []*float64{number(7), nil, number(8), nil, number(9)},
			wantType:   data.FieldTypeNullableFloat64,
		},
		{
			name:       "trailing buckets",
			sql:        `SELECT $__timeGroupAlias("ts", '1m', NULL), avg(v) FROM t`,
			at:         []time.Time{bucket(0), bucket(1)},
			values:     []float64{7, 8},
			wantAt:     []time.Time{bucket(0), bucket(1), bucket(2), bucket(3), bucket(4)},
			wantValues: []*float64{number(7), number(8), nil, nil, nil},
			wantType:   data.FieldTypeNullableFloat64,
		},
		{
			name:       "previous carries the last value forward and starts NULL",
			sql:        `SELECT $__timeGroupAlias("ts", '1m', previous), count(*) FROM t`,
			at:         []time.Time{bucket(2), bucket(3)},
			values:     []int64{7, 8},
			wantAt:     []time.Time{bucket(0), bucket(1), bucket(2), bucket(3), bucket(4)},
			wantValues: []*float64{nil, nil, number(7), number(8), number(8)},
			wantType:   data.FieldTypeNullableInt64,
		},
		{
			name:       "numeric fill keeps an integer column integral",
			sql:        `SELECT $__timeGroupAlias("ts", '1m', 0), count(*) FROM t`,
			at:         []time.Time{bucket(0), bucket(2)},
			values:     []int64{5, 9},
			wantAt:     []time.Time{bucket(0), bucket(1), bucket(2), bucket(3), bucket(4)},
			wantValues: []*float64{number(5), number(0), number(9), number(0), number(0)},
			wantType:   data.FieldTypeInt64,
		},
		{
			name:       "numeric fill keeps a float column's decimals",
			sql:        `SELECT $__timeGroupAlias("ts", '1m', 1.5), avg(v) FROM t`,
			at:         []time.Time{bucket(1)},
			values:     []float64{2.25},
			wantAt:     []time.Time{bucket(0), bucket(1), bucket(2), bucket(3), bucket(4)},
			wantValues: []*float64{number(1.5), number(2.25), number(1.5), number(1.5), number(1.5)},
			wantType:   data.FieldTypeFloat64,
		},
		{
			name:       "a complete range is returned as it came",
			sql:        `SELECT $__timeGroupAlias("ts", '1m', NULL), avg(v) FROM t`,
			at:         []time.Time{bucket(0), bucket(1), bucket(2), bucket(3), bucket(4)},
			values:     []float64{1, 2, 3, 4, 5},
			wantAt:     []time.Time{bucket(0), bucket(1), bucket(2), bucket(3), bucket(4)},
			wantValues: []*float64{number(1), number(2), number(3), number(4), number(5)},
			wantType:   data.FieldTypeFloat64,
		},
		{
			name:       "a range start inside a bucket still fills that bucket",
			sql:        `SELECT $__timeGroupAlias("ts", '1m', 0), count(*) FROM t`,
			startOff:   30 * time.Second,
			at:         []time.Time{bucket(2)},
			values:     []int64{7},
			wantAt:     []time.Time{bucket(0), bucket(1), bucket(2), bucket(3), bucket(4)},
			wantValues: []*float64{number(0), number(0), number(7), number(0), number(0)},
			wantType:   data.FieldTypeInt64,
		},
		{
			name:       "a two-argument group macro leaves the gaps alone",
			sql:        `SELECT $__timeGroupAlias("ts", '1m'), avg(v) FROM t`,
			at:         []time.Time{bucket(0), bucket(4)},
			values:     []float64{1, 5},
			wantAt:     []time.Time{bucket(0), bucket(4)},
			wantValues: []*float64{number(1), number(5)},
			wantType:   data.FieldTypeFloat64,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			frame := data.NewFrame("A",
				data.NewField("time", nil, tc.at),
				data.NewField("value", nil, tc.values),
			)

			got := respondOver(t, tc.sql, sqlutil.FormatOptionTimeSeries, frame, rangeFrom.Add(tc.startOff), rangeTo)

			assert.Equal(t, tc.wantAt, stamps(t, got, 0))
			assert.Equal(t, tc.wantValues, numbers(t, got, 1))
			assert.Equal(t, tc.wantType, got.Fields[1].Type())
		})
	}
}

func TestFillLeavesFramesWithoutOneTimeAxisAlone(t *testing.T) {
	sql := `SELECT $__timeGroupAlias("ts", '1m', 0), count(*) FROM t`

	t.Run("no time field", func(t *testing.T) {
		frame := data.NewFrame("A",
			data.NewField("host", nil, []string{"a", "b"}),
			data.NewField("value", nil, []int64{1, 2}),
		)

		got := respond(t, sql, sqlutil.FormatOptionTimeSeries, frame)

		assert.Same(t, frame, got)
	})

	t.Run("two time fields leave no single axis to fill", func(t *testing.T) {
		frame := data.NewFrame("A",
			data.NewField("time", nil, []time.Time{bucket(0)}),
			data.NewField("seen", nil, []time.Time{bucket(0)}),
			data.NewField("value", nil, []int64{1}),
		)

		got := respond(t, sql, sqlutil.FormatOptionTimeSeries, frame)

		assert.Same(t, frame, got)
	})

	t.Run("a bucket count over the ceiling is reported instead of filled", func(t *testing.T) {
		frame := data.NewFrame("A",
			data.NewField("time", nil, []time.Time{bucket(0)}),
			data.NewField("value", nil, []int64{1}),
		)

		got := respond(t, `SELECT $__timeGroupAlias("ts", '1ms', 0), count(*) FROM t`, sqlutil.FormatOptionTimeSeries, frame)

		assert.Same(t, frame, got)
		require.NotNil(t, got.Meta)
		require.Len(t, got.Meta.Notices, 1)
		assert.Equal(t, data.NoticeSeverityWarning, got.Meta.Notices[0].Severity)
	})

	t.Run("long format holds several series per bucket", func(t *testing.T) {
		frame := data.NewFrame("A",
			data.NewField("time", nil, []time.Time{bucket(0), bucket(0)}),
			data.NewField("host", nil, []string{"a", "b"}),
			data.NewField("value", nil, []int64{1, 2}),
		)

		got := respond(t, sql, sqlutil.FormatOptionTimeSeries, frame)

		assert.Same(t, frame, got)
	})
}

func TestFillReachesEveryWideSeries(t *testing.T) {
	frame := data.NewFrame("A",
		data.NewField("time", nil, []time.Time{bucket(0), bucket(2)}),
		data.NewField("value", data.Labels{"host": "a"}, []int64{1, 3}),
		data.NewField("value", data.Labels{"host": "b"}, []int64{2, 4}),
	)

	got := respond(t, `SELECT $__timeGroupAlias("ts", '1m', 0), value FROM t`, sqlutil.FormatOptionTimeSeries, frame)

	assert.Equal(t, []time.Time{bucket(0), bucket(1), bucket(2), bucket(3), bucket(4)}, stamps(t, got, 0))
	assert.Equal(t, []*float64{number(1), number(0), number(3), number(0), number(0)}, numbers(t, got, 1))
	assert.Equal(t, []*float64{number(2), number(0), number(4), number(0), number(0)}, numbers(t, got, 2))
	assert.Equal(t, data.Labels{"host": "b"}, got.Fields[2].Labels)
}

func TestPreviousFillCarriesOnlyBucketedValues(t *testing.T) {
	at := bucket(2)
	frame := data.NewFrame("A",
		data.NewField("time", nil, []*time.Time{nil, &at}),
		data.NewField("value", nil, []int64{99, 7}),
	)

	got := respond(t, `SELECT $__timeGroupAlias("ts", '1m', previous), count(*) FROM t`, sqlutil.FormatOptionTimeSeries, frame)

	assert.Equal(t, []*float64{number(99), nil, nil, number(7), number(7), number(7)}, numbers(t, got, 1))
	assert.True(t, got.Fields[0].NilAt(0))
}

func TestNumericTimeColumnBecomesTheTimeAxis(t *testing.T) {
	epoch := func(minutes int) int64 { return bucket(minutes).Unix() }

	t.Run("integer seconds", func(t *testing.T) {
		frame := data.NewFrame("A",
			data.NewField("time", nil, []int64{epoch(0), epoch(1)}),
			data.NewField("value", nil, []int64{1, 2}),
		)

		got := respond(t, `SELECT $__unixEpochGroupAlias("ts", '1m'), count(*) FROM t`, sqlutil.FormatOptionTimeSeries, frame)

		assert.Equal(t, data.FieldTypeNullableTime, got.Fields[0].Type())
		assert.Equal(t, []time.Time{bucket(0), bucket(1)}, stamps(t, got, 0))
	})

	t.Run("milliseconds are the default reading", func(t *testing.T) {
		frame := data.NewFrame("A",
			data.NewField("time", nil, []int64{bucket(0).UnixMilli(), bucket(1).UnixMilli()}),
			data.NewField("value", nil, []int64{1, 2}),
		)

		got := respond(t, `SELECT "ts"::bigint AS "time", count(*) FROM t`, sqlutil.FormatOptionTimeSeries, frame)

		assert.Equal(t, []time.Time{bucket(0), bucket(1)}, stamps(t, got, 0))
	})

	t.Run("nanoseconds are read at their own resolution", func(t *testing.T) {
		frame := data.NewFrame("A",
			data.NewField("time", nil, []int64{bucket(0).UnixNano(), bucket(1).UnixNano()}),
			data.NewField("value", nil, []int64{1, 2}),
		)

		got := respond(t, `SELECT "nanos" AS "time", count(*) FROM t`, sqlutil.FormatOptionTimeSeries, frame)

		assert.Equal(t, []time.Time{bucket(0), bucket(1)}, stamps(t, got, 0))
	})

	t.Run("fractional seconds keep their sub-second part", func(t *testing.T) {
		frame := data.NewFrame("A",
			data.NewField("time", nil, []float64{float64(epoch(0)) + 0.25}),
			data.NewField("value", nil, []float64{1}),
		)

		got := respond(t, `SELECT $__timeEpoch("ts"), v FROM t`, sqlutil.FormatOptionTimeSeries, frame)

		assert.Equal(t, []time.Time{bucket(0).Add(250 * time.Millisecond)}, stamps(t, got, 0))
	})

	t.Run("a NULL timestamp stays NULL", func(t *testing.T) {
		seconds := epoch(0)
		frame := data.NewFrame("A",
			data.NewField("time", nil, []*int64{&seconds, nil}),
			data.NewField("value", nil, []int64{1, 2}),
		)

		got := respond(t, `SELECT $__timeEpoch("ts"), v FROM t`, sqlutil.FormatOptionTimeSeries, frame)

		assert.Equal(t, data.FieldTypeNullableTime, got.Fields[0].Type())
		assert.False(t, got.Fields[0].NilAt(0))
		assert.True(t, got.Fields[0].NilAt(1))
	})

	t.Run("the table format keeps the column numeric", func(t *testing.T) {
		frame := data.NewFrame("A",
			data.NewField("time", nil, []int64{epoch(0)}),
			data.NewField("value", nil, []int64{1}),
		)

		got := respond(t, `SELECT $__unixEpochGroupAlias("ts", '1m'), count(*) FROM t`, sqlutil.FormatOptionTable, frame)

		assert.Equal(t, data.FieldTypeInt64, got.Fields[0].Type())
	})

	t.Run("a promoted axis is filled like any other", func(t *testing.T) {
		frame := data.NewFrame("A",
			data.NewField("time", nil, []int64{epoch(0), epoch(2)}),
			data.NewField("value", nil, []int64{1, 3}),
		)

		got := respond(t, `SELECT $__unixEpochGroupAlias("ts", '1m', 0), count(*) FROM t`, sqlutil.FormatOptionTimeSeries, frame)

		assert.Equal(t, []time.Time{bucket(0), bucket(1), bucket(2), bucket(3), bucket(4)}, stamps(t, got, 0))
		assert.Equal(t, []*float64{number(1), number(0), number(3), number(0), number(0)}, numbers(t, got, 1))
	})
}
