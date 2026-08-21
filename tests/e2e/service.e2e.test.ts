import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import puppeteer from 'puppeteer'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asManagedBrowser, BrowserManager } from '../../src/browser-manager.js'
import type { Config } from '../../src/config.js'
import { createService } from '../../src/server.js'

describe('real browser CDP proxy', () => {
  let root: string
  let manager: BrowserManager
  let service: ReturnType<typeof createService>
  let origin: string

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'on-demand-puppeteer-'))
    manager = new BrowserManager(root, async (profileDirectory) =>
      asManagedBrowser(await puppeteer.launch({ headless: true, userDataDir: profileDirectory })),
    )
    const config: Config = {
      host: '127.0.0.1',
      port: 0,
      defaultIdleTimeoutMs: 200,
      profileRoot: root,
      headless: true,
      logLevel: 'info',
      logFormat: 'pretty',
    }
    service = createService(config, manager)
    await new Promise<void>((resolve) => service.server.listen(0, '127.0.0.1', resolve))
    origin = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`
  }, 30000)

  afterAll(async () => {
    await service.close()
    await rm(root, { recursive: true, force: true })
  })

  it('connects Puppeteer through the proxy and persists profile state after idle shutdown', async () => {
    expect(await (await fetch(`${origin}/healthz`)).json()).toEqual({ status: 'ok' })
    const discovery = await fetch(`${origin}/json/version?profile=e2e`)
    const version = await discovery.json() as { webSocketDebuggerUrl: string }
    expect(version.webSocketDebuggerUrl).toContain('profile=e2e')

    const first = await puppeteer.connect({ browserWSEndpoint: version.webSocketDebuggerUrl })
    const page = await first.newPage()
    await page.goto('data:text/html,<title>proxy works</title>')
    expect(await page.title()).toBe('proxy works')
    await first.defaultBrowserContext().setCookie({ name: 'persistent', value: 'yes', domain: 'example.test' })
    await first.disconnect()

    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(manager.status('e2e').state).toBe('stopped')

    const secondDiscovery = await fetch(`${origin}/json/version?profile=e2e`)
    const secondVersion = await secondDiscovery.json() as { webSocketDebuggerUrl: string }
    const second = await puppeteer.connect({ browserWSEndpoint: secondVersion.webSocketDebuggerUrl })
    const cookies = await second.defaultBrowserContext().cookies()
    expect(cookies).toContainEqual(expect.objectContaining({ name: 'persistent', value: 'yes' }))
    await second.disconnect()
  }, 30000)
})
