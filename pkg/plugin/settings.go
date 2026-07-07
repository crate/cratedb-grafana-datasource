package plugin

// Adapted from the QuestDB Grafana plugin (Apache-2.0),
// https://github.com/questdb/grafana-questdb-datasource — see NOTICE.

import (
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

const (
	DefaultPort         = 5432
	DefaultUsername     = "crate"
	DefaultSchema       = "doc"
	DefaultQueryTimeout = 60
)

// Settings holds the datasource configuration as stored by Grafana.
// Secure fields (password, TLS material) come from DecryptedSecureJSONData.
type Settings struct {
	Server   string `json:"server,omitempty"`
	Port     int64  `json:"port,omitempty"`
	Username string `json:"username,omitempty"`
	// Password is optional: CrateDB defaults to trust authentication
	// (e.g. the official Docker image), unlike most PostgreSQL setups.
	Password string `json:"-"`

	// DefaultSchema is applied as the connection's search_path. CrateDB
	// stores user tables in "doc" by default; "sys" holds cluster state.
	DefaultSchema string `json:"defaultSchema,omitempty"`

	TLSMode                string `json:"tlsMode"`
	TLSConfigurationMethod string `json:"tlsConfigurationMethod"`
	TLSCACert              string `json:"-"`
	TLSClientCert          string `json:"-"`
	TLSClientKey           string `json:"-"`

	Timeout                int64  `json:"timeout,omitempty"`
	QueryTimeout           int64  `json:"queryTimeout,omitempty"`
	MaxOpenConnections     int64  `json:"maxOpenConnections,omitempty"`
	MaxIdleConnections     int64  `json:"maxIdleConnections,omitempty"`
	MaxConnectionLifetime  int64  `json:"maxConnectionLifetime,omitempty"`
	TimeInterval           string `json:"timeInterval,omitempty"`
	EnableSecureSocksProxy bool   `json:"enableSecureSocksProxy,omitempty"`
}

func (settings *Settings) isValid() error {
	if settings.Server == "" {
		return ErrorMessageInvalidServerName
	}
	if settings.Port <= 0 {
		return ErrorMessageInvalidPort
	}
	if settings.Username == "" {
		return ErrorMessageInvalidUserName
	}
	switch settings.TLSMode {
	case "", "disable", "require", "verify-ca", "verify-full":
	default:
		return fmt.Errorf("%w: %s", ErrorMessageInvalidTLSMode, settings.TLSMode)
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
		Port:          DefaultPort,
		Username:      DefaultUsername,
		DefaultSchema: DefaultSchema,
		QueryTimeout:  DefaultQueryTimeout,
		TLSMode:       "disable",
	}

	var jsonData map[string]interface{}
	if err := json.Unmarshal(config.JSONData, &jsonData); err != nil {
		return settings, fmt.Errorf("%s: %w", err.Error(), ErrorMessageInvalidJSON)
	}

	stringOption(jsonData, "server", &settings.Server)
	stringOption(jsonData, "username", &settings.Username)
	stringOption(jsonData, "defaultSchema", &settings.DefaultSchema)
	stringOption(jsonData, "tlsMode", &settings.TLSMode)
	stringOption(jsonData, "tlsConfigurationMethod", &settings.TLSConfigurationMethod)
	stringOption(jsonData, "timeInterval", &settings.TimeInterval)

	for key, target := range map[string]*int64{
		"port":                  &settings.Port,
		"timeout":               &settings.Timeout,
		"queryTimeout":          &settings.QueryTimeout,
		"maxOpenConnections":    &settings.MaxOpenConnections,
		"maxIdleConnections":    &settings.MaxIdleConnections,
		"maxConnectionLifetime": &settings.MaxConnectionLifetime,
	} {
		if err := intOption(jsonData, key, target); err != nil {
			return settings, err
		}
	}

	if v, ok := jsonData["enableSecureSocksProxy"].(bool); ok {
		settings.EnableSecureSocksProxy = v
	}

	settings.Password = config.DecryptedSecureJSONData["password"]
	settings.TLSCACert = config.DecryptedSecureJSONData["tlsCACert"]
	settings.TLSClientCert = config.DecryptedSecureJSONData["tlsClientCert"]
	settings.TLSClientKey = config.DecryptedSecureJSONData["tlsClientKey"]

	return settings, settings.isValid()
}

// GenerateDSN builds a pgx keyword/value connection string.
// CrateDB ignores the database name on the wire protocol (schemas are
// selected via search_path, applied in Connect), but pgx requires one.
func GenerateDSN(settings Settings) (string, error) {
	dsn := fmt.Sprintf("host='%s' port=%d user='%s' dbname='crate' sslmode='%s'",
		escape(settings.Server), settings.Port, escape(settings.Username), settings.TLSMode)
	if settings.Password != "" {
		dsn += fmt.Sprintf(" password='%s'", escape(settings.Password))
	}
	if settings.Timeout > 0 {
		dsn += fmt.Sprintf(" connect_timeout=%d", settings.Timeout)
	}
	return dsn, nil
}

// escape single quotes and backslashes in connection string parameters.
func escape(input string) string {
	out := ""
	for _, r := range input {
		if r == '\\' || r == '\'' {
			out += "\\"
		}
		out += string(r)
	}
	return out
}
