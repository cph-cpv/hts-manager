import { useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  DownloadIcon,
  UploadIcon,
} from 'lucide-react'
import { Button } from '~/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { StatusBadge } from '~/components/StatusBadge'
import { humanFileSize, formatDate } from '~/lib/format'
import type { FileRow, FileWithRun } from '~/db/files'
import type { ColumnVisibility } from '~/components/ColumnToggle'

type FileSortKey =
  | 'name'
  | 'size'
  | 'run_date'
  | 'instrument'
  | 'flowcell'
  | 'lane'
  | 'upload_status'

type SortState = { key: FileSortKey; dir: 'asc' | 'desc' }

function sortFiles(files: FileWithRun[], key: FileSortKey, dir: 'asc' | 'desc'): FileWithRun[] {
  return [...files].sort((a, b) => {
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
  sortKey: FileSortKey
  current: SortState
  onSort: (key: FileSortKey) => void
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

/** The upload action shown per row, keyed off the row's lifecycle state. */
function UploadAction({
  file,
  onUpload,
  pending,
}: {
  file: FileRow
  onUpload: (id: number) => void
  pending: boolean
}) {
  // Already done, or mid-flight in the queue — no action to offer.
  if (file.uploaded || file.upload_status === 'queued' || file.upload_status === 'uploading') {
    return null
  }

  const isRetry = file.upload_status === 'error'
  return (
    <Button
      type="button"
      size="sm"
      variant={isRetry ? 'outline' : 'default'}
      onClick={() => onUpload(file.id)}
      disabled={pending}
      title={isRetry ? file.upload_error ?? 'Upload failed — retry' : undefined}
    >
      <UploadIcon />
      {isRetry ? 'Retry' : 'Upload'}
    </Button>
  )
}

/**
 * Download link for a row. A plain anchor rather than a fetch: the session is a
 * cookie, so the browser streams the file straight to disk without the app ever
 * holding a multi-gigabyte body in memory.
 */
function DownloadAction({ file }: { file: FileRow }) {
  // The route answers 410 for a missing file — don't offer a link that can't work.
  if (file.missing) return null

  return (
    <Button asChild size="sm" variant="ghost" title={`Download ${file.name}`}>
      <a href={`/api/files/${file.id}/download`} download={file.name}>
        <DownloadIcon />
        <span className="sr-only">Download</span>
      </a>
    </Button>
  )
}

/** The searchable file table: one row per indexed FASTQ with its upload control. */
export function FileTable({
  files,
  onUpload,
  pendingId,
  columnVisibility,
}: {
  files: FileWithRun[]
  onUpload: (id: number) => void
  pendingId: number | null
  columnVisibility: ColumnVisibility
}) {
  const [sort, setSort] = useState<SortState>({ key: 'run_date', dir: 'desc' })

  const onSort = (key: FileSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    )
  }

  if (files.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        No files match. Run a scan or adjust your search.
      </div>
    )
  }

  const { instrument, flowcell, lane } = columnVisibility
  const sorted = sortFiles(files, sort.key, sort.dir)

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead label="Name" sortKey="name" current={sort} onSort={onSort} />
            <SortableHead label="Size" sortKey="size" current={sort} onSort={onSort} />
            <SortableHead label="Run date" sortKey="run_date" current={sort} onSort={onSort} />
            {instrument && (
              <SortableHead label="Instrument" sortKey="instrument" current={sort} onSort={onSort} />
            )}
            {flowcell && (
              <SortableHead label="Flowcell" sortKey="flowcell" current={sort} onSort={onSort} />
            )}
            {lane && (
              <SortableHead label="Lane" sortKey="lane" current={sort} onSort={onSort} />
            )}
            <SortableHead label="Status" sortKey="upload_status" current={sort} onSort={onSort} />
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((file) => (
            <TableRow key={file.id}>
              <TableCell className="font-medium">{file.name}</TableCell>
              <TableCell className="text-muted-foreground">
                {humanFileSize(file.size)}
              </TableCell>
              <TableCell>{formatDate(file.run_date)}</TableCell>
              {instrument && (
                <TableCell className="text-muted-foreground">
                  {file.instrument ?? '—'}
                </TableCell>
              )}
              {flowcell && (
                <TableCell className="text-muted-foreground">
                  {file.flowcell}
                </TableCell>
              )}
              {lane && (
                <TableCell className="text-muted-foreground">
                  {file.lane ?? '—'}
                </TableCell>
              )}
              <TableCell>
                <StatusBadge status={file.upload_status} />
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <DownloadAction file={file} />
                  <UploadAction
                    file={file}
                    onUpload={onUpload}
                    pending={pendingId === file.id}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
