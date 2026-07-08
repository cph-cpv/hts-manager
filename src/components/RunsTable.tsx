import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { formatDate } from '~/lib/format'
import type { RunSummary } from '~/db/queries'

type RunSortKey = 'run_folder' | 'run_date' | 'instrument' | 'flowcell' | 'file_count'

type SortState = { key: RunSortKey; dir: 'asc' | 'desc' }

function sortRuns(runs: RunSummary[], key: RunSortKey, dir: 'asc' | 'desc'): RunSummary[] {
  return [...runs].sort((a, b) => {
    const av = a[key] ?? null
    const bv = b[key] ?? null
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    const cmp = av < bv ? -1 : av > bv ? 1 : 0
    return dir === 'asc' ? cmp : -cmp
  })
}

function SortableHead({
  label,
  sortKey,
  current,
  onSort,
  className,
}: {
  label: string
  sortKey: RunSortKey
  current: SortState
  onSort: (key: RunSortKey) => void
  className?: string
}) {
  const active = current.key === sortKey
  const Icon = active
    ? current.dir === 'asc'
      ? ChevronUp
      : ChevronDown
    : ChevronsUpDown
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {label}
        <Icon className="size-3.5 shrink-0" />
      </button>
    </TableHead>
  )
}

export function RunsTable({ runs }: { runs: RunSummary[] }) {
  const [sort, setSort] = useState<SortState>({ key: 'run_date', dir: 'desc' })

  const onSort = (key: RunSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    )
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        No runs found. Run a scan to index sequencing data.
      </div>
    )
  }

  const sorted = sortRuns(runs, sort.key, sort.dir)

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="Run folder" sortKey="run_folder" current={sort} onSort={onSort} />
            <SortableHead label="Run date" sortKey="run_date" current={sort} onSort={onSort} />
            <SortableHead label="Instrument" sortKey="instrument" current={sort} onSort={onSort} />
            <SortableHead label="Flowcell" sortKey="flowcell" current={sort} onSort={onSort} />
            <SortableHead
              label="Files"
              sortKey="file_count"
              current={sort}
              onSort={onSort}
              className="text-right"
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="font-medium">
                <Link
                  to="/runs/$runId"
                  params={{ runId: String(run.id) }}
                  className="hover:underline"
                >
                  {run.run_folder}
                </Link>
              </TableCell>
              <TableCell>{formatDate(run.run_date)}</TableCell>
              <TableCell className="text-muted-foreground">
                {run.instrument ?? '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {run.flowcell}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {run.file_count}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
