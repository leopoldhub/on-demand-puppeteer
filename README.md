# On-Demand Puppeteer

[![License: MIT](https://img.shields.io/badge/license-MIT-2f4858.svg)](LICENSE) [![Conception: Human](https://img.shields.io/badge/conception-human-3d6b5d.svg)](AI_USAGE.md) [![Realization: AI-heavy](https://img.shields.io/badge/realization-AI--heavy-765d69.svg)](AI_USAGE.md) [![Risk: Low](https://img.shields.io/badge/risk-low-4f6f52.svg)](AI_USAGE.md)

> See the [AI usage disclaimer](AI_USAGE.md) for details about human ownership, AI involvement, and the risk assessment.

Profile-isolated Chrome browsers, launched only when a client needs them and exposed through the standard Chrome DevTools Protocol (CDP).

On-Demand Puppeteer is a small HTTP and WebSocket reverse proxy in front of Puppeteer's bundled Chrome. It gives each named `profile` its own persistent Chrome user-data directory, reuses one browser per active profile, and closes idle browsers without deleting their state.

Use it when an application needs to connect with Puppeteer or another CDP client while keeping browser processes outside the application and preserving separate cookies, sessions, and storage between consumers.

### What It Does

- Proxies Chrome's remote-debugging HTTP and WebSocket server without interpreting CDP messages.
- Launches a browser on the first request for a profile and deduplicates concurrent launches.
- Persists cookies, local storage, and other Chrome profile state across idle shutdowns and service restarts.
- Keeps active HTTP requests and WebSocket connections from being interrupted by idle shutdown.
- Rewrites Chrome discovery URLs so clients reconnect through this service with the correct profile.
- Removes service-only query parameters and configured bearer credentials before forwarding requests to Chrome.

### What It Does Not Do

- It does not provide a higher-level browser automation, job queue, scraping, or session API.
- It does not inspect, transform, record, or authorize individual CDP commands.
- It does not provide TLS, user accounts, per-profile permissions, quotas, or network policy.
- It does not coordinate multiple service processes or containers sharing the same profile root.
- It does not delete persistent profile data when a browser becomes idle.

## Request Flow

```mermaid
flowchart TB
    Client["Puppeteer or CDP client"]

    subgraph Service["On-Demand Puppeteer"]
        direction TB
        Auth["Authenticate and validate"]
        Manager["Select profile and manage browser lifecycle"]
        Proxy["Proxy HTTP and WebSocket traffic"]

        Auth --> Manager --> Proxy
    end

    subgraph Chrome["Managed Chrome processes"]
        direction TB
        A["Profile A browser<br/>Persistent user data"]
        B["Profile B browser<br/>Persistent user data"]
    end

    Client --> Auth
    Proxy <--> A
    Proxy <--> B
```

## Quick Start

### Docker Compose

```sh
AUTH_TOKEN=replace-with-a-strong-token docker compose up -d --build
```

The service is available at `http://127.0.0.1:9222`. Browser profiles are stored in the `browser-profiles` named volume.

The Compose service grants `SYS_ADMIN` so Chrome can use its sandbox inside the container. Do not replace this by disabling Chrome's sandbox, and do not expose CDP to an untrusted network.

### Local Node.js

Requires Node.js 24 or later.

```sh
npm install
cp example.env .env
npm run build
npm start
```

Use `npm run dev` during development.

## Connect with Puppeteer

Ask Chrome for its browser WebSocket endpoint through the service, then connect to the rewritten URL:

```ts
import puppeteer from 'puppeteer'

const authorization = { Authorization: 'Bearer replace-with-your-token' }
const response = await fetch(
  'http://127.0.0.1:9222/json/version?profile=consumer-1&idleTimeout=300000',
  { headers: authorization },
)

if (!response.ok) {
  throw new Error(`Browser discovery failed: ${response.status}`)
}

const { webSocketDebuggerUrl } = await response.json()
const browser = await puppeteer.connect({
  browserWSEndpoint: webSocketDebuggerUrl,
  headers: authorization,
})
```

`profile` defaults to `default`. A profile name must contain 1-128 letters, digits, dots, underscores, or hyphens and cannot be `.` or `..`.

`idleTimeout` is measured in milliseconds. Omit it to use `DEFAULT_IDLE_TIMEOUT_MS`, or set it to `-1` to keep the browser running until service shutdown. The request that launches a browser fixes that instance's timeout; later requests reuse the existing value.

## Lifecycle

1. A client sends an authenticated HTTP request or WebSocket upgrade with a profile.
2. The service validates the request and launches Chrome if that profile has no running browser.
3. The request is proxied to Chrome's remote-debugging server. Concurrent clients for the same profile reuse the same browser.
4. Active requests and connections hold browser leases and prevent idle shutdown.
5. After the final lease is released, the launch-time idle timer begins.
6. On timeout, Chrome closes but its user-data directory remains available for the next launch.

Each running service process must have exclusive ownership of its `PROFILE_ROOT`. Multiple processes sharing one profile root are unsupported because they could launch Chrome concurrently against the same user-data directory.

## HTTP and WebSocket Passthrough

Every HTTP request and WebSocket upgrade except the two operational endpoints is profile-selected browser traffic. The browser is launched before forwarding when necessary.

| Request | Behavior |
| --- | --- |
| `GET /json/version?profile=consumer-1` | Proxies Chrome discovery and rewrites `webSocketDebuggerUrl` through this service |
| `GET /json/list?profile=consumer-1` | Lists Chrome targets with rewritten WebSocket URLs |
| `WS <discovered-path>?profile=consumer-1` | Proxies the selected Chrome browser or target WebSocket |
| `WS /cdp?profile=consumer-1` | Convenience alias for the browser-level CDP WebSocket |
| `GET /healthz` | Public liveness response; never launches a browser |
| `GET /statusz` | Public aggregate runtime counts; never exposes profile names or launches a browser |

The service removes `profile` and `idleTimeout` before forwarding requests to Chrome. When authentication is configured, it also consumes the provider `Authorization` header rather than forwarding it upstream.

## Security Model

CDP grants complete control over a browser, including access to its pages, cookies, storage, and authenticated sessions. Treat this service as privileged infrastructure.

- Set `AUTH_TOKEN` for every deployment that is not confined to a trusted private boundary.
- Put TLS and any additional access policy in a trusted reverse proxy when clients connect over a network.
- Protect `.env` and `PROFILE_ROOT`; both can contain secret-bearing data.
- Run only one service process or container against a profile root.
- Keep `/healthz` and `/statusz` public only where unauthenticated operational metadata is acceptable.
- Do not expose the service directly to the public internet.

Bearer authentication protects all browser passthrough HTTP and WebSocket traffic when `AUTH_TOKEN` is set. `/healthz` and `/statusz` intentionally remain unauthenticated. Authentication is service-wide; this project does not implement users or per-profile authorization.

## Configuration

Configuration is loaded from `.env`. See [`example.env`](example.env) for the committed template.

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `9222` | Listen port; `0` selects a free port |
| `DEFAULT_IDLE_TIMEOUT_MS` | `300000` | Launch-time idle timeout; `-1` disables idle shutdown |
| `PROFILE_ROOT` | `.browser-profiles` | Persistent Chrome profile directory |
| `HEADLESS` | `true` | Run Chrome headlessly |
| `LOG_LEVEL` | `info` | Minimum Pino log level |
| `LOG_FORMAT` | `pretty` | Output format: `pretty` or `json` |
| `AUTH_TOKEN` | unset | Optional bearer token for browser passthrough traffic |

Never commit, print, or expose `.env`. Persistent browser profiles may contain cookies and authenticated sessions and must also remain private.

## Development and Verification

```sh
npm run typecheck
npm test
npm run test:e2e
npm run build
```

`npm test` runs unit and fake-upstream integration tests. `npm run test:e2e` launches Puppeteer's bundled Chrome and requires its operating-system dependencies.

## Releases

Committing a new `package.json` version to `main` automatically verifies and builds the project, creates the `v<version>` Git tag and GitHub Release, moves the `latest` Git tag, and publishes GHCR images tagged as `v<version>`, `<version>`, and `latest`. Untagged branch commits do not publish images.

## Documentation

- [`docs/architecture.md`](docs/architecture.md): implemented architecture and request flow
- [`docs/configuration.md`](docs/configuration.md): configuration validation and defaults
- [`docs/operations.md`](docs/operations.md): health, status, persistence, scaling, and logging
- [`docs/testing.md`](docs/testing.md): test coverage and commands
- [`spec/`](spec/): target contracts and design constraints
- [`AI_USAGE.md`](AI_USAGE.md): AI involvement, human ownership, and risk assessment
- [`LICENSE`](LICENSE): MIT license
