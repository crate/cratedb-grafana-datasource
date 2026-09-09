package converters

import (
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func converterByName(t *testing.T, name string) func(in interface{}) (interface{}, error) {
	t.Helper()
	for _, c := range CrateDBConverters {
		if c.Name == name {
			return c.FrameConverter.ConverterFunc
		}
	}
	t.Fatalf("no converter registered for %s", name)
	return nil
}

// representativeValues holds one scanned value per registered CrateDB type.
var representativeValues = map[string]interface{}{
	"BOOL": true,

	"INT2": int16(-7),
	"INT4": int32(70000),
	// beyond 2^53, where a float64 round-trip would lose the last digit
	"INT8": int64(9007199254740993),

	"FLOAT4":  float32(1.5),
	"FLOAT8":  float64(1.5),
	"NUMERIC": float64(12345.6789),

	"VARCHAR": "varchar",
	"TEXT":    "text",
	"NAME":    "name",
	"CHAR":    "c",

	"TIMESTAMP":   time.Date(2026, 7, 3, 12, 30, 0, 0, time.UTC),
	"TIMESTAMPTZ": time.Date(2026, 7, 3, 12, 30, 0, 0, time.UTC),

	"JSON": `{"source":"unit","n":1}`,

	"_BOOL":    "{t,f}",
	"_INT2":    "{1,2}",
	"_INT4":    "{1,2}",
	"_INT8":    "{1,2}",
	"_FLOAT4":  "{1.5,2.5}",
	"_FLOAT8":  "{1.5,2.5}",
	"_VARCHAR": `{"a","b"}`,
	"_TEXT":    `{"a","b"}`,
}

func TestEveryConverterFillsItsDeclaredFieldType(t *testing.T) {
	require.Len(t, representativeValues, len(CrateDBConverters))

	for _, c := range CrateDBConverters {
		t.Run(c.Name, func(t *testing.T) {
			value, ok := representativeValues[c.Name]
			require.True(t, ok, "no representative value registered")
			require.Equal(t, c.InputScanType, reflect.PointerTo(reflect.PointerTo(reflect.TypeOf(value))),
				"the representative value must match the declared scan type")

			field := data.NewFieldFromFieldType(c.FrameConverter.FieldType, 0)

			// pgx scans into **T: the outer pointer always exists, the inner one is
			// nil for a NULL
			scanned := reflect.New(reflect.TypeOf(value))
			scanned.Elem().Set(reflect.ValueOf(value))
			held := reflect.New(scanned.Type())
			held.Elem().Set(scanned)

			out, err := c.FrameConverter.ConverterFunc(held.Interface())
			require.NoError(t, err)
			field.Append(out)

			out, err = c.FrameConverter.ConverterFunc(reflect.New(scanned.Type()).Interface())
			require.NoError(t, err)
			field.Append(out)

			require.Equal(t, 2, field.Len())
			if field.Nullable() {
				got, ok := field.ConcreteAt(0)
				require.True(t, ok)
				assert.Equal(t, value, got)
				_, ok = field.ConcreteAt(1)
				assert.False(t, ok, "a NULL must not produce a value")
			}
		})
	}
}

func TestConverterRegistry(t *testing.T) {
	byName := map[string]data.FieldType{}
	for _, c := range CrateDBConverters {
		byName[c.Name] = c.FrameConverter.FieldType
	}

	assert.Equal(t, data.FieldTypeNullableInt64, byName["INT8"])
	assert.Equal(t, data.FieldTypeNullableTime, byName["TIMESTAMPTZ"])
	// CrateDB OBJECT columns surface as structured JSON fields.
	assert.Equal(t, data.FieldTypeJSON, byName["JSON"])
	// FLOAT_VECTOR arrives as a float4 array: a pg array literal, not JSON,
	// so it stays a string like every other array type.
	assert.Equal(t, data.FieldTypeNullableString, byName["_FLOAT4"])
}

func TestTimestampConverterNormalizesToUTC(t *testing.T) {
	convert := converterByName(t, "TIMESTAMPTZ")

	loc, err := time.LoadLocation("Europe/Berlin")
	require.NoError(t, err)
	local := time.Date(2026, 7, 3, 12, 30, 0, 0, loc)
	ptr := &local

	out, err := convert(&ptr)
	require.NoError(t, err)
	got, ok := out.(*time.Time)
	require.True(t, ok)
	assert.Equal(t, time.UTC, got.Location())
	assert.True(t, got.Equal(local))
}

func TestTimestampConverterHandlesNull(t *testing.T) {
	convert := converterByName(t, "TIMESTAMP")

	out, err := convert(nil)
	require.NoError(t, err)
	assert.Equal(t, (*time.Time)(nil), out)

	var null *time.Time
	out, err = convert(&null)
	require.NoError(t, err)
	assert.Equal(t, (*time.Time)(nil), out)
}

func TestJSONConverterReturnsRawMessage(t *testing.T) {
	convert := converterByName(t, "JSON")

	text := `{"source":"unit","n":1}`
	ptr := &text
	out, err := convert(&ptr)
	require.NoError(t, err)
	got, ok := out.(json.RawMessage)
	require.True(t, ok)
	require.NotNil(t, got)
	assert.JSONEq(t, text, string(got))

	// must not alias the scanned string's backing memory
	got[0] = 'X'
	assert.Equal(t, `{"source":"unit","n":1}`, text)
}

func TestJSONConverterHandlesNull(t *testing.T) {
	convert := converterByName(t, "JSON")

	out, err := convert(nil)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(nil), out)

	var null *string
	out, err = convert(&null)
	require.NoError(t, err)
	assert.Equal(t, json.RawMessage(nil), out)
}

func TestDefaultConverterDereferences(t *testing.T) {
	convert := converterByName(t, "INT8")

	value := int64(42)
	ptr := &value
	out, err := convert(&ptr)
	require.NoError(t, err)
	assert.Equal(t, &value, out)
}
