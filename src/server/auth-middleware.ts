/**
 * Auth gate for data server functions, kept in its own module on purpose.
 *
 * `authMiddleware` is referenced at the server-fn *builder* level
 * (`.middleware([authMiddleware])`), so — unlike a handler body — its import
 * survives into the client bundle. Were it co-located with the cookie helpers in
 * {@link file://./auth.ts}, that module's top-level `@tanstack/react-start/server`
 * import (server-only) would be dragged client-side and trip Start's import
 * protection. Isolated here, the compiler strips the `.server()` callback (and
 * with it the `hasValidSession` import), so nothing server-only leaks. See
 * plan.md (step 5).
 */
import { redirect } from '@tanstack/react-router'
import { createMiddleware } from '@tanstack/react-start'
import { hasValidSession } from './auth'

/**
 * Function middleware that rejects unauthenticated calls. Applied to every data
 * server function (file list, status, upload requests). Throws a redirect to the
 * login page when the session is missing or invalid.
 */
export const authMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    if (!hasValidSession()) {
      throw redirect({ to: '/login' })
    }
    return next()
  },
)
