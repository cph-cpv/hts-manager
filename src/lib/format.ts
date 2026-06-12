/** Small pure formatting helpers shared by the UI. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'] as const

/** Human-readable byte size, e.g. 1536 -> "1.5 KB". */
export function humanFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit++
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10
  return `${rounded} ${UNITS[unit]}`
}

/** Format an ISO date string (YYYY-MM-DD) for display; pass-through for now. */
export function formatDate(isoDate: string): string {
  return isoDate
}

/**
 * Format an ISO timestamp as a short local time-of-day (e.g. "14:32"). Used for
 * the "Last scan: <time>" / "uploaded at" labels. Returns "—" for null/invalid.
 */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
