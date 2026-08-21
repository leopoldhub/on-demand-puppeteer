# Profile Lifecycle

## Summary

Each profile shall map to a dedicated persistent Chrome user-data directory. Browser processes shall be launched lazily and reused while healthy.

## Idle Behavior

- The connection that launches a browser shall fix its idle timeout.
- A browser shall not idle out while any proxied CDP connection remains active.
- The idle countdown shall begin or restart when the final connection closes.
- A new connection shall cancel a pending idle timer.
- Timeout `-1` shall disable idle shutdown for that browser instance.
- On timeout or unexpected browser exit, the in-memory instance shall be removed without deleting profile data.
