import { Link } from '@tanstack/react-router'

/** The two top-level views, backed by real routes so the URL tracks the tab. */
const TABS = [
  { to: '/files', label: 'Files' },
  { to: '/runs', label: 'Runs' },
] as const

/**
 * URL-driven tab bar. Styled to match the shadcn Tabs list, but each "tab" is a
 * router `Link` whose active state comes from `data-status="active"` — so
 * navigating (e.g. back from a run detail page) reflects the real route.
 */
export function TabNav() {
  return (
    <nav className="mb-4 inline-flex h-9 items-center rounded-lg bg-muted p-1 text-muted-foreground">
      {TABS.map((tab) => (
        <Link
          key={tab.to}
          to={tab.to}
          activeOptions={{ exact: true }}
          className="inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all data-[status=active]:bg-background data-[status=active]:text-foreground data-[status=active]:shadow"
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
