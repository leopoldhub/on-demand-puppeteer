# CDP API

## Summary

Every WebSocket path except the reserved operational paths shall be forwarded to the selected profile's Chrome remote-debugging server. `/cdp` shall remain a convenience alias for Chrome's browser-level CDP endpoint. The `profile` query parameter selects persistent state and defaults to `default`. The `idleTimeout` query parameter selects the launch-time idle timeout in milliseconds.

## Parameters

- `profile` shall be 1-128 letters, digits, dots, underscores, or hyphens, excluding `.` and `..`.
- Missing `profile` shall mean `default`.
- `idleTimeout` shall be `-1` or a non-negative safe integer.
- Missing `idleTimeout` shall use the configured default.
- Invalid requests shall be rejected before browser launch.

If the requested profile already has a running browser, the connection shall reuse it. A timeout supplied to a reused instance shall not alter that instance's launch-time timeout.
