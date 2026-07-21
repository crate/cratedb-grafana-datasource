package plugin

// Connection error classification: raw pgx/network errors are precise but unhelpful
// on the config page. ClassifyError prefixes the category and likely fix;
// MutateQueryError tags the source so Grafana attributes downstream failures right.

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/jackc/pgx/v5/pgconn"
)

// SQLSTATE values from CrateDB's wire protocol: a two-char class prefix for
// authentication failures, a full code for missing privileges.
const (
	pgClassAuth            = "28" // invalid_authorization_specification, invalid_password
	pgCodeInsufficientPriv = "42501"
)

// ClassifyError wraps err with an actionable, category-prefixed message.
func ClassifyError(err error) error {
	if err == nil {
		return nil
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch {
		case len(pgErr.Code) >= 2 && pgErr.Code[:2] == pgClassAuth:
			return fmt.Errorf("authentication failed: check the username and password (CrateDB reported %s): %w", pgErr.Code, err)
		case pgErr.Code == pgCodeInsufficientPriv:
			return fmt.Errorf("permission denied: the CrateDB user lacks privileges for this operation: %w", err)
		}
		return err
	}

	var x509Unknown x509.UnknownAuthorityError
	var x509Hostname x509.HostnameError
	var x509Invalid x509.CertificateInvalidError
	var tlsRecord tls.RecordHeaderError
	switch {
	case errors.As(err, &x509Unknown), errors.As(err, &x509Invalid):
		return fmt.Errorf("TLS certificate verification failed: the server certificate is not signed by the configured CA; check 'TLS/SSL Root Certificate' or use TLS mode 'require': %w", err)
	case errors.As(err, &x509Hostname):
		return fmt.Errorf("TLS hostname verification failed: the certificate does not match the server address; check the address or use TLS mode 'verify-ca': %w", err)
	case errors.As(err, &tlsRecord):
		return fmt.Errorf("TLS handshake failed: the server does not appear to speak TLS on this port; check that SSL is enabled on CrateDB or set TLS mode 'disable': %w", err)
	}

	var dnsErr *net.DNSError
	if errors.As(err, &dnsErr) {
		return fmt.Errorf("could not resolve host %q: check the server address: %w", dnsErr.Name, err)
	}

	// context.DeadlineExceeded also implements net.Error, so check it first; it fires
	// on both a slow query and a stalled connect, so the message covers both
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("connection or query timed out; check the server address, port, and network path (firewalls, security groups) if CrateDB should be reachable, otherwise raise the query timeout in the datasource settings: %w", err)
	}

	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return fmt.Errorf("connection timed out: check the server address, port, and network path (firewalls, security groups): %w", err)
	}

	var opErr *net.OpError
	if errors.As(err, &opErr) {
		return fmt.Errorf("could not reach CrateDB at the configured address and port; check that the server is running and the PostgreSQL port (default 5432) is exposed: %w", err)
	}

	return err
}

// MutateQueryError implements sqlds.QueryErrorMutator: a failure is downstream
// when it's a PgError or network-layer error, or when the SDK flags it as such
// (which also covers cancellation, deadline, DNS and TLS).
func (d *CrateDB) MutateQueryError(err error) backend.ErrorWithSource {
	classified := ClassifyError(err)

	var pgErr *pgconn.PgError
	var netErr net.Error
	var opErr *net.OpError
	if errors.As(err, &pgErr) || errors.As(err, &netErr) || errors.As(err, &opErr) || backend.IsDownstreamHTTPError(err) {
		return backend.NewErrorWithSource(classified, backend.ErrorSourceDownstream)
	}
	return backend.NewErrorWithSource(classified, backend.DefaultErrorSource)
}
