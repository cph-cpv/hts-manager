import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { me } from '~/functions/auth.fn'
import { TabNav } from '~/components/TabNav'

/**
 * Pathless layout for the authed list views (`/files`, `/runs`). Holds the auth
 * guard once and renders the shared tab nav above the routed content.
 */
export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const { authenticated } = await me()
    if (!authenticated) throw redirect({ to: '/login' })
  },
  component: AppLayout,
})

function AppLayout() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      <TabNav />
      <Outlet />
    </main>
  )
}
