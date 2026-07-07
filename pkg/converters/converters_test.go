package converters

import (
	"encoding/json"
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
