import path from 'node:path'
import type { Browser } from 'puppeteer'
import type { AppLogger } from './logger.js'
import { errorDetails } from './logger.js'

export interface ManagedBrowser {
  wsEndpoint(): string
  close(): Promise<void>
  on(event: 'disconnected', listener: () => void): unknown
}

export type BrowserLauncher = (profileDirectory: string) => Promise<ManagedBrowser>

interface BrowserInstance {
  browser: ManagedBrowser
  profile: string
  idleTimeoutMs: number
  activeConnections: number
  launchedAt: number
  lastActivityAt: number
  idleTimer?: NodeJS.Timeout
  expectedClose: boolean
}

export interface BrowserLease {
  profile: string
  wsEndpoint: string
  touch(): void
  release(): void
}

export interface GlobalBrowserStatus {
  runningBrowsers: number
  launchingBrowsers: number
  activeConnections: number
  shuttingDown: boolean
}

export interface ProfileStatus {
  profile: string
  state: 'running' | 'stopped'
  activeConnections: number
  idleTimeoutMs: number | null
  launchedAt: string | null
  lastActivityAt: string | null
}

export class BrowserManager {
  private readonly instances = new Map<string, BrowserInstance>()
  private readonly launches = new Map<string, Promise<BrowserInstance>>()
  private stopping = false

  constructor(
    private readonly profileRoot: string,
    private readonly launchBrowser: BrowserLauncher,
    private readonly logger?: AppLogger,
  ) {}

  async acquire(profile: string, idleTimeoutMs: number): Promise<BrowserLease> {
    if (this.stopping) throw new Error('Service is shutting down')

    let instance = this.instances.get(profile)
    if (!instance) {
      let launch = this.launches.get(profile)
      if (!launch) {
        this.logger?.info({ event: 'browser_launch_started', profile, idleTimeoutMs }, 'Launching browser')
        launch = this.createInstance(profile, idleTimeoutMs)
        this.launches.set(profile, launch)
      }
      try {
        instance = await launch
      } finally {
        if (this.launches.get(profile) === launch) this.launches.delete(profile)
      }
    }

    if (this.stopping) {
      instance.expectedClose = true
      await instance.browser.close().catch(() => undefined)
      throw new Error('Service is shutting down')
    }
    if (instance.idleTimer) {
      clearTimeout(instance.idleTimer)
      instance.idleTimer = undefined
    }
    instance.activeConnections += 1
    instance.lastActivityAt = Date.now()
    this.logger?.debug(
      { event: 'browser_lease_acquired', profile, activeConnections: instance.activeConnections },
      'Browser connection acquired',
    )

    let released = false
    return {
      profile,
      wsEndpoint: instance.browser.wsEndpoint(),
      touch: () => {
        if (!released) instance!.lastActivityAt = Date.now()
      },
      release: () => {
        if (released) return
        released = true
        this.release(instance!)
      },
    }
  }

  status(profile: string): ProfileStatus {
    const instance = this.instances.get(profile)
    if (!instance) {
      return {
        profile,
        state: 'stopped',
        activeConnections: 0,
        idleTimeoutMs: null,
        launchedAt: null,
        lastActivityAt: null,
      }
    }
    return {
      profile,
      state: 'running',
      activeConnections: instance.activeConnections,
      idleTimeoutMs: instance.idleTimeoutMs,
      launchedAt: new Date(instance.launchedAt).toISOString(),
      lastActivityAt: new Date(instance.lastActivityAt).toISOString(),
    }
  }

  globalStatus(): GlobalBrowserStatus {
    return {
      runningBrowsers: this.instances.size,
      launchingBrowsers: this.launches.size,
      activeConnections: [...this.instances.values()].reduce(
        (total, instance) => total + instance.activeConnections,
        0,
      ),
      shuttingDown: this.stopping,
    }
  }

  async closeAll(): Promise<void> {
    this.stopping = true
    await Promise.allSettled(this.launches.values())
    const instances = [...this.instances.values()]
    this.logger?.info({ event: 'browser_shutdown_started', browserCount: instances.length }, 'Closing browsers')
    this.instances.clear()
    await Promise.allSettled(
      instances.map(async (instance) => {
        if (instance.idleTimer) clearTimeout(instance.idleTimer)
        instance.expectedClose = true
        await instance.browser.close()
      }),
    )
  }

  private async createInstance(profile: string, idleTimeoutMs: number): Promise<BrowserInstance> {
    const startedAt = Date.now()
    let browser: ManagedBrowser
    try {
      browser = await this.launchBrowser(path.join(this.profileRoot, profile))
    } catch (error) {
      this.logger?.error(
        { event: 'browser_launch_failed', profile, ...errorDetails(error) },
        'Browser launch failed',
      )
      throw error
    }
    const now = Date.now()
    const instance: BrowserInstance = {
      browser,
      profile,
      idleTimeoutMs,
      activeConnections: 0,
      launchedAt: now,
      lastActivityAt: now,
      expectedClose: false,
    }
    browser.on('disconnected', () => {
      if (this.instances.get(profile) === instance) {
        if (instance.idleTimer) clearTimeout(instance.idleTimer)
        this.instances.delete(profile)
      }
      if (instance.expectedClose) {
        this.logger?.info({ event: 'browser_disconnected', profile, expected: true }, 'Browser disconnected')
      } else {
        this.logger?.warn(
          { event: 'browser_disconnected', profile, expected: false },
          'Browser disconnected unexpectedly',
        )
      }
    })
    this.instances.set(profile, instance)
    this.logger?.info(
      { event: 'browser_launched', profile, idleTimeoutMs, durationMs: now - startedAt },
      'Browser launched',
    )
    return instance
  }

  private release(instance: BrowserInstance): void {
    if (this.instances.get(instance.profile) !== instance) return
    instance.activeConnections = Math.max(0, instance.activeConnections - 1)
    instance.lastActivityAt = Date.now()
    this.logger?.debug(
      { event: 'browser_lease_released', profile: instance.profile, activeConnections: instance.activeConnections },
      'Browser connection released',
    )
    if (instance.activeConnections === 0 && instance.idleTimeoutMs !== -1) {
      this.logger?.debug(
        { event: 'browser_idle_timer_started', profile: instance.profile, idleTimeoutMs: instance.idleTimeoutMs },
        'Browser idle timer started',
      )
      instance.idleTimer = setTimeout(() => {
        if (instance.activeConnections !== 0 || this.instances.get(instance.profile) !== instance) return
        this.instances.delete(instance.profile)
        instance.expectedClose = true
        this.logger?.info({ event: 'browser_idle_timeout', profile: instance.profile }, 'Closing idle browser')
        void instance.browser.close().catch((error) => {
          this.logger?.error(
            { event: 'browser_close_failed', profile: instance.profile, ...errorDetails(error) },
            'Failed to close idle browser',
          )
        })
      }, instance.idleTimeoutMs)
      instance.idleTimer.unref()
    }
  }
}

export function asManagedBrowser(browser: Browser): ManagedBrowser {
  return browser
}
