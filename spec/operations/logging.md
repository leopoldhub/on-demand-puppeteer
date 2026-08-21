# Logging

## Summary

The service shall emit human-readable logs to stdout by default, with structured newline-delimited JSON available through environment configuration. Both formats shall support configurable level filtering without exposing secrets or browser traffic.

## Levels

- `debug` shall cover routine requests and internal connection bookkeeping.
- `info` shall cover normal service, browser, and proxy lifecycle events.
- `warn` shall cover rejected requests and unexpected client or browser behavior.
- `error` shall cover recoverable launch, proxy, and shutdown failures.
- `fatal` shall cover service startup failure.

Logs shall not contain bearer tokens, authorization headers, CDP payloads, internal browser WebSocket endpoints, profile filesystem paths, or persistent profile contents.
