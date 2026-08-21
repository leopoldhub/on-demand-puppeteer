import pino, { type Logger } from 'pino'
import pretty from 'pino-pretty'
import type { LogFormat } from './config.js'

export type AppLogger = Logger

export function createLogger(
  level: string,
  format: LogFormat = 'pretty',
  destination: NodeJS.WritableStream = process.stdout,
): AppLogger {
  const options = {
    level,
    base: { service: 'on-demand-puppeteer' },
    timestamp: pino.stdTimeFunctions.isoTime,
  }

  if (format === 'json') return pino(options, destination)

  return pino(
    options,
    pretty({
      colorize: Boolean((destination as NodeJS.WriteStream).isTTY),
      destination,
      singleLine: false,
      sync: true,
      translateTime: 'SYS:standard',
    }),
  )
}

export function errorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { errorType: 'UnknownError' }

  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined
  return { errorType: error.name, ...(code ? { errorCode: code } : {}) }
}
