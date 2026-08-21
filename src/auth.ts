import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export function isAuthorized(request: IncomingMessage, expectedToken?: string): boolean {
  if (!expectedToken) return true
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) return false
  const supplied = Buffer.from(authorization.slice(7))
  const expected = Buffer.from(expectedToken)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}
