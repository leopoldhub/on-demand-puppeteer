const PROFILE_PATTERN = /^[A-Za-z0-9._-]{1,128}$/

export interface RequestOptions {
  profile: string
  idleTimeoutMs: number
}

export function parseProfile(url: URL): string {
  const profile = url.searchParams.get('profile') || 'default'
  if (!PROFILE_PATTERN.test(profile) || profile === '.' || profile === '..') {
    throw new Error('profile must be a 1-128 character safe slug')
  }
  return profile
}

export function parseRequestOptions(url: URL, defaultIdleTimeoutMs: number): RequestOptions {
  const rawTimeout = url.searchParams.get('idleTimeout')
  let idleTimeoutMs = defaultIdleTimeoutMs
  if (rawTimeout !== null) {
    if (!/^-?\d+$/.test(rawTimeout)) throw new Error('idleTimeout must be an integer')
    idleTimeoutMs = Number(rawTimeout)
    if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs < -1) {
      throw new Error('idleTimeout must be -1 or a non-negative integer')
    }
  }
  return { profile: parseProfile(url), idleTimeoutMs }
}
