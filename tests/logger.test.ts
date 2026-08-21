import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createLogger, errorDetails } from '../src/logger.js'

function captureLogger(level: string, format: 'pretty' | 'json') {
  const output = new PassThrough()
  let content = ''
  output.on('data', (chunk) => {
    content += chunk.toString()
  })
  return {
    logger: createLogger(level, format, output),
    content: () => content,
  }
}

describe('logging', () => {
  it('filters records according to the configured level', () => {
    const captured = captureLogger('info', 'json')
    captured.logger.debug({ event: 'hidden' }, 'hidden')
    captured.logger.info({ event: 'visible' }, 'visible')
    const records = captured.content().trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(records).toEqual([expect.objectContaining({ level: 30, event: 'visible', msg: 'visible' })])
  })

  it('writes human-readable logs in pretty mode', () => {
    const captured = captureLogger('info', 'pretty')
    captured.logger.info({ event: 'service_started', port: 9222 }, 'Service started')
    expect(captured.content()).toContain('INFO')
    expect(captured.content()).toContain('Service started')
    expect(captured.content()).toContain('port: 9222')
    expect(() => JSON.parse(captured.content())).toThrow()
  })

  it('returns safe error metadata without error messages or stacks', () => {
    const error = Object.assign(new Error('secret-bearing upstream URL'), { code: 'ECONNREFUSED' })
    const details = errorDetails(error)
    expect(details).toEqual({ errorType: 'Error', errorCode: 'ECONNREFUSED' })
    expect(JSON.stringify(details)).not.toContain('secret-bearing')
  })
})
