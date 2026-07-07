package plugin

import (
	"testing"

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
	})

	t.Run("password is optional (trust auth)", func(t *testing.T) {
		_, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData: []byte(`{"server": "cratedb.example.org"}`),
		})
		assert.NoError(t, err)
	})

	t.Run("accepts numbers as strings (provisioned YAML)", func(t *testing.T) {
		settings, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData: []byte(`{"server": "localhost", "port": "5433", "maxOpenConnections": "10"}`),
		})
		require.NoError(t, err)
		assert.Equal(t, int64(5433), settings.Port)
		assert.Equal(t, int64(10), settings.MaxOpenConnections)
	})

	t.Run("reads secure JSON fields", func(t *testing.T) {
		settings, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData:                []byte(`{"server": "localhost"}`),
			DecryptedSecureJSONData: map[string]string{"password": "secret"},
		})
		require.NoError(t, err)
		assert.Equal(t, "secret", settings.Password)
	})

	t.Run("rejects missing server", func(t *testing.T) {
		_, err := LoadSettings(backend.DataSourceInstanceSettings{JSONData: []byte(`{}`)})
		assert.ErrorIs(t, err, ErrorMessageInvalidServerName)
	})

	t.Run("rejects unknown TLS mode", func(t *testing.T) {
		_, err := LoadSettings(backend.DataSourceInstanceSettings{
			JSONData: []byte(`{"server": "localhost", "tlsMode": "bogus"}`),
		})
		assert.ErrorIs(t, err, ErrorMessageInvalidTLSMode)
	})
}

func TestGenerateDSN(t *testing.T) {
	t.Run("minimal settings", func(t *testing.T) {
		dsn, err := GenerateDSN(Settings{
			Server: "localhost", Port: 5432, Username: "crate", TLSMode: "disable",
		})
		require.NoError(t, err)
		assert.Equal(t, "host='localhost' port=5432 user='crate' dbname='crate' sslmode='disable'", dsn)
	})

	t.Run("password and timeout are appended when set", func(t *testing.T) {
		dsn, err := GenerateDSN(Settings{
			Server: "db", Port: 5432, Username: "crate", TLSMode: "require",
			Password: "s3cret", Timeout: 10,
		})
		require.NoError(t, err)
		assert.Contains(t, dsn, "password='s3cret'")
		assert.Contains(t, dsn, "connect_timeout=10")
		assert.Contains(t, dsn, "sslmode='require'")
	})

	t.Run("escapes quotes and backslashes", func(t *testing.T) {
		dsn, err := GenerateDSN(Settings{
			Server: "localhost", Port: 5432, Username: "cr'ate", TLSMode: "disable",
			Password: `pa\ss'wd`,
		})
		require.NoError(t, err)
		assert.Contains(t, dsn, `user='cr\'ate'`)
		assert.Contains(t, dsn, `password='pa\\ss\'wd'`)
	})
}
