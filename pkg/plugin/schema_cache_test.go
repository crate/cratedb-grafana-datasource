package plugin

import (
	"strconv"
	"sync"
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

	t.Run("a caller mutating the slice it stored can't corrupt the cache", func(t *testing.T) {
		var c schemaCache
		c.reset(time.Minute)
		values := []string{"a"}
		c.put("k", values)
		values[0] = "mutated by the caller"
		assert.Equal(t, []string{"a"}, c.get("k"))
	})

	t.Run("put evicts entries nobody read back", func(t *testing.T) {
		var c schemaCache
		c.reset(10 * time.Millisecond)
		c.put("stale", []string{"a"})
		time.Sleep(20 * time.Millisecond)
		c.put("fresh", []string{"b"})

		c.mu.Lock()
		defer c.mu.Unlock()
		assert.NotContains(t, c.entries, "stale")
		assert.Contains(t, c.entries, "fresh")
	})
}

func TestSchemaCacheConcurrentAccess(t *testing.T) {
	var c schemaCache
	c.reset(time.Millisecond)

	keys := []string{"schemas", "tables/doc", "columns/doc/metrics"}
	var wg sync.WaitGroup
	for worker := 0; worker < 8; worker++ {
		wg.Add(1)
		go func(worker int) {
			defer wg.Done()
			for i := 0; i < 200; i++ {
				key := keys[i%len(keys)]
				if values := c.get(key); values != nil {
					values[0] = "mutated by the caller"
				}
				c.put(key, []string{key, strconv.Itoa(worker)})
			}
		}(worker)
	}
	wg.Wait()

	for _, key := range keys {
		if values := c.get(key); values != nil {
			assert.Equal(t, key, values[0], "a caller mutated the cached slice")
		}
	}
}

func TestCacheKey(t *testing.T) {
	assert.NotEqual(t, cacheKey("q", "a", "b"), cacheKey("q", "ab"))
	assert.NotEqual(t, cacheKey("q", "a"), cacheKey("q", "b"))
	assert.Equal(t, cacheKey("q", "a"), cacheKey("q", "a"))
}
