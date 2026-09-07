package plugin

import (
	"context"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"

	"github.com/crate/cratedb-grafana-datasource/pkg/macros"
)

// maxFilledBuckets bounds the rows a fill may add. A bucket width far below the
// panel range (`$__timeGroup("ts", '1ms', 0)` over a month) would otherwise
// materialise a frame the size of the range divided by the width.
const maxFilledBuckets = 100_000

// timeSeriesPlan carries what the response step needs and the frame no longer
// holds: the requested format, the panel range, and the bucket width and fill
// mode of the query's group macro.
type timeSeriesPlan struct {
	format   sqlutil.FormatQueryOption
	from     time.Time
	to       time.Time
	interval time.Duration
	fill     macros.Fill
}

type timeSeriesPlansKey struct{}

// MutateQueryData records a plan per RefID while the macros are still in the
// SQL. sqlds only threads the context it returns here into MutateResponse — the
// one MutateQuery returns reaches interpolation and stops there — and a frame
// carries its RefID in Name.
func (d *CrateDB) MutateQueryData(ctx context.Context, req *backend.QueryDataRequest) (context.Context, *backend.QueryDataRequest) {
	plans := make(map[string]timeSeriesPlan, len(req.Queries))
	for _, dataQuery := range req.Queries {
		query, err := sqlutil.GetQuery(dataQuery)
		if err != nil {
			continue
		}
		plan := timeSeriesPlan{
			format: query.Format,
			from:   query.TimeRange.From,
			to:     query.TimeRange.To,
		}
		if interval, fill, ok := macros.GroupFill(query); ok {
			plan.interval, plan.fill = interval, fill
		}
		plans[dataQuery.RefID] = plan
	}
	return context.WithValue(ctx, timeSeriesPlansKey{}, plans), req
}

// MutateResponse promotes a numeric "time" column to the frame's time axis and
// fills the buckets a $__timeGroup fill argument asked for. It runs after
// LongToWide, so a fill reaches every per-series column.
func (d *CrateDB) MutateResponse(ctx context.Context, frames data.Frames) (data.Frames, error) {
	plans, ok := ctx.Value(timeSeriesPlansKey{}).(map[string]timeSeriesPlan)
	if !ok {
		return frames, nil
	}
	for i, frame := range frames {
		if frame == nil {
			continue
		}
		plan, ok := plans[frame.Name]
		if !ok {
			continue
		}
		if plan.format == sqlutil.FormatOptionTimeSeries {
			promoteNumericTimeField(frame)
		}
		// a long frame holds several rows per bucket, so a gap in it is not a
		// gap in one series
		if plan.fill.Mode != macros.FillNone && frame.TimeSeriesSchema().Type != data.TimeSeriesTypeLong {
			frames[i] = fillBuckets(frame, plan)
		}
	}
	return frames, nil
}

// promoteNumericTimeField turns a numeric column named "time" into the frame's
// time axis the way Grafana's built-in SQL data sources do: the value is epoch
// seconds, and a fractional part is sub-second precision. NULLs stay NULL.
func promoteNumericTimeField(frame *data.Frame) {
	for i, field := range frame.Fields {
		if !strings.EqualFold(field.Name, "time") || !field.Type().Numeric() {
			continue
		}
		times := data.NewFieldFromFieldType(data.FieldTypeNullableTime, field.Len())
		times.Name, times.Labels, times.Config = field.Name, field.Labels, field.Config
		for row := 0; row < field.Len(); row++ {
			if field.NilAt(row) {
				continue
			}
			seconds, err := field.FloatAt(row)
			if err != nil {
				continue
			}
			whole, fraction := math.Modf(seconds)
			times.SetConcrete(row, time.Unix(int64(whole), int64(math.Round(fraction*float64(time.Second)))).UTC())
		}
		frame.Fields[i] = times
	}
}

// fillBuckets returns the frame with a row at every bucket boundary inside the
// panel range the query left empty. Boundaries align with DATE_BIN's origin 0.
// Returned rows keep their values and their order among themselves; the result
// is ordered by time.
func fillBuckets(frame *data.Frame, plan timeSeriesPlan) *data.Frame {
	step := plan.interval.Milliseconds()
	if step <= 0 {
		return frame
	}
	timeIdx, ok := soleTimeField(frame)
	if !ok {
		return frame
	}
	rows, err := frame.RowLen()
	if err != nil {
		return frame
	}

	present := make(map[int64]struct{}, rows)
	merged := make([]filledRow, 0, rows)
	for row := 0; row < rows; row++ {
		at, ok := frame.ConcreteAt(timeIdx, row)
		if !ok {
			// a NULL timestamp belongs to no bucket; keep the row ahead of every
			// boundary rather than dropping it
			merged = append(merged, filledRow{at: math.MinInt64, source: row})
			continue
		}
		stamp := at.(time.Time).UnixMilli()
		present[stamp] = struct{}{}
		merged = append(merged, filledRow{at: stamp, source: row})
	}

	first, last := ceilTo(plan.from.UnixMilli(), step), plan.to.UnixMilli()
	if last >= first && (last-first)/step >= maxFilledBuckets {
		return frame
	}
	gaps := 0
	for bucket := first; bucket <= last; bucket += step {
		if _, ok := present[bucket]; ok {
			continue
		}
		merged = append(merged, filledRow{at: bucket, source: -1})
		gaps++
	}
	if gaps == 0 {
		return frame
	}
	sort.SliceStable(merged, func(i, j int) bool { return merged[i].at < merged[j].at })

	filled := data.NewFrame(frame.Name)
	filled.RefID, filled.Meta = frame.RefID, frame.Meta
	leadingGap := merged[0].source < 0
	for i, field := range frame.Fields {
		fieldType := field.Type()
		if i != timeIdx && fillCanLeaveEmpty(plan.fill, fieldType, leadingGap) {
			fieldType = fieldType.NullableType()
		}
		column := data.NewFieldFromFieldType(fieldType, len(merged))
		column.Name, column.Labels, column.Config = field.Name, field.Labels, field.Config
		filled.Fields = append(filled.Fields, column)
	}

	for row, entry := range merged {
		for i := range frame.Fields {
			switch {
			case entry.source >= 0:
				copyCell(filled, frame, i, row, entry.source)
			case i == timeIdx:
				filled.SetConcrete(i, row, time.UnixMilli(entry.at).UTC())
			default:
				setFillCell(filled, i, row, plan.fill)
			}
		}
	}
	return filled
}

// filledRow is one output row: a bucket timestamp and the index of the query row
// it came from, or -1 for an inserted boundary.
type filledRow struct {
	at     int64
	source int
}

func soleTimeField(frame *data.Frame) (int, bool) {
	found := -1
	for i, field := range frame.Fields {
		if !field.Type().Time() {
			continue
		}
		if found >= 0 {
			return 0, false
		}
		found = i
	}
	return found, found >= 0
}

// fillCanLeaveEmpty reports whether the fill can produce a cell with no value,
// which a non-nullable field cannot hold.
func fillCanLeaveEmpty(fill macros.Fill, fieldType data.FieldType, leadingGap bool) bool {
	switch fill.Mode {
	case macros.FillNull:
		return true
	case macros.FillPrevious:
		return leadingGap
	case macros.FillValue:
		return !fieldType.Numeric()
	}
	return false
}

// copyCell moves one cell across, widening a concrete value where the filled
// field had to become nullable.
func copyCell(filled, source *data.Frame, fieldIdx, row, sourceRow int) {
	if filled.Fields[fieldIdx].Nullable() && !source.Fields[fieldIdx].Nullable() {
		filled.SetConcrete(fieldIdx, row, source.CopyAt(fieldIdx, sourceRow))
		return
	}
	filled.Set(fieldIdx, row, source.CopyAt(fieldIdx, sourceRow))
}

// setFillCell writes the fill value into an inserted bucket. FillNull, and any
// value with no representation in the field's type, leave the nil the field was
// created with.
func setFillCell(filled *data.Frame, fieldIdx, row int, fill macros.Fill) {
	switch fill.Mode {
	case macros.FillValue:
		if value, ok := numericFill(filled.Fields[fieldIdx].Type(), fill.Value); ok {
			filled.SetConcrete(fieldIdx, row, value)
		}
	case macros.FillPrevious:
		if row == 0 {
			return
		}
		if previous, ok := filled.ConcreteAt(fieldIdx, row-1); ok {
			filled.SetConcrete(fieldIdx, row, previous)
		}
	}
}

// numericFill renders the fill literal in the field's element type.
func numericFill(fieldType data.FieldType, value float64) (any, bool) {
	switch fieldType.NonNullableType() {
	case data.FieldTypeInt8:
		return int8(value), true
	case data.FieldTypeInt16:
		return int16(value), true
	case data.FieldTypeInt32:
		return int32(value), true
	case data.FieldTypeInt64:
		return int64(value), true
	case data.FieldTypeUint8:
		return uint8(value), true
	case data.FieldTypeUint16:
		return uint16(value), true
	case data.FieldTypeUint32:
		return uint32(value), true
	case data.FieldTypeUint64:
		return uint64(value), true
	case data.FieldTypeFloat32:
		return float32(value), true
	case data.FieldTypeFloat64:
		return value, true
	}
	return nil, false
}

// ceilTo rounds ms up to the next DATE_BIN boundary of width step, flooring
// toward negative infinity for pre-epoch instants.
func ceilTo(ms, step int64) int64 {
	remainder := ms % step
	if remainder == 0 {
		return ms
	}
	if remainder < 0 {
		return ms - remainder
	}
	return ms - remainder + step
}
