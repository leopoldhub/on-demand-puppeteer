# Testing

## Summary

Fast tests cover configuration, request validation, structured logging, browser lifecycle, authentication, global operational endpoints, arbitrary HTTP/WebSocket passthrough, and discovery URL rewriting. End-to-end tests launch bundled Chrome, discover it through proxied `/json/version`, and connect Puppeteer through the rewritten URL.

## Commands

- `npm test`: unit and fake-CDP integration tests.
- `npm run test:e2e`: real browser test, including idle shutdown and profile persistence.
- `npm run test:all`: all Vitest suites.
- `npm run typecheck`: TypeScript validation.
- `npm run build`: production compilation.

The end-to-end suite needs the operating-system libraries required by bundled Chrome and permission to execute it.
