// Package converters maps CrateDB's PostgreSQL wire types to Grafana frame
// field types. pgx reports types via DatabaseTypeName() using pg names (INT8,
// TIMESTAMPTZ, JSON, _INT4 for arrays); the rest fall through to sqlutil defaults.
package converters

import (
	"encoding/json"
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

// CrateDB types → Grafana columns
var typeMap = map[string]converter{
	"BOOL": {fieldType: data.FieldTypeNullableBool, scanType: nullableBool},
	"INT2": {fieldType: data.FieldTypeNullableInt16, scanType: nullableInt16},
	"INT4": {fieldType: data.FieldTypeNullableInt32, scanType: nullableInt32},
	"INT8": {fieldType: data.FieldTypeNullableInt64, scanType: nullableInt64},

	"FLOAT4": {fieldType: data.FieldTypeNullableFloat32, scanType: nullableFloat32},
	"FLOAT8": {fieldType: data.FieldTypeNullableFloat64, scanType: nullableFloat64},
	// CrateDB NUMERIC is arbitrary-precision; frames aren't, so read it as float64.
	"NUMERIC": {fieldType: data.FieldTypeNullableFloat64, scanType: nullableFloat64},

	"VARCHAR": {fieldType: data.FieldTypeNullableString, scanType: nullableString},
	"TEXT":    {fieldType: data.FieldTypeNullableString, scanType: nullableString},
	"NAME":    {fieldType: data.FieldTypeNullableString, scanType: nullableString},
	"CHAR":    {fieldType: data.FieldTypeNullableString, scanType: nullableString},

	// ms-precision, arrive as time.Time via pgx; we only normalize to UTC
	"TIMESTAMP":   {convert: timestampToUTC, fieldType: data.FieldTypeNullableTime, scanType: nullableTime},
	"TIMESTAMPTZ": {convert: timestampToUTC, fieldType: data.FieldTypeNullableTime, scanType: nullableTime},

	// CrateDB OBJECT columns arrive as JSON text on the wire (pgx scans them
	// into a string); surfaced as a structured JSON field (a nil RawMessage carries NULL).
	"JSON": {convert: jsonToRawMessage, fieldType: data.FieldTypeJSON, scanType: nullableString},

	// arrays (incl. FLOAT_VECTOR, which reports as _FLOAT4) read as their pg
	// text form, e.g. {"1","2","3"}. GEO_POINT reports as POINT, unmapped, and
	// falls through to sqlutil's string default "(9.74,47.41)".
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

func jsonToRawMessage(in interface{}) (interface{}, error) {
	if in == nil {
		return json.RawMessage(nil), nil
	}
	v, ok := in.(**string)
	if !ok {
		return nil, fmt.Errorf("invalid JSON value: %v", in)
	}
	if v == nil || *v == nil {
		return json.RawMessage(nil), nil
	}
	// the string→[]byte conversion copies, so the RawMessage never aliases the
	// scan buffer (sqlutil requires converters to return fresh allocations)
	return json.RawMessage(**v), nil
}

func defaultConvert(in interface{}) (interface{}, error) {
	if in == nil {
		return nil, nil
	}
	return reflect.ValueOf(in).Elem().Interface(), nil
}
