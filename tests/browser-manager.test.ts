import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BrowserManager, type ManagedBrowser } from '../src/browser-manager.js'

class FakeBrowser extends EventEmitter implements ManagedBrowser {
  closed = false
  constructor(private readonly endpoint: string) {
    super()
  }
  wsEndpoint(): string {
    return this.endpoint
  }
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.emit('disconnected')
  }
}

afterEach(() => vi.useRealTimers())

describe('BrowserManager', () => {
  it('deduplicates concurrent launches and keeps the launch-time timeout', async () => {
    const browser = new FakeBrowser('ws://browser')
    const launcher = vi.fn(async () => browser)
    const manager = new BrowserManager('/profiles', launcher)

    const [first, second] = await Promise.all([manager.acquire('same', 100), manager.acquire('same', 5)])
    expect(launcher).toHaveBeenCalledTimes(1)
    expect(manager.status('same')).toMatchObject({ activeConnections: 2, idleTimeoutMs: 100 })
    first.release()
    second.release()
    await manager.closeAll()
  })

  it('does not close active browsers and closes after the final disconnect', async () => {
    vi.useFakeTimers()
    const browser = new FakeBrowser('ws://browser')
    const manager = new BrowserManager('/profiles', async () => browser)
    const first = await manager.acquire('profile', 100)
    const second = await manager.acquire('profile', 1)

    first.release()
    await vi.advanceTimersByTimeAsync(200)
    expect(browser.closed).toBe(false)
    second.release()
    await vi.advanceTimersByTimeAsync(99)
    expect(browser.closed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(browser.closed).toBe(true)
    expect(manager.status('profile').state).toBe('stopped')
  })

  it('never idles out a launch configured with -1', async () => {
    vi.useFakeTimers()
    const browser = new FakeBrowser('ws://browser')
    const manager = new BrowserManager('/profiles', async () => browser)
    const lease = await manager.acquire('permanent', -1)
    lease.release()
    await vi.advanceTimersByTimeAsync(100000)
    expect(browser.closed).toBe(false)
    await manager.closeAll()
  })
})
