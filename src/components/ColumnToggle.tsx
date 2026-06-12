import { useEffect, useRef, useState } from 'react'
import { SlidersHorizontalIcon } from 'lucide-react'
import { Button } from '~/components/ui/button'

const COLUMNS = [
  { key: 'instrument', label: 'Instrument' },
  { key: 'flowcell', label: 'Flowcell' },
  { key: 'lane', label: 'Lane' },
] as const

export type ColumnKey = (typeof COLUMNS)[number]['key']
export type ColumnVisibility = Record<ColumnKey, boolean>

export const DEFAULT_COLUMN_VISIBILITY: ColumnVisibility = {
  instrument: false,
  flowcell: false,
  lane: false,
}

export function ColumnToggle({
  visible,
  onChange,
}: {
  visible: ColumnVisibility
  onChange: (v: ColumnVisibility) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontalIcon className="h-4 w-4" />
        Columns
      </Button>

      {open && (
        <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border bg-white p-1.5 shadow-md dark:bg-zinc-900">
          {COLUMNS.map(({ key, label }) => (
            <label
              key={key}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent"
            >
              <input
                type="checkbox"
                checked={visible[key]}
                onChange={(e) =>
                  onChange({ ...visible, [key]: e.target.checked })
                }
              />
              {label}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
