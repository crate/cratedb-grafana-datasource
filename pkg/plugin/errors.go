package plugin

import "errors"

var (
	ErrInvalidJSON          = errors.New("could not parse json")
	ErrInvalidServerName    = errors.New("invalid server name: must not be empty")
	ErrInvalidPort          = errors.New("invalid port")
	ErrInvalidUsername      = errors.New("username must not be empty")
	ErrInvalidTLSMode       = errors.New("invalid TLS mode")
	ErrInvalidCACertificate = errors.New("invalid CA certificate")
	ErrNotConnected         = errors.New("datasource is not connected yet")
)
