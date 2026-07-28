package plugin

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestSchemaCache(t *testing.T) {
	t.Run("hit within ttl", func(t *testing.T) {
		var c schemaCache
		c.reset(time.Minute)
		c.put("k", []string{"a", "b"})
		assert.Equal(t, []string{"a", "b"}, c.get("k"))
	})

	t.Run("miss on unknown key", func(t *testing.T) {
		var c schemaCache
		c.reset(time.Minute)
		assert.Nil(t, c.get("unknown"))
	})

	t.Run("expires after ttl", func(t *testing.T) {
		var c schemaCache
		c.reset(time.Nanosecond)
		c.put("k", []string{"a"})
		time.Sleep(time.Millisecond)
		assert.Nil(t, c.get("k"))
	})

	t.Run("ttl zero disables", func(t *testing.T) {
		var c schemaCache
		c.reset(0)
		c.put("k", []string{"a"})
		assert.Nil(t, c.get("k"))
	})

	t.Run("reset drops entries", func(t *testing.T) {
		var c schemaCache
		c.reset(time.Minute)
		c.put("k", []string{"a"})
		c.reset(time.Minute)
		assert.Nil(t, c.get("k"))
	})

	t.Run("empty result is cached, not a miss", func(t *testing.T) {
		var c schemaCache
		c.reset(time.Minute)
		c.put("k", []string{})
		assert.NotNil(t, c.get("k"))
		assert.Empty(t, c.get("k"))
	})
}

func TestCacheKey(t *testing.T) {
	assert.NotEqual(t, cacheKey("q", "a", "b"), cacheKey("q", "ab"))
	assert.NotEqual(t, cacheKey("q", "a"), cacheKey("q", "b"))
	assert.Equal(t, cacheKey("q", "a"), cacheKey("q", "a"))
}
