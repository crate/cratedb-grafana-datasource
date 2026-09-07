package plugin

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"database/sql"
	"database/sql/driver"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type certAuthority struct {
	pem  string
	cert *x509.Certificate
	key  *ecdsa.PrivateKey
}

func newCertAuthority(t *testing.T, name string) certAuthority {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: name},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	require.NoError(t, err)
	cert, err := x509.ParseCertificate(der)
	require.NoError(t, err)
	return certAuthority{pem: encodePEM(t, "CERTIFICATE", der), cert: cert, key: key}
}

// issue returns the DER of a leaf certificate signed by the authority.
func (ca certAuthority) issue(t *testing.T, name string) []byte {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	template := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: name},
		DNSNames:     []string{name},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca.cert, &key.PublicKey, ca.key)
	require.NoError(t, err)
	return der
}

// issuePair returns a client certificate and its key, both PEM encoded.
func (ca certAuthority) issuePair(t *testing.T, name string) (string, string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	template := &x509.Certificate{
		SerialNumber: big.NewInt(3),
		Subject:      pkix.Name{CommonName: name},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca.cert, &key.PublicKey, ca.key)
	require.NoError(t, err)
	keyDER, err := x509.MarshalECPrivateKey(key)
	require.NoError(t, err)
	return encodePEM(t, "CERTIFICATE", der), encodePEM(t, "EC PRIVATE KEY", keyDER)
}

func encodePEM(t *testing.T, blockType string, der []byte) string {
	t.Helper()
	return string(pem.EncodeToMemory(&pem.Block{Type: blockType, Bytes: der}))
}

// parsedConfig runs the settings through the DSN and pgx, so the tls.Config under
// test is the one pgx derived from sslmode.
func parsedConfig(t *testing.T, settings Settings) *pgx.ConnConfig {
	t.Helper()
	cc, err := pgx.ParseConfig(GenerateDSN(settings))
	require.NoError(t, err)
	return cc
}

func TestConfigureTLS(t *testing.T) {
	ca := newCertAuthority(t, "crate-ca")
	clientCert, clientKey := ca.issuePair(t, "grafana")
	base := Settings{Server: "cratedb.example.org", Port: 5432, Username: "crate"}

	t.Run("disable leaves the connection plaintext", func(t *testing.T) {
		settings := base
		settings.TLSMode = "disable"
		settings.TLSCACert = ca.pem
		cc := parsedConfig(t, settings)
		require.NoError(t, configureTLS(cc, settings))
		assert.Nil(t, cc.TLSConfig)
	})

	t.Run("require without a CA skips verification", func(t *testing.T) {
		settings := base
		settings.TLSMode = "require"
		cc := parsedConfig(t, settings)
		require.NoError(t, configureTLS(cc, settings))
		require.NotNil(t, cc.TLSConfig)
		assert.True(t, cc.TLSConfig.InsecureSkipVerify)
		assert.Nil(t, cc.TLSConfig.RootCAs)
		assert.Nil(t, cc.TLSConfig.VerifyPeerCertificate)
	})

	t.Run("require with an inline CA verifies the chain", func(t *testing.T) {
		settings := base
		settings.TLSMode = "require"
		settings.TLSCACert = ca.pem
		cc := parsedConfig(t, settings)
		require.NoError(t, configureTLS(cc, settings))
		require.NotNil(t, cc.TLSConfig)
		assert.True(t, cc.TLSConfig.InsecureSkipVerify)
		assert.NotNil(t, cc.TLSConfig.RootCAs)
		require.NotNil(t, cc.TLSConfig.VerifyPeerCertificate)

		assert.NoError(t, cc.TLSConfig.VerifyPeerCertificate([][]byte{ca.issue(t, "cratedb.example.org")}, nil))
		// a chain the configured CA did not sign is rejected
		other := newCertAuthority(t, "other-ca")
		assert.Error(t, cc.TLSConfig.VerifyPeerCertificate([][]byte{other.issue(t, "cratedb.example.org")}, nil))
		// the hostname is not part of the check
		assert.NoError(t, cc.TLSConfig.VerifyPeerCertificate([][]byte{ca.issue(t, "elsewhere.invalid")}, nil))
	})

	t.Run("verify-ca checks the chain without the hostname", func(t *testing.T) {
		settings := base
		settings.TLSMode = "verify-ca"
		settings.TLSCACert = ca.pem
		cc := parsedConfig(t, settings)
		require.NoError(t, configureTLS(cc, settings))
		require.NotNil(t, cc.TLSConfig)
		assert.True(t, cc.TLSConfig.InsecureSkipVerify)
		assert.NotNil(t, cc.TLSConfig.RootCAs)
		require.NotNil(t, cc.TLSConfig.VerifyPeerCertificate)
		assert.NoError(t, cc.TLSConfig.VerifyPeerCertificate([][]byte{ca.issue(t, "elsewhere.invalid")}, nil))
	})

	t.Run("verify-full checks the hostname against the server address", func(t *testing.T) {
		settings := base
		settings.TLSMode = "verify-full"
		settings.TLSCACert = ca.pem
		cc := parsedConfig(t, settings)
		require.NoError(t, configureTLS(cc, settings))
		require.NotNil(t, cc.TLSConfig)
		assert.False(t, cc.TLSConfig.InsecureSkipVerify)
		assert.Nil(t, cc.TLSConfig.VerifyPeerCertificate)
		assert.Equal(t, "cratedb.example.org", cc.TLSConfig.ServerName)
		assert.NotNil(t, cc.TLSConfig.RootCAs)
	})

	t.Run("client certificate pair is loaded", func(t *testing.T) {
		settings := base
		settings.TLSMode = "verify-full"
		settings.TLSCACert = ca.pem
		settings.TLSClientCert = clientCert
		settings.TLSClientKey = clientKey
		cc := parsedConfig(t, settings)
		require.NoError(t, configureTLS(cc, settings))
		require.Len(t, cc.TLSConfig.Certificates, 1)
	})

	t.Run("rejects a client certificate without its key", func(t *testing.T) {
		settings := base
		settings.TLSMode = "require"
		settings.TLSClientCert = clientCert
		cc := parsedConfig(t, settings)
		assert.ErrorContains(t, configureTLS(cc, settings), "must both be specified")
	})

	t.Run("rejects an unparsable CA certificate", func(t *testing.T) {
		settings := base
		settings.TLSMode = "verify-ca"
		settings.TLSCACert = "not a certificate"
		cc := parsedConfig(t, settings)
		assert.ErrorIs(t, configureTLS(cc, settings), ErrInvalidCACertificate)
	})

	t.Run("rejects an unparsable client certificate", func(t *testing.T) {
		settings := base
		settings.TLSMode = "require"
		settings.TLSClientCert = "not a certificate"
		settings.TLSClientKey = clientKey
		cc := parsedConfig(t, settings)
		assert.ErrorContains(t, configureTLS(cc, settings), "could not load client certificate pair")
	})

	t.Run("file-path material is left to pgx", func(t *testing.T) {
		settings := base
		settings.TLSMode = "verify-full"
		settings.TLSConfigurationMethod = "file-path"
		settings.TLSCACert = "not a certificate"
		cc := parsedConfig(t, settings)
		require.NoError(t, configureTLS(cc, settings))
		assert.Nil(t, cc.TLSConfig.RootCAs)
	})
}

func TestOpenKeepsThePasswordOutOfErrors(t *testing.T) {
	// pgx's redaction of the connection string it echoes stops at the escaped
	// quote, so this password is the one whose tail leaks
	const password = `pa'ss w0rd`
	settings := Settings{
		Server: "cratedb.example.org", Port: 5432, Username: "crate", TLSMode: "verify-ca",
		TLSConfigurationMethod: "file-path",
		TLSCACertFile:          filepath.Join(t.TempDir(), "absent-ca.pem"),
		Password:               password,
	}

	_, err := (&CrateDB{}).open(context.Background(), backend.DataSourceInstanceSettings{}, settings)
	require.Error(t, err)
	assert.NotContains(t, err.Error(), password)
	assert.NotContains(t, err.Error(), "w0rd")
	assert.NotContains(t, err.Error(), "password")
}

func TestOpenAppliesTheConnectionPoolLimit(t *testing.T) {
	openWith := func(t *testing.T, jsonData string) *sql.DB {
		t.Helper()
		config := backend.DataSourceInstanceSettings{JSONData: []byte(jsonData)}
		settings, err := LoadSettings(config)
		require.NoError(t, err)
		db, err := (&CrateDB{}).open(context.Background(), config, settings)
		require.NoError(t, err)
		t.Cleanup(func() { _ = db.Close() })
		return db
	}

	t.Run("defaults when unset", func(t *testing.T) {
		db := openWith(t, `{"server": "cratedb.example.org"}`)
		assert.Equal(t, DefaultMaxOpenConnections, db.Stats().MaxOpenConnections)
	})

	t.Run("explicit value wins", func(t *testing.T) {
		db := openWith(t, `{"server": "cratedb.example.org", "maxOpenConnections": 7}`)
		assert.Equal(t, 7, db.Stats().MaxOpenConnections)
	})
}

type stubDriver struct{}

func (stubDriver) Open(string) (driver.Conn, error) { return nil, errors.New("use the connector") }

type stubConnector struct{ conn *stubConn }

func (c stubConnector) Connect(context.Context) (driver.Conn, error) { return c.conn, nil }
func (c stubConnector) Driver() driver.Driver                        { return stubDriver{} }

// stubConn records the deadline of the context each query is issued with.
type stubConn struct {
	mu          sync.Mutex
	columns     []string
	deadline    time.Time
	hasDeadline bool
}

func (c *stubConn) Prepare(string) (driver.Stmt, error) { return nil, errors.New("not supported") }
func (c *stubConn) Close() error                        { return nil }
func (c *stubConn) Begin() (driver.Tx, error)           { return nil, errors.New("not supported") }

func (c *stubConn) QueryContext(ctx context.Context, _ string, _ []driver.NamedValue) (driver.Rows, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.deadline, c.hasDeadline = ctx.Deadline()
	return &stubRows{columns: c.columns}, nil
}

func (c *stubConn) recorded() (time.Time, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.deadline, c.hasDeadline
}

type stubRows struct{ columns []string }

func (r *stubRows) Columns() []string         { return r.columns }
func (r *stubRows) Close() error              { return nil }
func (r *stubRows) Next([]driver.Value) error { return io.EOF }

func TestIntrospectionQueriesCarryTheQueryTimeout(t *testing.T) {
	const timeout = 25 * time.Second

	newDriver := func(columns ...string) (*CrateDB, *stubConn) {
		conn := &stubConn{columns: columns}
		return &CrateDB{
			db:                   sql.OpenDB(stubConnector{conn: conn}),
			defaultSchema:        "doc",
			introspectionTimeout: timeout,
		}, conn
	}

	assertDeadline := func(t *testing.T, conn *stubConn) {
		t.Helper()
		deadline, ok := conn.recorded()
		require.True(t, ok, "introspection query ran without a deadline")
		assert.WithinDuration(t, time.Now().Add(timeout), deadline, 5*time.Second)
	}

	t.Run("autocomplete", func(t *testing.T) {
		d, conn := newDriver("schema_name")
		_, err := d.Schemas(context.Background(), nil)
		require.NoError(t, err)
		assertDeadline(t, conn)
	})

	t.Run("ad-hoc keys", func(t *testing.T) {
		d, conn := newDriver("key")
		_, err := d.AdHocKeys(context.Background(), "doc")
		require.NoError(t, err)
		assertDeadline(t, conn)
	})

	t.Run("column meta", func(t *testing.T) {
		d, conn := newDriver("column_name", "data_type")
		_, err := d.ColumnMeta(context.Background(), "doc", "metrics")
		require.NoError(t, err)
		assertDeadline(t, conn)
	})
}
