import { EventEmitter } from 'node:events'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { BrowserManager, type ManagedBrowser } from '../src/browser-manager.js'
import type { Config } from '../src/config.js'
import { createService } from '../src/server.js'

class FakeBrowser extends EventEmitter implements ManagedBrowser {
  constructor(private readonly endpoint: string) {
    super()
  }
  wsEndpoint(): string {
    return this.endpoint
  }
  async close(): Promise<void> {
    this.emit('disconnected')
  }
}

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.allSettled(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function setup(authToken?: string) {
  const upstreamWebSockets = new WebSocketServer({ noServer: true })
  const upstreamHttp = http.createServer((request, response) => {
    if (request.url?.startsWith('/json/version')) {
      const port = (upstreamHttp.address() as AddressInfo).port
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ Browser: 'FakeChrome', webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fake` }))
      return
    }

    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString(), authorization: request.headers.authorization }))
    })
  })
  upstreamHttp.on('upgrade', (request, socket, head) => {
    upstreamWebSockets.handleUpgrade(request, socket, head, (webSocket) => upstreamWebSockets.emit('connection', webSocket, request))
  })
  upstreamWebSockets.on('connection', (socket) => socket.on('message', (data, isBinary) => socket.send(data, { binary: isBinary })))
  await new Promise<void>((resolve) => upstreamHttp.listen(0, '127.0.0.1', resolve))

  const upstreamPort = (upstreamHttp.address() as AddressInfo).port
  const launcher = vi.fn(async (_profileDirectory: string) =>
    new FakeBrowser(`ws://127.0.0.1:${upstreamPort}/devtools/browser/fake`),
  )
  const manager = new BrowserManager('/profiles', launcher)
  const config: Config = {
    host: '127.0.0.1',
    port: 0,
    defaultIdleTimeoutMs: 1000,
    profileRoot: '/profiles',
    headless: true,
    logLevel: 'info',
    logFormat: 'pretty',
    authToken,
  }
  const service = createService(config, manager)
  await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve))
  const port = (service.server.address() as AddressInfo).port
  cleanups.push(async () => {
    await service.close()
    for (const client of upstreamWebSockets.clients) client.terminate()
    upstreamWebSockets.close()
    await new Promise<void>((resolve) => upstreamHttp.close(() => resolve()))
  })
  return { port, manager, launcher }
}

describe('service', () => {
  it('serves public global health and status without launching a browser', async () => {
    const { port, launcher } = await setup('secret')
    const health = await fetch(`http://127.0.0.1:${port}/healthz`)
    const status = await fetch(`http://127.0.0.1:${port}/statusz`)
    expect(await health.json()).toEqual({ status: 'ok' })
    expect(await status.json()).toEqual(expect.objectContaining({
      status: 'ok',
      browsers: { runningBrowsers: 0, launchingBrowsers: 0, activeConnections: 0, shuttingDown: false },
    }))
    expect(launcher).not.toHaveBeenCalled()
  })

  it('authenticates and proxies arbitrary HTTP requests to the selected profile', async () => {
    const { port, launcher } = await setup('secret')
    expect((await fetch(`http://127.0.0.1:${port}/anything?profile=user-1`)).status).toBe(401)

    const response = await fetch(`http://127.0.0.1:${port}/anything?profile=user-1&idleTimeout=20&keep=yes`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'text/plain' },
      body: 'payload',
    })
    expect(await response.json()).toEqual({
      method: 'POST',
      url: '/anything?keep=yes',
      body: 'payload',
    })
    expect(launcher).toHaveBeenCalledTimes(1)
    expect(launcher.mock.calls[0]?.[0]).toBe('/profiles/user-1')
  })

  it('rewrites Chrome discovery WebSocket URLs through the same profile', async () => {
    const { port } = await setup()
    const response = await fetch(`http://127.0.0.1:${port}/json/version?profile=discovery`)
    const body = await response.json() as { Browser: string; webSocketDebuggerUrl: string }
    expect(body.Browser).toBe('FakeChrome')
    const endpoint = new URL(body.webSocketDebuggerUrl)
    expect(endpoint.host).toBe(`127.0.0.1:${port}`)
    expect(endpoint.pathname).toBe('/devtools/browser/fake')
    expect(endpoint.searchParams.get('profile')).toBe('discovery')
  })

  it('proxies arbitrary WebSocket paths and keeps /cdp as an alias', async () => {
    const { port } = await setup()
    for (const path of ['/devtools/page/one?profile=test', '/cdp?profile=test']) {
      const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })
      socket.send('hello')
      expect(await new Promise<string>((resolve) => socket.once('message', (data) => resolve(data.toString())))).toBe('hello')
      socket.close(1000)
      await new Promise<void>((resolve) => socket.once('close', () => resolve()))
    }
  })
})
