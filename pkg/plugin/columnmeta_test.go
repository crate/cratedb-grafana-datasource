package plugin

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestColumnMetaPairPacking(t *testing.T) {
	// identifiers can hold nearly any character; only NUL is off-limits, which is
	// exactly what the separator relies on
	cases := []columnMeta{
		{Name: "ts", Type: "timestamp with time zone"},
		{Name: "tags['source']", Type: "text"},
		{Name: `we"ird name`, Type: "double precision"},
		{Name: "no_type", Type: ""},
	}
	for _, meta := range cases {
		assert.Equal(t, meta, decodePair(encodePair(meta)))
	}
}

func TestDecodePairsEmptyMarshalsAsList(t *testing.T) {
	assert.NotNil(t, decodePairs([]string{}))
	assert.Len(t, decodePairs([]string{}), 0)
}
