// Package converters maps CrateDB's PostgreSQL wire types to Grafana frame
// field types. pgx reports types via DatabaseTypeName() using pg type names
// (INT8, TIMESTAMPTZ, JSON, _INT4 for arrays, ...); anything not listed here
// falls through to the sqlutil defaults.
//
// Converter table pattern adapted from the QuestDB Grafana plugin
// (Apache-2.0), https://github.com/questdb/grafana-questdb-datasource — see NOTICE.
package converters

import (
	"fmt"
	"reflect"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
)

type converter struct {
	convert   func(in interface{}) (interface{}, error)
	fieldType data.FieldType
	scanType  reflect.Type
}

var (
	nullableString  = reflect.PointerTo(reflect.PointerTo(reflect.TypeOf("")))
	nullableTime    = reflect.PointerTo(reflect.PointerTo(reflect.TypeOf(time.Time{})))
	nullableFloat64 = reflect.PointerTo(reflect.PointerTo(reflect.TypeOf(float64(0))))
	nullableFloat32 = reflect.PointerTo(reflect.PointerTo(reflect.TypeOf(float32(0))))
	nullableBool    = reflect.PointerTo(reflect.PointerTo(reflect.TypeOf(false)))
	nullableInt16   = reflect.PointerTo(reflect.PointerTo(reflect.TypeOf(int16(0))))
	nullableInt32   = reflect.PointerTo(reflect.PointerTo(reflect.TypeOf(int32(0))))
	nullableInt64   = reflect.PointerTo(reflect.PointerTo(reflect.TypeOf(int64(0))))
)

var typeMap = map[string]converter{
	"BOOL": {fieldType: data.FieldTypeNullableBool, scanType: nullableBool},
	"INT2": {fieldType: data.FieldTypeNullableInt16, scanType: nullableInt16},
	"INT4": {fieldType: data.FieldTypeNullableInt32, scanType: nullableInt32},
	"INT8": {fieldType: data.FieldTypeNullableInt64, scanType: nullableInt64},

	"FLOAT4": {fieldType: data.FieldTypeNullableFloat32, scanType: nullableFloat32},
	"FLOAT8": {fieldType: data.FieldTypeNullableFloat64, scanType: nullableFloat64},
	// CrateDB NUMERIC has arbitrary precision; grafana frames don't, so we
	// read it as float64. SPIKE(S3): verify pgx scans CrateDB NUMERIC into
	// *float64 without an explicit pgtype.Numeric hop.
	"NUMERIC": {fieldType: data.FieldTypeNullableFloat64, scanType: nullableFloat64},

	"VARCHAR": {fieldType: data.FieldTypeNullableString, scanType: nullableString},
	"TEXT":    {fieldType: data.FieldTypeNullableString, scanType: nullableString},
	"NAME":    {fieldType: data.FieldTypeNullableString, scanType: nullableString},
	"CHAR":    {fieldType: data.FieldTypeNullableString, scanType: nullableString},

	// CrateDB timestamps have millisecond precision and arrive as time.Time
	// through pgx; we only normalize to UTC.
	"TIMESTAMP":   {convert: timestampToUTC, fieldType: data.FieldTypeNullableTime, scanType: nullableTime},
	"TIMESTAMPTZ": {convert: timestampToUTC, fieldType: data.FieldTypeNullableTime, scanType: nullableTime},

	// CrateDB OBJECT columns arrive as JSON on the wire — the headline
	// divergence from stock PostgreSQL. v1 renders them as JSON text.
	// SPIKE(S3): consider data.FieldTypeNullableJSON so table panels get
	// structured rendering.
	"JSON": {fieldType: data.FieldTypeNullableString, scanType: nullableString},

	// Arrays (CrateDB ARRAY(...), including FLOAT_VECTOR as _FLOAT4) are
	// read as their text representation in v1.
	// SPIKE(S3): verify pgx's text fallback for array OIDs against CrateDB.
	"_BOOL":    {fieldType: data.FieldTypeNullableString, scanType: nullableString},
	"_INT2":    {fieldType: data.FieldTypeNullableString, scanType: nullableString},
	"_INT4":    {fieldType: data.FieldTypeNullableString, scanType: nullableString},
	"_INT8":    {fieldType: data.FieldTypeNullableString, scanType: nullableString},
	"_FLOAT4":  {fieldType: data.FieldTypeNullableString, scanType: nullableString},
	"_FLOAT8":  {fieldType: data.FieldTypeNullableString, scanType: nullableString},
	"_VARCHAR": {fieldType: data.FieldTypeNullableString, scanType: nullableString},
	"_TEXT":    {fieldType: data.FieldTypeNullableString, scanType: nullableString},
}

// CrateDBConverters is the converter list handed to sqlds.
var CrateDBConverters = buildConverters()

func buildConverters() []sqlutil.Converter {
	list := make([]sqlutil.Converter, 0, len(typeMap))
	for name, c := range typeMap {
		list = append(list, createConverter(name, c))
	}
	return list
}

func createConverter(name string, c converter) sqlutil.Converter {
	convert := defaultConvert
	if c.convert != nil {
		convert = c.convert
	}
	return sqlutil.Converter{
		Name:          name,
		InputScanType: c.scanType,
		InputTypeName: name,
		FrameConverter: sqlutil.FrameConverter{
			FieldType:     c.fieldType,
			ConverterFunc: convert,
		},
	}
}

func timestampToUTC(in interface{}) (interface{}, error) {
	if in == nil {
		return (*time.Time)(nil), nil
	}
	v, ok := in.(**time.Time)
	if !ok {
		return nil, fmt.Errorf("invalid timestamp value: %v", in)
	}
	if v == nil || *v == nil {
		return (*time.Time)(nil), nil
	}
	return new((**v).UTC()), nil
}

func defaultConvert(in interface{}) (interface{}, error) {
	if in == nil {
		return nil, nil
	}
	return reflect.ValueOf(in).Elem().Interface(), nil
}
