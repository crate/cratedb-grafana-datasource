# Provisioning

The data source can be configured from a YAML file instead of the UI. Grafana reads
`provisioning/datasources/*.yaml` under its configuration directory (`/etc/grafana/provisioning`
in the Docker image) at startup.

While the plugin ships unsigned, the same Grafana instance also needs
`allow_loading_unsigned_plugins = cratedb-cratedb-datasource`, or the provisioned data source
resolves to nothing. See [Installation](../README.md#installation).

## Full example

Every key the plugin reads. Only `server` is required; anything left out falls back to the
plugin's own default, so a real file is usually much shorter than this one.

```yaml
apiVersion: 1

datasources:
  - name: CrateDB
    type: cratedb-cratedb-datasource
    uid: cratedb
    editable: true            # set false to lock the settings against edits in the UI
    jsonData:
      # connection
      server: cratedb.example.com     # host or load balancer, no scheme
      port: 5432                      # PostgreSQL wire port, not the HTTP port 4200
      username: crate
      defaultSchema: doc              # applied as search_path

      # TLS
      tlsMode: verify-full            # disable | require | verify-ca | verify-full
      tlsConfigurationMethod: file-path   # file-path | file-content
      tlsCACertFile: /etc/grafana/certs/ca.crt
      tlsClientCertFile: /etc/grafana/certs/client.crt
      tlsClientKeyFile: /etc/grafana/certs/client.key

      # pool and timeouts; durations in seconds
      timeout: 10                     # connect timeout; unset means no client-side limit
      queryTimeout: 60
      maxOpenConnections: 100
      maxIdleConnections: 100
      maxConnectionLifetime: 14400

      # query behaviour
      timeInterval: 1m                # lower bound for $__interval
      rowLimit: 0                     # 0 defers to Grafana's dataproxy.row_limit
      enableSecureSocksProxy: false

      # autocomplete introspection cache
      disableSchemaCache: false
      schemaCacheTTLSeconds: 60
    secureJsonData:
      password: secret
```

`secureJsonData` is encrypted by Grafana on first load and never read back out. Provisioned
secrets can also come from environment variables with Grafana's `$ENV_VAR` syntax.

## Certificates as file paths or inline PEM

`tlsConfigurationMethod` picks where the certificate material comes from. An unset method reads as
`file-content`, so a file-path deployment has to set it: the `tls*File` keys are ignored without it
and the connection runs without the certificates. Both fragments below slot into the datasource
entry above.

`file-path` points at files on the Grafana server's filesystem, readable by the Grafana process:

```yaml
    jsonData:
      tlsMode: verify-full
      tlsConfigurationMethod: file-path
      tlsCACertFile: /etc/grafana/certs/ca.crt
      tlsClientCertFile: /etc/grafana/certs/client.crt
      tlsClientKeyFile: /etc/grafana/certs/client.key
```

`file-content` carries the PEM blocks in `secureJsonData`, where Grafana encrypts them. This suits
deployments that have no writable certificate directory:

```yaml
    jsonData:
      tlsMode: verify-full
      tlsConfigurationMethod: file-content
    secureJsonData:
      password: secret
      tlsCACert: |
        -----BEGIN CERTIFICATE-----
        MIIB...
        -----END CERTIFICATE-----
      tlsClientCert: |
        -----BEGIN CERTIFICATE-----
        MIIB...
        -----END CERTIFICATE-----
      tlsClientKey: |
        -----BEGIN PRIVATE KEY-----
        MIIE...
        -----END PRIVATE KEY-----
```

An inline CA certificate is used in `require` mode as well as in the verifying modes, so a
`require` connection can still be pinned to a known CA.

## Numeric values as quoted strings

Grafana's provisioning file may quote numbers, and templating a value in from an environment
variable always produces a string. Every numeric `jsonData` key accepts either form, so
`port: 5432` and `port: "5432"` load the same way.

## The dev-stack file

`provisioning/datasources/cratedb.yaml` in this repository is the file `docker compose up` mounts
into Grafana. It configures the plugin against the compose `cratedb` service, and is a working
starting point to copy.
