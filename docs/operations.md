# Operations

## Summary

Use `/healthz` for unauthenticated liveness checks and `/statusz` for aggregate runtime status. Stop the process with `SIGINT` or `SIGTERM` for graceful server and browser shutdown.

## Status

`/statusz` reports uptime, running and launching browser counts, active proxied connection/request count, and shutdown state. It does not list profile names or expose profile data.

Both operational endpoints are public and do not launch a browser. `/healthz` returns only `{ "status": "ok" }`. All other paths are browser passthrough and require the configured bearer token when authentication is enabled.

## Persistence and Scaling

Chrome user-data directories survive browser idle shutdown and service restarts. Back up and protect the configured profile root as sensitive data.

Run only one service process against a profile root. Put TLS and any additional network policy in a trusted reverse proxy when serving remote consumers.

The provided Compose service persists profiles in the `browser-profiles` named volume and grants `SYS_ADMIN` so Chrome can use its sandbox inside the container. The container listens on all container interfaces, but Compose publishes it on the host loopback interface by default. Keep the profile volume private and do not run multiple service containers against it.

## Releases

A new version committed in `package.json` on `main` triggers the GitHub Actions release workflow. After typechecking, testing, and building, it creates the matching `v<version>` Git tag and GitHub Release, moves the `latest` Git tag to that release, uploads the compiled archive, and publishes GHCR images tagged with `v<version>`, `<version>`, and `latest`.

Branch commits without a new version never publish a Docker image. The immutable version tag is never moved, while the mutable `latest` Git and Docker tags always identify the newest successful release. Deployments can use `latest`, but should pin an explicit version when reproducibility is required.

## Logging

Pino emits human-readable stdout logs by default. Set `LOG_FORMAT=json` to emit newline-delimited structured JSON for collection by a process supervisor or container runtime. Pretty output uses colors only when stdout is an interactive terminal. `info` records service and browser lifecycle, `debug` records routine requests and connection bookkeeping, `warn` records rejected requests and unexpected client/browser behavior, and `error` or `fatal` records operational and startup failures.

Logs may identify a requested safe-slug profile for diagnosis. They do not include authentication material, CDP messages, browser endpoints, profile paths, or stored browser data.
