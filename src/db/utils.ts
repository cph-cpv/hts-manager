/** Current UTC timestamp as an ISO-8601 string for persisted timestamps. */
export function nowIso(): string {
  return new Date().toISOString()
}
