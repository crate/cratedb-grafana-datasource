package plugin

import (
	"context"
	"errors"
	"net"
	"os"
	"syscall"
	"testing"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/jackc/pgx/v5/pgconn"
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

	t.Run("connection reset is downstream", func(t *testing.T) {
		got := d.MutateQueryError(&net.OpError{Op: "read", Err: &os.SyscallError{Syscall: "read", Err: syscall.ECONNRESET}})
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
