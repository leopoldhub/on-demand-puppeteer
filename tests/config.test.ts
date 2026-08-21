import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'
import { parseProfile, parseRequestOptions } from '../src/request-options.js'

describe('configuration', () => {
  it('loads defaults without authentication', () => {
    const config = loadConfig({})
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 9222,
      defaultIdleTimeoutMs: 300000,
      headless: true,
      logLevel: 'info',
      logFormat: 'pretty',
      authToken: undefined,
    })
    expect(config.profileRoot).toBe(path.resolve('.browser-profiles'))
  })

  it('rejects invalid environment values', () => {
    expect(() => loadConfig({ PORT: '-1' })).toThrow('PORT')
    expect(() => loadConfig({ DEFAULT_IDLE_TIMEOUT_MS: '-2' })).toThrow('DEFAULT_IDLE_TIMEOUT_MS')
    expect(() => loadConfig({ HEADLESS: 'yes' })).toThrow('HEADLESS')
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow('LOG_LEVEL')
    expect(() => loadConfig({ LOG_FORMAT: 'xml' })).toThrow('LOG_FORMAT')
  })
})

describe('request options', () => {
  it('uses the default profile and timeout', () => {
    expect(parseRequestOptions(new URL('http://localhost/cdp'), 50)).toEqual({
      profile: 'default',
      idleTimeoutMs: 50,
    })
  })

  it('accepts a safe profile and disabled timeout', () => {
    expect(parseRequestOptions(new URL('http://localhost/cdp?profile=user-1&idleTimeout=-1'), 50)).toEqual({
      profile: 'user-1',
      idleTimeoutMs: -1,
    })
  })

  it('rejects unsafe profiles and invalid timeouts', () => {
    expect(() => parseProfile(new URL('http://localhost/status?profile=../secret'))).toThrow('safe slug')
    expect(() => parseProfile(new URL('http://localhost/status?profile=..'))).toThrow('safe slug')
    expect(() => parseRequestOptions(new URL('http://localhost/cdp?idleTimeout=-2'), 50)).toThrow(
      'idleTimeout',
    )
  })
})
