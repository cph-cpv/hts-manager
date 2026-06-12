/**
 * Authentication primitives for the single-PIN access model. There are no user
 * accounts: anyone who knows `HTSM_PIN` gets a signed session cookie, and every
 * data server function gates on it via `authMiddleware` (in `./auth-middleware`).
 *
 * The cookie is `htsm_session = <value>.<sig>` where `sig` is the base64url
 * HMAC-SHA256 of `value` keyed by `HTSM_SESSION_SECRET`. `value` is opaque random
 * bytes — it carries no data; possessing a valid signature is the whole proof,
 * since only the server (holding the secret) can mint one. See plan.md (step 5).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { deleteCookie, getCookie, setCookie } from '@tanstack/react-start/server'

const COOKIE_NAME = 'htsm_session'
/** Session cookie lifetime: one week. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7

/** Read a required env var, failing loudly if it is unset. */
function requireEnv(name: 'HTSM_PIN' | 'HTSM_SESSION_SECRET'): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

/** Base64url HMAC-SHA256 of `value` keyed by the session secret. */
function sign(value: string): string {
  return createHmac('sha256', requireEnv('HTSM_SESSION_SECRET'))
    .update(value)
    .digest('base64url')
}

/**
 * Constant-time string equality. Both inputs are hashed first so the comparison
 * is over fixed-length buffers — this avoids leaking length and sidesteps
 * `timingSafeEqual`'s requirement that its arguments be equal length.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const da = createHash('sha256').update(a).digest()
  const db = createHash('sha256').update(b).digest()
  return timingSafeEqual(da, db)
}

/** Constant-time compare a submitted PIN against `HTSM_PIN`. */
export function checkPin(pin: string): boolean {
  return constantTimeEqual(pin, requireEnv('HTSM_PIN'))
}

/** Mint a fresh signed session and set it as an httpOnly cookie on the response. */
export function issueSession(): void {
  const value = randomBytes(16).toString('base64url')
  setCookie(COOKIE_NAME, `${value}.${sign(value)}`, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  })
}

/** Clear the session cookie. */
export function clearSession(): void {
  deleteCookie(COOKIE_NAME, { path: '/' })
}

/** True if the current request carries a cookie with a valid signature. */
export function hasValidSession(): boolean {
  const token = getCookie(COOKIE_NAME)
  if (!token) return false

  const dot = token.lastIndexOf('.')
  if (dot <= 0) return false

  const value = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!sig) return false

  const expected = Buffer.from(sign(value))
  const given = Buffer.from(sig)
  if (expected.length !== given.length) return false
  return timingSafeEqual(given, expected)
}
