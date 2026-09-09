package plugin

import (
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadSettings(t *testing.T) {
	t.Run("applies CrateDB defaults", func(t *testing.T) {
		settings, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData: []byte(`{"server": "localhost"}`),
		})
		require.NoError(t, err)
		assert.Equal(t, int64(5432), settings.Port)
		assert.Equal(t, "crate", settings.Username)
		assert.Equal(t, "doc", settings.DefaultSchema)
		assert.Equal(t, int64(60), settings.QueryTimeout)
		assert.Equal(t, "disable", settings.TLSMode)
		assert.Equal(t, int64(DefaultMaxOpenConnections), settings.MaxOpenConnections)
		assert.Equal(t, int64(DefaultMaxIdleConnections), settings.MaxIdleConnections)
		assert.Equal(t, int64(DefaultMaxConnectionLifetime), settings.MaxConnectionLifetime)
	})

	t.Run("password is optional (trust auth)", func(t *testing.T) {
		settings, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData: []byte(`{"server": "cratedb.example.org"}`),
		})
		require.NoError(t, err)
		assert.Empty(t, settings.Password)
	})

	t.Run("explicit connection pool limits win", func(t *testing.T) {
		settings, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData: []byte(`{"server": "localhost", "maxOpenConnections": 7,
				"maxIdleConnections": 3, "maxConnectionLifetime": 900}`),
		})
		require.NoError(t, err)
		assert.Equal(t, int64(7), settings.MaxOpenConnections)
		assert.Equal(t, int64(3), settings.MaxIdleConnections)
		assert.Equal(t, int64(900), settings.MaxConnectionLifetime)
	})

	t.Run("accepts numbers as strings (provisioned YAML)", func(t *testing.T) {
		settings, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData: []byte(`{"server": "localhost", "port": "5433", "maxOpenConnections": "10"}`),
		})
		require.NoError(t, err)
		assert.Equal(t, int64(5433), settings.Port)
		assert.Equal(t, int64(10), settings.MaxOpenConnections)

		// a leading zero is not an octal prefix
		settings, err = LoadSettings(backend.DataSourceInstanceSettings{
			JSONData: []byte(`{"server": "localhost", "port": "05432"}`),
		})
		require.NoError(t, err)
		assert.Equal(t, int64(5432), settings.Port)
	})

	t.Run("an empty TLS mode loads as disable", func(t *testing.T) {
		settings, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData: []byte(`{"server": "localhost", "tlsMode": ""}`),
		})
		require.NoError(t, err)
		assert.Equal(t, "disable", settings.TLSMode)
		assert.Contains(t, GenerateDSN(settings), "sslmode='disable'")
	})

	t.Run("reads secure JSON fields", func(t *testing.T) {
		settings, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData:                []byte(`{"server": "localhost"}`),
			DecryptedSecureJSONData: map[string]string{"password": "secret"},
		})
		require.NoError(t, err)
		assert.Equal(t, "secret", settings.Password)
	})

	t.Run("rejects malformed JSON", func(t *testing.T) {
		_, err := LoadSettings(backend.DataSourceInstanceSettings{JSONData: []byte(`{`)})
		assert.ErrorIs(t, err, ErrInvalidJSON)
	})

	t.Run("rejects an unparsable number", func(t *testing.T) {
		_, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData: []byte(`{"server": "localhost", "port": "not a port"}`),
		})
		assert.ErrorContains(t, err, "could not parse port value")
	})

	t.Run("rejects missing server", func(t *testing.T) {
		_, err := LoadSettings(backend.DataSourceInstanceSettings{JSONData: []byte(`{}`)})
		assert.ErrorIs(t, err, ErrInvalidServerName)
	})

	t.Run("rejects a non-positive port", func(t *testing.T) {
		_, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData: []byte(`{"server": "localhost", "port": 0}`),
		})
		assert.ErrorIs(t, err, ErrInvalidPort)
	})

	t.Run("rejects an empty username", func(t *testing.T) {
		_, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData: []byte(`{"server": "localhost", "username": ""}`),
		})
		assert.ErrorIs(t, err, ErrInvalidUsername)
	})

	t.Run("rejects unknown TLS mode", func(t *testing.T) {
		_, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData: []byte(`{"server": "localhost", "tlsMode": "bogus"}`),
		})
		assert.ErrorIs(t, err, ErrInvalidTLSMode)
	})
}

func TestQueryTimeout(t *testing.T) {
	assert.Equal(t, 45*time.Second, Settings{QueryTimeout: 45}.queryTimeout())
	// 0 would otherwise hand every query an already-expired context
	assert.Equal(t, DefaultQueryTimeout*time.Second, Settings{}.queryTimeout())
	assert.Equal(t, DefaultQueryTimeout*time.Second, Settings{QueryTimeout: -1}.queryTimeout())
}

func TestGenerateDSN(t *testing.T) {
	t.Run("minimal settings", func(t *testing.T) {
		dsn := GenerateDSN(Settings{
			Server: "localhost", Port: 5432, Username: "crate", TLSMode: "disable",
		})
		assert.Equal(t, "host='localhost' port=5432 user='crate' dbname='crate' sslmode='disable'", dsn)
	})

	t.Run("never carries the password", func(t *testing.T) {
		dsn := GenerateDSN(Settings{
			Server: "db", Port: 5432, Username: "crate", TLSMode: "require",
			Password: `pa'ss w0rd`,
		})
		assert.NotContains(t, dsn, "password")
		assert.NotContains(t, dsn, "w0rd")
	})

	t.Run("timeout is appended when set", func(t *testing.T) {
		dsn := GenerateDSN(Settings{
			Server: "db", Port: 5432, Username: "crate", TLSMode: "require", Timeout: 10,
		})
		assert.Contains(t, dsn, "connect_timeout=10")
		assert.Contains(t, dsn, "sslmode='require'")
	})

	t.Run("escapes quotes and backslashes", func(t *testing.T) {
		dsn := GenerateDSN(Settings{
			Server: `cr\ate.example.org`, Port: 5432, Username: "cr'ate", TLSMode: "disable",
		})
		assert.Contains(t, dsn, `user='cr\'ate'`)
		assert.Contains(t, dsn, `host='cr\\ate.example.org'`)
	})

	t.Run("file-path TLS adds cert paths for pgx to load", func(t *testing.T) {
		dsn := GenerateDSN(Settings{
			Server: "db", Port: 5432, Username: "crate", TLSMode: "verify-full",
			TLSConfigurationMethod: "file-path",
			TLSCACertFile:          "/certs/ca.pem",
			TLSClientCertFile:      "/certs/client.pem",
			TLSClientKeyFile:       "/certs/client.key",
		})
		assert.Contains(t, dsn, "sslrootcert='/certs/ca.pem'")
		assert.Contains(t, dsn, "sslcert='/certs/client.pem'")
		assert.Contains(t, dsn, "sslkey='/certs/client.key'")
	})

	t.Run("file paths are ignored for inline (file-content) method", func(t *testing.T) {
		dsn := GenerateDSN(Settings{
			Server: "db", Port: 5432, Username: "crate", TLSMode: "verify-full",
			TLSConfigurationMethod: "file-content",
			TLSCACertFile:          "/certs/ca.pem",
		})
		assert.NotContains(t, dsn, "sslrootcert")
	})
}
