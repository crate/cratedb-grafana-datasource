package plugin

// Connection flow adapted from the QuestDB Grafana plugin (Apache-2.0),
// https://github.com/questdb/grafana-questdb-datasource — see NOTICE.
// Deviations: pgx/v5 instead of lib/pq (pgx is the driver Grafana core's
// PostgreSQL datasource uses against CrateDB since Grafana 12.4), TLS
// material injected via tls.Config instead of lib/pq's sslinline extension.

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

// CrateDB implements sqlds.Driver (and sqlds.Completable, in completable.go).
type CrateDB struct {
	// db is cached by Connect for the Completable introspection queries.
	db *sql.DB
	// defaultSchema is the fallback for autocomplete when the frontend
	// doesn't send a schema.
	defaultSchema string
}

func getClientVersion(ctx context.Context) string {
	result := ""
	if version := backend.UserAgentFromContext(ctx).GrafanaVersion(); version != "" {
		result = fmt.Sprintf("grafana:%s;", version)
	}
	if info, err := buildinfo.GetBuildInfo(); err == nil {
		result += fmt.Sprintf("cratedb-cratedb-datasource:%s", info.Version)
	}
	return result
}

// Connect opens a pgx-backed *sql.DB against CrateDB's PostgreSQL port.
func (d *CrateDB) Connect(ctx context.Context, config backend.DataSourceInstanceSettings, message json.RawMessage) (*sql.DB, error) {
	settings, err := LoadSettings(config)
	if err != nil {
		log.DefaultLogger.Debug("Invalid settings found", "error", err)
		return nil, err
	}

	dsn, err := GenerateDSN(settings)
	if err != nil {
		return nil, err
	}

	cc, err := pgx.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("could not parse connection config: %w", err)
	}

	// CrateDB selects the working schema via search_path; there is no
	// per-database isolation like in PostgreSQL.
	cc.RuntimeParams["search_path"] = settings.DefaultSchema
	if version := getClientVersion(ctx); version != "" {
		cc.RuntimeParams["application_name"] = version
	}
	// SPIKE(S1): query exec mode is left at the pgx default (extended
	// protocol) — the same mode Grafana core's postgres datasource uses
	// against CrateDB since 12.4. Validate against a live cluster.

	if err := configureTLS(cc, settings); err != nil {
		return nil, err
	}

	proxyClient, err := config.ProxyClient(ctx)
	if err != nil {
		log.DefaultLogger.Error("Proxy client creation failed", "error", err)
		return nil, err
	}
	if proxyClient != nil && proxyClient.SecureSocksProxyEnabled() {
		dialer, err := proxyClient.NewSecureSocksProxyContextDialer()
		if err != nil {
			log.DefaultLogger.Error("Secure socks proxy dialer creation failed", "error", err)
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

	d.db = db
	d.defaultSchema = settings.DefaultSchema

	log.DefaultLogger.Debug("Connected to CrateDB", "server", settings.Server,
		"port", settings.Port, "tlsMode", settings.TLSMode)
	return db, nil
}

// configureTLS injects PEM material from the datasource's secure JSON into
// the tls.Config that pgx derived from the DSN's sslmode. pgx only loads
// certificates from files, so inline content must be applied here.
func configureTLS(cc *pgx.ConnConfig, settings Settings) error {
	if settings.TLSMode == "disable" || settings.TLSMode == "" {
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
			return ErrorInvalidCACertificate
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
	timeout := time.Duration(DefaultQueryTimeout) * time.Second
	if settings, err := LoadSettings(config); err == nil && settings.QueryTimeout > 0 {
		timeout = time.Duration(settings.QueryTimeout) * time.Second
	}
	return sqlds.DriverSettings{
		Timeout:  timeout,
		FillMode: &data.FillMissing{Mode: data.FillModeNull},
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
