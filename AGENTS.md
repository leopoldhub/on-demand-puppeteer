# Agent Guide

## Project

On-demand Puppeteer proxies Chrome's remote-debugging HTTP and WebSocket server. A safe-slug `profile` selects an isolated persistent Chrome user-data directory. Browsers launch lazily, are reused per profile, and stop only after the final proxied request/connection closes and the launch-time idle timeout expires.

## Critical Constraints

- Never read, print, log, expose, or commit `.env` or its values. If secret contents appear anywhere, warn the user immediately.
- Never log `AUTH_TOKEN`, CDP messages, browser WebSocket endpoints, or persistent profile contents.
- Logging uses Pino on stdout, human-readable by default and JSON when configured. Use `debug` for routine request details, `info` for lifecycle events, `warn` for rejected/unexpected client behavior, `error` for recoverable operational failures, and `fatal` for startup failure.
- Treat profile data as sensitive; it can contain authenticated sessions.
- `/healthz` and `/statusz` are the only service-owned routes. They are public and must never launch a browser.
- `/statusz` may expose aggregate runtime counts but must never enumerate profile names or expose profile data.
- Every other HTTP request and WebSocket upgrade is profile-selected browser passthrough traffic and requires bearer authentication when `AUTH_TOKEN` is set.
- Provider-only `profile` and `idleTimeout` query parameters and configured bearer credentials must not be forwarded to Chrome.
- Chrome discovery responses must rewrite `webSocketDebuggerUrl` through this service and preserve the selected profile.
- The first connection that launches a profile fixes that browser instance's idle timeout. Active connections prevent idle shutdown.

## Structure

- `src/index.ts`: environment loading, Puppeteer launcher, process startup/shutdown.
- `src/config.ts`: validated environment configuration.
- `src/request-options.ts`: profile and idle-timeout parsing.
- `src/auth.ts`: optional bearer authentication.
- `src/logger.ts`: Pino construction and safe error metadata.
- `src/browser-manager.ts`: per-profile launch deduplication, leases, status, and idle lifecycle.
- `src/server.ts`: global operational endpoints and profile-selected HTTP/WebSocket passthrough.
- `tests/`: unit and fake-upstream integration tests.
- `tests/e2e/`: bundled-Chrome end-to-end tests.
- `docs/`: current implemented state.
- `spec/`: target behavior and design constraints, not implementation status.

## Commands

- `npm run dev`: run from TypeScript with reload.
- `npm run typecheck`: strict type check.
- `npm test`: unit and integration tests, excluding real-browser e2e.
- `npm run test:e2e`: real bundled-Chrome tests.
- `npm run test:all`: all tests.
- `npm run build`: compile to `dist/`.
- `npm start`: run compiled service.

Keep `README.md`, `AGENTS.md`, relevant `docs/`, `spec/`, and `example.env` synchronized with behavior changes.

Never read the `*.env` (except for `example.env`) or `.initial.prompt` files, and exclude them from all searches, read, write and grep applicable.
