package plugin

// Connection flow adapted from the QuestDB Grafana plugin (Apache-2.0),
// https://github.com/questdb/grafana-questdb-datasource; see NOTICE.
// Uses pgx/v5, with TLS material injected via tls.Config rather than
// lib/pq's sslinline extension.

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/build/buildinfo"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
	"github.com/grafana/sqlds/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"golang.org/x/net/proxy"

	"github.com/crate/cratedb-grafana-datasource/pkg/converters"
	"github.com/crate/cratedb-grafana-datasource/pkg/macros"
)

// PluginID is the Grafana plugin identifier (<org>-<name>-<type>).
const PluginID = "cratedb-cratedb-datasource"

// CrateDB implements sqlds.Driver (and sqlds.Completable, in completable.go).
type CrateDB struct {
	// db is cached by Connect for the Completable introspection queries.
	db *sql.DB
	// defaultSchema is the autocomplete fallback when the frontend sends none.
	defaultSchema string
	// schemaCache fronts the introspection queries; TTL 0 disables it.
	schemaCache schemaCache
}

func getClientVersion(ctx context.Context) string {
	result := ""
	if version := backend.UserAgentFromContext(ctx).GrafanaVersion(); version != "" {
		result = fmt.Sprintf("grafana:%s;", version)
	}
	if info, err := buildinfo.GetBuildInfo(); err == nil {
		result += fmt.Sprintf("%s:%s", PluginID, info.Version)
	}
	return result
}

// Connect opens a pgx-backed *sql.DB against CrateDB's PostgreSQL port and
// caches it for the Completable introspection queries.
func (d *CrateDB) Connect(ctx context.Context, config backend.DataSourceInstanceSettings, message json.RawMessage) (*sql.DB, error) {
	logger := log.DefaultLogger.FromContext(ctx)
	settings, err := LoadSettings(config)
	if err != nil {
		logger.Debug("Invalid settings found", "error", err)
		return nil, err
	}

	db, err := d.open(ctx, config, settings)
	if err != nil {
		return nil, err
	}

	d.db = db
	d.defaultSchema = settings.DefaultSchema
	ttl := time.Duration(settings.SchemaCacheTTLSeconds) * time.Second
	if settings.DisableSchemaCache {
		ttl = 0
	}
	d.schemaCache.reset(ttl)

	logger.Debug("Connected to CrateDB", "server", settings.Server,
		"port", settings.Port, "tlsMode", settings.TLSMode)
	return db, nil
}

// open builds a pgx-backed *sql.DB from validated settings without touching the
// driver's cached state (the health check opens and closes its own).
func (d *CrateDB) open(ctx context.Context, config backend.DataSourceInstanceSettings, settings Settings) (*sql.DB, error) {
	logger := log.DefaultLogger.FromContext(ctx)

	cc, err := pgx.ParseConfig(GenerateDSN(settings))
	if err != nil {
		return nil, fmt.Errorf("could not parse connection config: %w", err)
	}

	// CrateDB selects the working schema via search_path; no per-database isolation
	cc.RuntimeParams["search_path"] = settings.DefaultSchema
	if version := getClientVersion(ctx); version != "" {
		cc.RuntimeParams["application_name"] = version
	}

	if err := configureTLS(cc, settings); err != nil {
		return nil, err
	}

	proxyClient, err := config.ProxyClient(ctx)
	if err != nil {
		logger.Error("Proxy client creation failed", "error", err)
		return nil, err
	}
	if proxyClient != nil && proxyClient.SecureSocksProxyEnabled() {
		dialer, err := proxyClient.NewSecureSocksProxyContextDialer()
		if err != nil {
			logger.Error("Secure socks proxy dialer creation failed", "error", err)
			return nil, err
		}
		contextDialer, ok := dialer.(proxy.ContextDialer)
		if !ok {
			return nil, errors.New("secure socks proxy dialer is not a context dialer")
		}
		cc.DialFunc = contextDialer.DialContext
	}

	db := stdlib.OpenDB(*cc)
	if settings.MaxOpenConnections > 0 {
		db.SetMaxOpenConns(int(settings.MaxOpenConnections))
	}
	if settings.MaxIdleConnections > 0 {
		db.SetMaxIdleConns(int(settings.MaxIdleConnections))
	}
	if settings.MaxConnectionLifetime > 0 {
		db.SetConnMaxLifetime(time.Duration(settings.MaxConnectionLifetime) * time.Second)
	}
	return db, nil
}

// PreCheckHealth backs "Save & test" with a connect + ping whose failures pass
// through ClassifyError, so the user sees an actionable message instead of a raw
// SQLSTATE. nil hands over to the regular sqlds flow.
func (d *CrateDB) PreCheckHealth(ctx context.Context, req *backend.CheckHealthRequest) *backend.CheckHealthResult {
	if req == nil || req.PluginContext.DataSourceInstanceSettings == nil {
		return nil
	}
	settings, err := LoadSettings(*req.PluginContext.DataSourceInstanceSettings)
	if err == nil {
		var db *sql.DB
		db, err = d.open(ctx, *req.PluginContext.DataSourceInstanceSettings, settings)
		if err == nil {
			pingCtx, cancel := context.WithTimeout(ctx, settings.queryTimeout())
			err = db.PingContext(pingCtx)
			cancel()
			_ = db.Close()
		}
	}
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: ClassifyError(err).Error(),
		}
	}
	return nil
}

// configureTLS injects inline PEM material from secure JSON into pgx's tls.Config
// (pgx only loads certs from files). sslmode semantics survive: require is unverified,
// verify-ca checks the CA, verify-full also the hostname.
func configureTLS(cc *pgx.ConnConfig, settings Settings) error {
	if settings.TLSMode == "disable" || settings.TLSMode == "" {
		return nil
	}
	// file-path method: pgx already loaded sslrootcert/sslcert/sslkey from the
	// DSN (see GenerateDSN); nothing to inject.
	if settings.TLSConfigurationMethod == "file-path" {
		return nil
	}
	tlsConfig := cc.TLSConfig
	if tlsConfig == nil {
		tlsConfig = &tls.Config{} //nolint:gosec // verification level is governed by sslmode
		cc.TLSConfig = tlsConfig
	}
	if settings.TLSCACert != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(settings.TLSCACert)) {
			return ErrInvalidCACertificate
		}
		tlsConfig.RootCAs = pool
	}
	if settings.TLSClientCert != "" || settings.TLSClientKey != "" {
		if settings.TLSClientCert == "" || settings.TLSClientKey == "" {
			return errors.New("TLS client certificate and key must both be specified")
		}
		cert, err := tls.X509KeyPair([]byte(settings.TLSClientCert), []byte(settings.TLSClientKey))
		if err != nil {
			return fmt.Errorf("could not load client certificate pair: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
	}
	return nil
}

// Settings returns per-datasource driver behavior for sqlds.
func (d *CrateDB) Settings(ctx context.Context, config backend.DataSourceInstanceSettings) sqlds.DriverSettings {
	timeout := Settings{}.queryTimeout()
	rowLimit := int64(0)
	if settings, err := LoadSettings(config); err == nil {
		timeout = settings.queryTimeout()
		rowLimit = settings.RowLimit
	}
	return sqlds.DriverSettings{
		Timeout:  timeout,
		FillMode: &data.FillMissing{Mode: data.FillModeNull},
		// RowLimit 0 falls through to GF_DATAPROXY_ROW_LIMIT / the Grafana
		// instance's dataproxy.row_limit (see sqlds newRowLimit).
		RowLimit: rowLimit,
	}
}

// Macros returns the CrateDB macro set; see pkg/macros.
func (d *CrateDB) Macros() sqlds.Macros {
	return macros.Macros
}

// Converters returns the CrateDB type mapping; see pkg/converters.
func (d *CrateDB) Converters() []sqlutil.Converter {
	return converters.CrateDBConverters
}
