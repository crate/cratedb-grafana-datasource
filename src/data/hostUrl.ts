// The config editor shows one postgres-style "Host URL" field (localhost:5432);
// the backend and provisioned datasources keep separate `server`/`port` jsonData
// keys. These helpers translate between the two shapes.

export interface HostParts {
  server?: string;
  port?: number;
}

/**
 * `host[:port]` → jsonData keys. Splits on the LAST colon so bracketed IPv6
 * works (`[::1]:5432`); a missing/non-numeric port is left unset (backend defaults 5432).
 */
export function splitHostURL(value: string): HostParts {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  // bracketed IPv6: the server is stored unbracketed
  if (trimmed.startsWith('[')) {
    const close = trimmed.indexOf(']');
    if (close === -1) {
      return { server: trimmed };
    }
    const server = trimmed.slice(1, close);
    const rest = trimmed.slice(close + 1);
    const port = rest.startsWith(':') ? parsePort(rest.slice(1)) : undefined;
    return { server: server || undefined, port };
  }

  const colon = trimmed.lastIndexOf(':');
  if (colon === -1) {
    return { server: trimmed };
  }
  // an unbracketed IPv6 address has multiple colons; treat it as all-server
  if (trimmed.indexOf(':') !== colon) {
    return { server: trimmed };
  }

  const port = parsePort(trimmed.slice(colon + 1));
  if (port === undefined) {
    return { server: trimmed };
  }
  return { server: trimmed.slice(0, colon) || undefined, port };
}

/** jsonData keys → the display value of the Host URL field */
export function joinHostURL({ server, port }: HostParts): string {
  if (!server) {
    return '';
  }
  const host = server.includes(':') ? `[${server}]` : server;
  return port ? `${host}:${port}` : host;
}

function parsePort(text: string): number | undefined {
  if (!/^\d+$/.test(text)) {
    return undefined;
  }
  const port = Number(text);
  return port > 0 && port <= 65535 ? port : undefined;
}
