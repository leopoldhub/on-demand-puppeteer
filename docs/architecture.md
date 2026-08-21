# Architecture

## Summary

The service is one Node.js process containing an HTTP/WebSocket reverse proxy and in-memory profile registry. Puppeteer launches one Chrome browser per active profile and stores its data beneath the configured profile root.

## Request Flow

1. A client makes any HTTP request or WebSocket upgrade other than `/healthz` or `/statusz`, with optional `profile` and `idleTimeout` query parameters.
2. The request is authenticated when a token is configured and its parameters are validated.
3. The browser manager reuses the profile's browser or serializes a new launch.
4. The server forwards the request to Chrome's remote-debugging HTTP server or requested WebSocket path.
5. Provider query parameters and configured authorization are removed before forwarding.
6. Chrome discovery WebSocket URLs are rewritten through the service with the selected profile.
7. Completing the final request or closing the final connection starts the browser's launch-time idle timer.

## Components

`config.ts` validates configuration. `request-options.ts` prevents unsafe profile paths. `browser-manager.ts` owns browser lifecycle and status. `server.ts` owns HTTP and WebSocket transport. `index.ts` wires these components to bundled Puppeteer.

The registry is intentionally process-local. Multiple service processes sharing one profile root are unsupported because they could launch Chrome concurrently against the same user-data directory.
