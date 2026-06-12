/**
 * Auth server functions: `login` mints a session on a correct PIN, `logout`
 * clears it, and `me` reports whether the current request is authenticated.
 * `me` is intentionally ungated (no {@link authMiddleware}) so the login page and
 * route loaders can branch on auth state. See plan.md (step 5).
 */
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { checkPin, clearSession, hasValidSession, issueSession } from '../server/auth'

const loginInput = z.object({ pin: z.string().min(1) })

/** Validate the PIN; on success set the session cookie. Returns `{ ok }`. */
export const login = createServerFn({ method: 'POST' })
  .validator((data: unknown) => loginInput.parse(data))
  .handler(async ({ data }) => {
    if (!checkPin(data.pin)) return { ok: false as const }
    issueSession()
    return { ok: true as const }
  })

/** Clear the session cookie. */
export const logout = createServerFn({ method: 'POST' }).handler(async () => {
  clearSession()
  return { ok: true as const }
})

/** Report whether the current request carries a valid session. */
export const me = createServerFn({ method: 'GET' }).handler(async () => {
  return { authenticated: hasValidSession() }
})
