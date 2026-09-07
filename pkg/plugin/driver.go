// Package plugin implements the CrateDB sqlds driver: the pgx connection and its
// TLS configuration, the information_schema introspection behind the autocomplete
// and ad-hoc resource routes, and connection-error classification.
package plugin

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/backend/useragent"
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
	// mu guards the fields below: Connect writes them while resource-route
	// handlers read them on other goroutines.
	mu sync.RWMutex
	// db is cached by Connect for the Completable introspection queries.
	db *sql.DB
	// defaultSchema is the autocomplete fallback when the frontend sends none.
	defaultSchema string
	// introspectionTimeout bounds the introspection queries, which run outside
	// the sqlds query path and the timeout it applies.
	introspectionTimeout time.Duration
	// schemaCache fronts the introspection queries; TTL 0 disables it.
	schemaCache schemaCache
}

func (d *CrateDB) conn() *sql.DB {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.db
}

func (d *CrateDB) schema() string {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.defaultSchema
}

func (d *CrateDB) timeout() time.Duration {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.introspectionTimeout
}

func getClientVersion(ctx context.Context) string {
	result := ""
	if version := useragent.FromContext(ctx).GrafanaVersion(); version != "" {
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

	d.mu.Lock()
	d.db = db
	d.defaultSchema = settings.DefaultSchema
	d.introspectionTimeout = settings.queryTimeout()
	d.mu.Unlock()
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
	cc.Password = settings.Password

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
	db.SetMaxOpenConns(int(settings.MaxOpenConnections))
	db.SetMaxIdleConns(int(settings.MaxIdleConnections))
	db.SetConnMaxLifetime(time.Duration(settings.MaxConnectionLifetime) * time.Second)
	return db, nil
}

// PreCheckHealth backs "Save & test" with a connect + ping whose failures pass
// through ClassifyError, so the user sees an actionable message instead of a raw
// SQLSTATE. nil hands over to the regular sqlds flow.
func (d *CrateDB) PreCheckHealth(ctx context.Context, req *backend.CheckHealthRequest) *backend.CheckHealthResult {
	if req == nil || req.PluginContext.DataSourceInstanceSettings == nil {
		return nil
	}
	unhealthy := func(err error) *backend.CheckHealthResult {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: ClassifyError(err).Error(),
		}
	}

	settings, err := LoadSettings(*req.PluginContext.DataSourceInstanceSettings)
	if err != nil {
		return unhealthy(err)
	}
	db, err := d.open(ctx, *req.PluginContext.DataSourceInstanceSettings, settings)
	if err != nil {
		return unhealthy(err)
	}
	defer func() { _ = db.Close() }()

	pingCtx, cancel := context.WithTimeout(ctx, settings.queryTimeout())
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		return unhealthy(err)
	}
	return nil
}

// configureTLS injects inline PEM material from secure JSON into pgx's tls.Config
// (pgx only loads certs from files). sslmode semantics survive: require is unverified
// unless a CA is configured, which libpq reads as verify-ca; verify-ca checks the CA,
// verify-full also the hostname.
func configureTLS(cc *pgx.ConnConfig, settings Settings) error {
	if settings.TLSMode == "disable" {
		return nil
	}
	// file-path method: pgx already loaded sslrootcert/sslcert/sslkey from the
	// DSN (see GenerateDSN); nothing to inject.
	if settings.TLSConfigurationMethod == "file-path" {
		return nil
	}
	// a client cert without its key (or vice versa) is unusable; reject it before
	// touching the tls.Config
	if (settings.TLSClientCert == "") != (settings.TLSClientKey == "") {
		return errors.New("TLS client certificate and key must both be specified")
	}
	var pool *x509.CertPool
	if settings.TLSCACert != "" {
		pool = x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(settings.TLSCACert)) {
			return ErrInvalidCACertificate
		}
	}
	var clientCert *tls.Certificate
	if settings.TLSClientCert != "" {
		pair, err := tls.X509KeyPair([]byte(settings.TLSClientCert), []byte(settings.TLSClientKey))
		if err != nil {
			return fmt.Errorf("could not load client certificate pair: %w", err)
		}
		clientCert = &pair
	}
	if cc.TLSConfig == nil {
		cc.TLSConfig = &tls.Config{} //nolint:gosec // verification level is governed by sslmode
	}
	// pgx derives one tls.Config per host of a comma-separated server list, the
	// first on the config and the rest on its fallbacks.
	tlsConfigs := []*tls.Config{cc.TLSConfig}
	for _, fallback := range cc.Fallbacks {
		if fallback.TLSConfig != nil {
			tlsConfigs = append(tlsConfigs, fallback.TLSConfig)
		}
	}
	for _, tlsConfig := range tlsConfigs {
		if pool != nil {
			tlsConfig.RootCAs = pool
			if settings.TLSMode == "require" {
				tlsConfig.VerifyPeerCertificate = verifyChainOnly(tlsConfig)
			}
		}
		if clientCert != nil {
			tlsConfig.Certificates = []tls.Certificate{*clientCert}
		}
	}
	return nil
}

// verifyChainOnly checks the server chain against tlsConfig.RootCAs and skips
// hostname verification, the check pgx installs for sslmode=verify-ca.
func verifyChainOnly(tlsConfig *tls.Config) func([][]byte, [][]*x509.Certificate) error {
	return func(certificates [][]byte, _ [][]*x509.Certificate) error {
		certs := make([]*x509.Certificate, len(certificates))
		for i, asn1Data := range certificates {
			cert, err := x509.ParseCertificate(asn1Data)
			if err != nil {
				return fmt.Errorf("could not parse certificate from server: %w", err)
			}
			certs[i] = cert
		}
		opts := x509.VerifyOptions{
			Roots:         tlsConfig.RootCAs,
			Intermediates: x509.NewCertPool(),
		}
		for _, cert := range certs[1:] {
			opts.Intermediates.AddCert(cert)
		}
		_, err := certs[0].Verify(opts)
		return err
	}
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
