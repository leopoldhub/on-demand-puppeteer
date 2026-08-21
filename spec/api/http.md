# HTTP API

## Summary

The service shall act as a transparent profile-selected passthrough except for two public global operational endpoints.

## Endpoints

- `GET /healthz` shall return minimal service health without authentication or browser launch.
- `GET /statusz` shall return global uptime and aggregate browser runtime counts without authentication or browser launch.
- Every other HTTP method and path shall select or launch the requested profile and be forwarded to Chrome's remote-debugging HTTP server.
- Provider-only `profile` and `idleTimeout` query parameters shall not be forwarded upstream.
- Chrome discovery responses shall rewrite `webSocketDebuggerUrl` through the provider and bind it to the selected profile.

Global status shall never list profile names or expose profile data. It may report aggregate running, launching, and active connection/request counts.
