# Authentication and Privacy

## Summary

Bearer authentication shall be optional through environment configuration. If configured, it shall protect all browser passthrough HTTP and WebSocket traffic. Global health and status shall remain public.

## Constraints

- Authentication tokens, environment contents, browser endpoints, CDP traffic, and profile contents shall not be logged or returned.
- Global status shall expose aggregate runtime counts only and shall not disclose profile names or profile data.
- Configured provider authorization credentials shall be consumed by the provider and not forwarded to Chrome.
- CDP provides full browser control, so unauthenticated deployment shall be limited to trusted private networks.
- Persistent profile directories shall be treated as secret-bearing data.
