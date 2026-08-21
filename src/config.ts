import path from 'node:path'

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
const LOG_FORMATS = new Set(['pretty', 'json'])

export type LogFormat = 'pretty' | 'json'

export interface Config {
  host: string
  port: number
  defaultIdleTimeoutMs: number
  profileRoot: string
  headless: boolean
  logLevel: string
  logFormat: LogFormat
  authToken?: string
}

function parseInteger(name: string, value: string, minimum: number): number {
  if (!/^-?\d+$/.test(value)) throw new Error(`${name} must be an integer`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${name} must be at least ${minimum}`)
  }
  return parsed
}

function parseBoolean(name: string, value: string): boolean {
  if (value === 'true') return true
  if (value === 'false') return false
  throw new Error(`${name} must be true or false`)
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authToken = env.AUTH_TOKEN?.trim()
  const logLevel = env.LOG_LEVEL?.trim().toLowerCase() || 'info'
  if (!LOG_LEVELS.has(logLevel)) {
    throw new Error('LOG_LEVEL must be fatal, error, warn, info, debug, trace, or silent')
  }
  const logFormat = env.LOG_FORMAT?.trim().toLowerCase() || 'pretty'
  if (!LOG_FORMATS.has(logFormat)) {
    throw new Error('LOG_FORMAT must be pretty or json')
  }
  return {
    host: env.HOST?.trim() || '127.0.0.1',
    port: parseInteger('PORT', env.PORT || '9222', 0),
    defaultIdleTimeoutMs: parseInteger(
      'DEFAULT_IDLE_TIMEOUT_MS',
      env.DEFAULT_IDLE_TIMEOUT_MS || '300000',
      -1,
    ),
    profileRoot: path.resolve(env.PROFILE_ROOT?.trim() || '.browser-profiles'),
    headless: parseBoolean('HEADLESS', env.HEADLESS || 'true'),
    logLevel,
    logFormat: logFormat as LogFormat,
    authToken: authToken || undefined,
  }
}
