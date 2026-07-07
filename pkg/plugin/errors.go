package plugin

import "errors"

var (
	ErrorMessageInvalidJSON       = errors.New("could not parse json")
	ErrorMessageInvalidServerName = errors.New("invalid server name: must not be empty")
	ErrorMessageInvalidPort       = errors.New("invalid port")
	ErrorMessageInvalidUserName   = errors.New("username must not be empty")
	ErrorMessageInvalidTLSMode    = errors.New("invalid TLS mode")
	ErrorInvalidCACertificate     = errors.New("invalid CA certificate")
	ErrorNotConnected             = errors.New("datasource is not connected yet")
)
