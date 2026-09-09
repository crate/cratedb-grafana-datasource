package plugin

import (
	"strings"
	"sync"
	"time"
)

type schemaCacheEntry struct {
	values  []string
	expires time.Time
}

// schemaCache is a TTL cache in front of the introspection queries: without it
// every autocomplete keystroke round-trips to information_schema.
type schemaCache struct {
	mu      sync.Mutex
	ttl     time.Duration
	entries map[string]schemaCacheEntry
}

// reset configures the TTL and drops all entries. TTL <= 0 disables caching.
func (c *schemaCache) reset(ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.ttl = ttl
	c.entries = make(map[string]schemaCacheEntry)
}

// get returns the cached values for key, or nil on miss/expiry/disabled.
func (c *schemaCache) get(key string) []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.ttl <= 0 {
		return nil
	}
	entry, ok := c.entries[key]
	if !ok {
		return nil
	}
	if time.Now().After(entry.expires) {
		// drop the stale entry eagerly instead of letting it linger until the next reset
		delete(c.entries, key)
		return nil
	}
	// copy so callers can't corrupt the cache; make (not append-nil) keeps empty != miss
	values := make([]string, len(entry.values))
	copy(values, entry.values)
	return values
}

// put stores a copy of values under key for the configured TTL, dropping entries
// that have expired since the last sweep (a key nobody reads again is never
// evicted by get).
func (c *schemaCache) put(key string, values []string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.ttl <= 0 {
		return
	}
	now := time.Now()
	for existing, entry := range c.entries {
		if now.After(entry.expires) {
			delete(c.entries, existing)
		}
	}
	stored := make([]string, len(values))
	copy(stored, values)
	c.entries[key] = schemaCacheEntry{values: stored, expires: now.Add(c.ttl)}
}

// cacheKey joins the query with its arguments into a stable key.
func cacheKey(query string, args ...interface{}) string {
	var b strings.Builder
	b.WriteString(query)
	for _, arg := range args {
		b.WriteString("\x00")
		if s, ok := arg.(string); ok {
			b.WriteString(s)
		}
	}
	return b.String()
}
