import { createFileRoute, redirect } from '@tanstack/react-router'

// `/` has no view of its own — send it to the Files tab (which enforces auth).
export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: '/files' })
  },
})
