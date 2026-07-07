package converters

import (
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
	// CrateDB OBJECT columns arrive as JSON text in v1.
	assert.Equal(t, data.FieldTypeNullableString, byName["JSON"])
	// FLOAT_VECTOR arrives as a float4 array.
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

func TestDefaultConverterDereferences(t *testing.T) {
	convert := converterByName(t, "INT8")

	value := int64(42)
	ptr := &value
	out, err := convert(&ptr)
	require.NoError(t, err)
	assert.Equal(t, &value, out)
}
