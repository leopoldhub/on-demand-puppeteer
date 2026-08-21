import http, { type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import WebSocket, { WebSocketServer } from 'ws'
import { isAuthorized } from './auth.js'
import type { BrowserLease, BrowserManager } from './browser-manager.js'
import type { Config } from './config.js'
import type { AppLogger } from './logger.js'
import { errorDetails } from './logger.js'
import { parseRequestOptions } from './request-options.js'

const PROVIDER_QUERY_PARAMETERS = ['profile', 'idleTimeout']
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(body))
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  const body = JSON.stringify({ error: message })
  socket.end(
    `HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\n` +
      'Content-Type: application/json; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Connection: close\r\n\r\n' +
      body,
  )
}

function upstreamUrl(lease: BrowserLease, requestUrl: URL, browserEndpoint = false): URL {
  if (browserEndpoint) return new URL(lease.wsEndpoint)

  const endpoint = new URL(lease.wsEndpoint)
  const target = new URL(requestUrl.pathname + requestUrl.search, `http://${endpoint.host}`)
  for (const parameter of PROVIDER_QUERY_PARAMETERS) target.searchParams.delete(parameter)
  return target
}

function proxyHeaders(headers: IncomingHttpHeaders, authEnabled: boolean): http.OutgoingHttpHeaders {
  const proxied: http.OutgoingHttpHeaders = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || name === 'host' || HOP_BY_HOP_HEADERS.has(name) || name.startsWith('sec-websocket-')) continue
    if (authEnabled && name === 'authorization') continue
    proxied[name] = value
  }
  return proxied
}

function publicWebSocketOrigin(request: IncomingMessage): string {
  const forwardedProtocol = request.headers['x-forwarded-proto']?.toString().split(',')[0]?.trim()
  const protocol = forwardedProtocol === 'https' ? 'wss' : 'ws'
  return `${protocol}://${request.headers.host || 'localhost'}`
}

function rewriteDiscoveryBody(body: Buffer, request: IncomingMessage, profile: string): Buffer {
  try {
    const parsed: unknown = JSON.parse(body.toString('utf8'))
    const rewrite = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(rewrite)
      if (!value || typeof value !== 'object') return value

      const record = value as Record<string, unknown>
      const rewritten: Record<string, unknown> = {}
      for (const [key, entry] of Object.entries(record)) {
        if (key === 'webSocketDebuggerUrl' && typeof entry === 'string') {
          const endpoint = new URL(entry)
          const publicEndpoint = new URL(endpoint.pathname + endpoint.search, publicWebSocketOrigin(request))
          publicEndpoint.searchParams.set('profile', profile)
          rewritten[key] = publicEndpoint.toString()
        } else {
          rewritten[key] = rewrite(entry)
        }
      }
      return rewritten
    }
    return Buffer.from(JSON.stringify(rewrite(parsed)))
  } catch {
    return body
  }
}

function isDiscoveryRequest(pathname: string): boolean {
  return pathname === '/json' || pathname === '/json/' || pathname === '/json/list' || pathname === '/json/version'
}

function closePair(client: WebSocket, upstream: WebSocket): void {
  if (client.readyState === WebSocket.OPEN) client.close(1011, 'Proxy closed')
  if (upstream.readyState === WebSocket.OPEN) upstream.close(1011, 'Proxy closed')
}

function forwardClose(socket: WebSocket, code: number, reason: Buffer): void {
  if (socket.readyState !== WebSocket.OPEN) return
  if (code === 1005 || code === 1006 || code === 1015) socket.close()
  else socket.close(code, reason)
}

export function createService(config: Config, manager: BrowserManager, logger?: AppLogger) {
  const webSocketServer = new WebSocketServer({ noServer: true })
  const startedAt = Date.now()
  const server = http.createServer((request, response) => void handleHttp(request, response))

  async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let requestUrl: URL
    try {
      requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    } catch {
      logger?.warn({ event: 'http_request_rejected', statusCode: 400 }, 'Invalid HTTP request URL')
      json(response, 400, { error: 'Invalid URL' })
      return
    }

    if (request.method === 'GET' && requestUrl.pathname === '/healthz') {
      logger?.debug({ event: 'http_request', method: request.method, path: requestUrl.pathname, statusCode: 200 }, 'HTTP request')
      json(response, 200, { status: 'ok' })
      return
    }
    if (request.method === 'GET' && requestUrl.pathname === '/statusz') {
      logger?.debug({ event: 'http_request', method: request.method, path: requestUrl.pathname, statusCode: 200 }, 'HTTP request')
      json(response, 200, {
        status: 'ok',
        uptimeMs: Date.now() - startedAt,
        browsers: manager.globalStatus(),
      })
      return
    }
    if (!isAuthorized(request, config.authToken)) {
      logger?.warn(
        { event: 'http_request_rejected', method: request.method, path: requestUrl.pathname, statusCode: 401 },
        'Unauthorized HTTP request',
      )
      response.setHeader('www-authenticate', 'Bearer')
      json(response, 401, { error: 'Unauthorized' })
      return
    }

    let lease: BrowserLease | undefined
    try {
      const options = parseRequestOptions(requestUrl, config.defaultIdleTimeoutMs)
      lease = await manager.acquire(options.profile, options.idleTimeoutMs)
      const target = upstreamUrl(lease, requestUrl)
      logger?.debug(
        { event: 'http_proxy_started', method: request.method, path: requestUrl.pathname, profile: options.profile },
        'Proxying HTTP request',
      )

      const releaseLease = () => {
        lease?.release()
        lease = undefined
      }
      const headers = proxyHeaders(request.headers, Boolean(config.authToken))
      if (isDiscoveryRequest(requestUrl.pathname)) headers['accept-encoding'] = 'identity'

      const upstreamRequest = http.request(
        target,
        {
          method: request.method,
          headers,
        },
        (upstreamResponse) => {
          response.once('close', releaseLease)
          response.once('finish', releaseLease)
          lease?.touch()

          if (isDiscoveryRequest(requestUrl.pathname)) {
            const chunks: Buffer[] = []
            upstreamResponse.on('data', (chunk: Buffer) => {
              lease?.touch()
              chunks.push(chunk)
            })
            upstreamResponse.on('end', () => {
              const body = rewriteDiscoveryBody(Buffer.concat(chunks), request, options.profile)
              const headers = { ...upstreamResponse.headers, 'content-length': body.length }
              delete headers['transfer-encoding']
              response.writeHead(upstreamResponse.statusCode || 502, headers)
              response.end(body)
            })
            return
          }

          response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers)
          upstreamResponse.on('data', () => lease?.touch())
          upstreamResponse.pipe(response)
        },
      )
      upstreamRequest.on('error', (error) => {
        logger?.error(
          { event: 'http_upstream_error', profile: options.profile, ...errorDetails(error) },
          'Browser HTTP request failed',
        )
        releaseLease()
        if (!response.headersSent) json(response, 502, { error: 'Browser request failed' })
        else response.destroy()
      })
      request.once('aborted', () => {
        upstreamRequest.destroy()
        releaseLease()
      })
      request.on('data', () => lease?.touch())
      request.pipe(upstreamRequest)
    } catch (error) {
      lease?.release()
      logger?.warn({ event: 'http_request_rejected', statusCode: 400, ...errorDetails(error) }, 'HTTP request rejected')
      if (!response.headersSent) json(response, 400, { error: (error as Error).message })
    }
  }

  server.on('upgrade', (request, socket, head) => void handleUpgrade(request, socket, head))

  async function handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    let lease: BrowserLease | undefined
    try {
      const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
      if (requestUrl.pathname === '/healthz' || requestUrl.pathname === '/statusz') {
        return rejectUpgrade(socket, 404, 'Not found')
      }
      if (!isAuthorized(request, config.authToken)) {
        logger?.warn({ event: 'websocket_upgrade_rejected', path: requestUrl.pathname, statusCode: 401 }, 'Unauthorized WebSocket upgrade')
        return rejectUpgrade(socket, 401, 'Unauthorized')
      }

      const options = parseRequestOptions(requestUrl, config.defaultIdleTimeoutMs)
      lease = await manager.acquire(options.profile, options.idleTimeoutMs)
      const target = upstreamUrl(lease, requestUrl, requestUrl.pathname === '/cdp')
      const upstream = new WebSocket(target, { headers: proxyHeaders(request.headers, Boolean(config.authToken)) })
      const failBeforeUpgrade = (error: Error) => {
        logger?.error(
          { event: 'websocket_upstream_connection_failed', profile: options.profile, ...errorDetails(error) },
          'Browser WebSocket connection failed',
        )
        lease?.release()
        lease = undefined
        rejectUpgrade(socket, 502, 'Browser connection failed')
      }
      upstream.once('error', failBeforeUpgrade)
      upstream.once('open', () => {
        upstream.off('error', failBeforeUpgrade)
        webSocketServer.handleUpgrade(request, socket, head, (client) => {
          logger?.info({ event: 'websocket_proxy_opened', profile: options.profile }, 'WebSocket proxy connection opened')
          bridge(client, upstream, lease!, options.profile)
          lease = undefined
        })
      })
    } catch (error) {
      lease?.release()
      logger?.warn({ event: 'websocket_upgrade_rejected', statusCode: 400, ...errorDetails(error) }, 'WebSocket upgrade rejected')
      rejectUpgrade(socket, 400, (error as Error).message)
    }
  }

  function bridge(client: WebSocket, upstream: WebSocket, lease: BrowserLease, profile: string): void {
    let released = false
    const release = (): boolean => {
      if (released) return false
      released = true
      lease.release()
      return true
    }
    client.on('message', (data, isBinary) => {
      lease.touch()
      if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary })
    })
    upstream.on('message', (data, isBinary) => {
      lease.touch()
      if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary })
    })
    client.on('close', (code, reason) => {
      if (release()) logger?.info({ event: 'websocket_proxy_closed', profile, initiator: 'client', closeCode: code }, 'WebSocket proxy connection closed')
      forwardClose(upstream, code, reason)
    })
    upstream.on('close', (code, reason) => {
      if (release()) logger?.info({ event: 'websocket_proxy_closed', profile, initiator: 'browser', closeCode: code }, 'WebSocket proxy connection closed')
      forwardClose(client, code, reason)
    })
    client.on('error', (error) => {
      logger?.warn({ event: 'websocket_client_error', profile, ...errorDetails(error) }, 'WebSocket client connection error')
      closePair(client, upstream)
    })
    upstream.on('error', (error) => {
      logger?.error({ event: 'websocket_upstream_error', profile, ...errorDetails(error) }, 'Browser WebSocket connection error')
      closePair(client, upstream)
    })
  }

  return {
    server,
    async close(): Promise<void> {
      logger?.info({ event: 'service_shutdown_started' }, 'Service shutdown started')
      for (const client of webSocketServer.clients) client.close(1001, 'Service shutting down')
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
          server.closeAllConnections()
        })
      }
      webSocketServer.close()
      await manager.closeAll()
      logger?.info({ event: 'service_shutdown_completed' }, 'Service shutdown completed')
    },
  }
}
