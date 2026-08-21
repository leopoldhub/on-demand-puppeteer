import 'dotenv/config'
import puppeteer from 'puppeteer'
import { asManagedBrowser, BrowserManager } from './browser-manager.js'
import { loadConfig } from './config.js'
import { createLogger, errorDetails } from './logger.js'
import { createService } from './server.js'

let logger = createLogger('info', process.env.LOG_FORMAT?.trim().toLowerCase() === 'json' ? 'json' : 'pretty')

async function main(): Promise<void> {
  const config = loadConfig()
  logger = createLogger(config.logLevel, config.logFormat)
  const manager = new BrowserManager(
    config.profileRoot,
    async (profileDirectory) =>
      asManagedBrowser(await puppeteer.launch({ headless: config.headless, userDataDir: profileDirectory })),
    logger,
  )
  const service = createService(config, manager, logger)
  await new Promise<void>((resolve, reject) => {
    service.server.once('error', reject)
    service.server.listen(config.port, config.host, resolve)
  })

  const address = service.server.address()
  const port = typeof address === 'object' && address ? address.port : config.port
  logger.info(
    { event: 'service_started', host: config.host, port, authEnabled: Boolean(config.authToken) },
    'On-demand Puppeteer started',
  )

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    await service.close()
  }
  process.once('SIGINT', () => {
    logger.info({ event: 'shutdown_signal_received', signal: 'SIGINT' }, 'Shutdown signal received')
    void shutdown()
  })
  process.once('SIGTERM', () => {
    logger.info({ event: 'shutdown_signal_received', signal: 'SIGTERM' }, 'Shutdown signal received')
    void shutdown()
  })
}

void main().catch((error: unknown) => {
  logger.fatal({ event: 'service_start_failed', ...errorDetails(error) }, 'Service failed to start')
  process.exitCode = 1
})
