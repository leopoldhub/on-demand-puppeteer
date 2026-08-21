# Target Architecture

## Summary

The service shall provide on-demand, profile-isolated Puppeteer browsers through a CDP WebSocket proxy. One service process shall coordinate one browser instance per active profile.

## Constraints

- Browser state shall persist independently for each profile.
- Concurrent first connections for one profile shall cause exactly one launch.
- CDP messages shall be proxied bidirectionally without application-level interpretation.
- A service process shall be the sole owner of its configured profile root.
- Graceful shutdown shall stop accepting work, close proxy connections, and close launched browsers.
