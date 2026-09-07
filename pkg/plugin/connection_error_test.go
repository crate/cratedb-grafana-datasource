package plugin

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"net"
	"os"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgproto3"
	"github.com/stretchr/testify/assert"
)

func TestClassifyError(t *testing.T) {
	t.Run("nil stays nil", func(t *testing.T) {
		assert.NoError(t, ClassifyError(nil))
	})

	t.Run("auth failures match by class prefix", func(t *testing.T) {
		orig := &pgconn.PgError{Code: "28P01", Message: "password authentication failed"}
		err := ClassifyError(orig)
		assert.Contains(t, err.Error(), "authentication failed: check the username and password")
		var pgErr *pgconn.PgError
		assert.True(t, errors.As(err, &pgErr), "original error stays in the chain")
	})

	t.Run("insufficient privilege", func(t *testing.T) {
		err := ClassifyError(&pgconn.PgError{Code: "42501", Message: "denied"})
		assert.Contains(t, err.Error(), "permission denied")
	})

	t.Run("other pg errors pass through", func(t *testing.T) {
		orig := &pgconn.PgError{Code: "42601", Message: "syntax error"}
		assert.Equal(t, error(orig), ClassifyError(orig))
	})

	t.Run("unknown certificate authority", func(t *testing.T) {
		err := ClassifyError(x509.UnknownAuthorityError{})
		assert.Contains(t, err.Error(), "TLS certificate verification failed")
	})

	t.Run("invalid certificate", func(t *testing.T) {
		err := ClassifyError(x509.CertificateInvalidError{
			Cert: &x509.Certificate{}, Reason: x509.Expired,
		})
		assert.Contains(t, err.Error(), "TLS certificate verification failed")
	})

	t.Run("certificate does not match the host", func(t *testing.T) {
		err := ClassifyError(x509.HostnameError{
			Certificate: &x509.Certificate{}, Host: "cratedb.example.org",
		})
		assert.Contains(t, err.Error(), "TLS hostname verification failed")
	})

	t.Run("plaintext server on a TLS connection", func(t *testing.T) {
		err := ClassifyError(tls.RecordHeaderError{Msg: "first record does not look like a TLS handshake"})
		assert.Contains(t, err.Error(), "TLS handshake failed")
	})

	t.Run("endpoint speaking another protocol", func(t *testing.T) {
		err := ClassifyError(&pgproto3.ExceededMaxBodyLenErr{MaxExpectedBodyLen: 1073741822, ActualBodyLen: 1414811691})
		assert.Contains(t, err.Error(), "does not speak the PostgreSQL wire protocol")
		assert.Contains(t, err.Error(), "4200")
	})

	t.Run("server declines TLS", func(t *testing.T) {
		err := ClassifyError(errors.New("tls error: server refused TLS connection"))
		assert.Contains(t, err.Error(), "refused TLS")
		assert.Contains(t, err.Error(), "ssl.psql.enabled")
	})

	t.Run("dns failure", func(t *testing.T) {
		err := ClassifyError(&net.DNSError{Err: "no such host", Name: "nowhere.invalid"})
		assert.Contains(t, err.Error(), `could not resolve host "nowhere.invalid"`)
	})

	t.Run("connection refused", func(t *testing.T) {
		err := ClassifyError(&net.OpError{Op: "dial", Err: errors.New("connection refused")})
		assert.Contains(t, err.Error(), "could not reach CrateDB")
	})

	t.Run("deadline exceeded", func(t *testing.T) {
		err := ClassifyError(context.DeadlineExceeded)
		assert.Contains(t, err.Error(), "timed out")
		assert.Contains(t, err.Error(), "raise the query timeout")
	})

	t.Run("i/o deadline reached", func(t *testing.T) {
		err := ClassifyError(os.ErrDeadlineExceeded)
		assert.Contains(t, err.Error(), "connection timed out")
	})

	t.Run("unrecognised errors pass through", func(t *testing.T) {
		orig := errors.New("boom")
		assert.Equal(t, orig, ClassifyError(orig))
	})
}

func TestMutateQueryError(t *testing.T) {
	d := &CrateDB{}

	t.Run("database errors are downstream", func(t *testing.T) {
		got := d.MutateQueryError(&pgconn.PgError{Code: "42601", Message: "syntax error"})
		assert.Equal(t, backend.ErrorSourceDownstream, got.ErrorSource())
	})

	t.Run("network errors are downstream", func(t *testing.T) {
		got := d.MutateQueryError(&net.OpError{Op: "dial", Err: errors.New("connection refused")})
		assert.Equal(t, backend.ErrorSourceDownstream, got.ErrorSource())
	})

	t.Run("cancelled queries are downstream", func(t *testing.T) {
		// not a net.Error, so only the SDK classifier catches this
		got := d.MutateQueryError(context.Canceled)
		assert.Equal(t, backend.ErrorSourceDownstream, got.ErrorSource())
	})

	t.Run("other errors default to plugin", func(t *testing.T) {
		got := d.MutateQueryError(errors.New("boom"))
		assert.Equal(t, backend.DefaultErrorSource, got.ErrorSource())
	})
}
