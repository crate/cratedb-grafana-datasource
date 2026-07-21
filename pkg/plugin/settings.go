package plugin

// Adapted from the QuestDB Grafana plugin (Apache-2.0),
// https://github.com/questdb/grafana-questdb-datasource; see NOTICE.

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

const (
	DefaultPort           = 5432
	DefaultUsername       = "crate"
	DefaultSchema         = "doc"
	DefaultQueryTimeout   = 60
	DefaultSchemaCacheTTL = 60
)

// Settings holds the datasource configuration as stored by Grafana.
// Secure fields (password, TLS material) come from DecryptedSecureJSONData.
type Settings struct {
	Server   string `json:"server,omitempty"`
	Port     int64  `json:"port,omitempty"`
	Username string `json:"username,omitempty"`
	// Password is optional; CrateDB defaults to trust authentication.
	Password string `json:"-"`

	// DefaultSchema is applied as the connection's search_path (CrateDB
	// stores user tables in "doc" by default).
	DefaultSchema string `json:"defaultSchema,omitempty"`

	TLSMode                string `json:"tlsMode"`
	TLSConfigurationMethod string `json:"tlsConfigurationMethod"`
	TLSCACert              string `json:"-"`
	TLSClientCert          string `json:"-"`
	TLSClientKey           string `json:"-"`
	// File-path TLS material for TLSConfigurationMethod == "file-path". Paths
	// aren't secret, so they come from jsonData; pgx loads the files.
	TLSCACertFile     string `json:"tlsCACertFile,omitempty"`
	TLSClientCertFile string `json:"tlsClientCertFile,omitempty"`
	TLSClientKeyFile  string `json:"tlsClientKeyFile,omitempty"`

	Timeout               int64  `json:"timeout,omitempty"`
	QueryTimeout          int64  `json:"queryTimeout,omitempty"`
	MaxOpenConnections    int64  `json:"maxOpenConnections,omitempty"`
	MaxIdleConnections    int64  `json:"maxIdleConnections,omitempty"`
	MaxConnectionLifetime int64  `json:"maxConnectionLifetime,omitempty"`
	TimeInterval          string `json:"timeInterval,omitempty"`

	// RowLimit caps the rows read per query (0 = Grafana's dataproxy row_limit,
	// or unlimited when that is unset). Applied by sqlds while reading the result set.
	RowLimit int64 `json:"rowLimit,omitempty"`

	// DisableSchemaCache turns off the TTL cache in front of the
	// autocomplete introspection queries (information_schema).
	DisableSchemaCache bool `json:"disableSchemaCache,omitempty"`
	// SchemaCacheTTLSeconds is the cache lifetime (default 60).
	SchemaCacheTTLSeconds int64 `json:"schemaCacheTTLSeconds,omitempty"`
}

// queryTimeout returns the effective query timeout; a configured value of 0
// falls back to the default rather than producing an already-expired context.
func (settings Settings) queryTimeout() time.Duration {
	if settings.QueryTimeout > 0 {
		return time.Duration(settings.QueryTimeout) * time.Second
	}
	return time.Duration(DefaultQueryTimeout) * time.Second
}

func (settings *Settings) isValid() error {
	if settings.Server == "" {
		return ErrInvalidServerName
	}
	if settings.Port <= 0 {
		return ErrInvalidPort
	}
	if settings.Username == "" {
		return ErrInvalidUsername
	}
	switch settings.TLSMode {
	case "", "disable", "require", "verify-ca", "verify-full":
	default:
		return fmt.Errorf("%w: %s", ErrInvalidTLSMode, settings.TLSMode)
	}
	return nil
}

// intOption tolerates both string and float64 encodings: values arrive as
// numbers from the config UI but as strings from provisioned YAML.
func intOption(jsonData map[string]interface{}, key string, target *int64) error {
	raw, present := jsonData[key]
	if !present || raw == nil {
		return nil
	}
	switch v := raw.(type) {
	case string:
		parsed, err := strconv.ParseInt(v, 0, 64)
		if err != nil {
			return fmt.Errorf("could not parse %s value: %w", key, err)
		}
		*target = parsed
	case float64:
		*target = int64(v)
	}
	return nil
}

func stringOption(jsonData map[string]interface{}, key string, target *string) {
	if v, ok := jsonData[key].(string); ok {
		*target = v
	}
}

// LoadSettings reads and validates Settings from the datasource config.
func LoadSettings(config backend.DataSourceInstanceSettings) (Settings, error) {
	settings := Settings{
		Port:                  DefaultPort,
		Username:              DefaultUsername,
		DefaultSchema:         DefaultSchema,
		QueryTimeout:          DefaultQueryTimeout,
		SchemaCacheTTLSeconds: DefaultSchemaCacheTTL,
		TLSMode:               "disable",
	}

	var jsonData map[string]interface{}
	if err := json.Unmarshal(config.JSONData, &jsonData); err != nil {
		return settings, fmt.Errorf("%s: %w", err.Error(), ErrInvalidJSON)
	}

	stringOption(jsonData, "server", &settings.Server)
	stringOption(jsonData, "username", &settings.Username)
	stringOption(jsonData, "defaultSchema", &settings.DefaultSchema)
	stringOption(jsonData, "tlsMode", &settings.TLSMode)
	stringOption(jsonData, "tlsConfigurationMethod", &settings.TLSConfigurationMethod)
	stringOption(jsonData, "tlsCACertFile", &settings.TLSCACertFile)
	stringOption(jsonData, "tlsClientCertFile", &settings.TLSClientCertFile)
	stringOption(jsonData, "tlsClientKeyFile", &settings.TLSClientKeyFile)
	stringOption(jsonData, "timeInterval", &settings.TimeInterval)

	for key, target := range map[string]*int64{
		"port":                  &settings.Port,
		"timeout":               &settings.Timeout,
		"queryTimeout":          &settings.QueryTimeout,
		"maxOpenConnections":    &settings.MaxOpenConnections,
		"maxIdleConnections":    &settings.MaxIdleConnections,
		"maxConnectionLifetime": &settings.MaxConnectionLifetime,
		"rowLimit":              &settings.RowLimit,
		"schemaCacheTTLSeconds": &settings.SchemaCacheTTLSeconds,
	} {
		if err := intOption(jsonData, key, target); err != nil {
			return settings, err
		}
	}

	if v, ok := jsonData["disableSchemaCache"].(bool); ok {
		settings.DisableSchemaCache = v
	}

	settings.Password = config.DecryptedSecureJSONData["password"]
	settings.TLSCACert = config.DecryptedSecureJSONData["tlsCACert"]
	settings.TLSClientCert = config.DecryptedSecureJSONData["tlsClientCert"]
	settings.TLSClientKey = config.DecryptedSecureJSONData["tlsClientKey"]

	return settings, settings.isValid()
}

// GenerateDSN builds a pgx keyword/value connection string. CrateDB ignores
// dbname (schema is selected via search_path), but pgx requires one.
func GenerateDSN(settings Settings) string {
	dsn := fmt.Sprintf("host='%s' port=%d user='%s' dbname='crate' sslmode='%s'",
		escape(settings.Server), settings.Port, escape(settings.Username), settings.TLSMode)
	if settings.Password != "" {
		dsn += fmt.Sprintf(" password='%s'", escape(settings.Password))
	}
	if settings.Timeout > 0 {
		dsn += fmt.Sprintf(" connect_timeout=%d", settings.Timeout)
	}
	// file-path TLS: hand cert paths to pgx, which loads them (inline PEM is applied in configureTLS)
	if settings.TLSConfigurationMethod == "file-path" {
		if settings.TLSCACertFile != "" {
			dsn += fmt.Sprintf(" sslrootcert='%s'", escape(settings.TLSCACertFile))
		}
		if settings.TLSClientCertFile != "" {
			dsn += fmt.Sprintf(" sslcert='%s'", escape(settings.TLSClientCertFile))
		}
		if settings.TLSClientKeyFile != "" {
			dsn += fmt.Sprintf(" sslkey='%s'", escape(settings.TLSClientKeyFile))
		}
	}
	return dsn
}

// escape single quotes and backslashes in connection string parameters.
func escape(input string) string {
	return strings.NewReplacer(`\`, `\\`, `'`, `\'`).Replace(input)
}
