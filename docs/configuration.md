# Configuration

## Summary

The service loads `.env` through `dotenv`, applies defaults, and rejects invalid values during startup. The committed `example.env` is the configuration template.

## Values

- `HOST`: listen address, default `127.0.0.1`.
- `PORT`: integer from `0` upward, default `9222`.
- `DEFAULT_IDLE_TIMEOUT_MS`: integer `-1` or greater, default `300000`.
- `PROFILE_ROOT`: persistent profile root, resolved to an absolute path.
- `HEADLESS`: exactly `true` or `false`.
- `LOG_LEVEL`: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, or `silent`; default `info`.
- `LOG_FORMAT`: `pretty` or `json`; default `pretty`.
- `AUTH_TOKEN`: optional non-empty bearer token after trimming.

`.env` and profile data are private runtime inputs. The application does not return their values from HTTP endpoints.
