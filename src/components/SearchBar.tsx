import { useEffect, useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { Input } from '~/components/ui/input'

/**
 * Debounced name search. Owns the raw input text and emits the trimmed value to
 * `onSearch` after a short pause so typing doesn't fire a query per keystroke.
 */
export function SearchBar({
  onSearch,
  delayMs = 300,
}: {
  onSearch: (q: string) => void
  delayMs?: number
}) {
  const [text, setText] = useState('')

  useEffect(() => {
    const handle = setTimeout(() => onSearch(text.trim()), delayMs)
    return () => clearTimeout(handle)
  }, [text, delayMs, onSearch])

  return (
    <div className="relative w-full max-w-sm">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search by file name…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="pl-9"
        aria-label="Search files by name"
      />
    </div>
  )
}
