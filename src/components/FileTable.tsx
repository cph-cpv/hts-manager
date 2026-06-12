import { UploadIcon } from 'lucide-react'
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
import type { FileRow } from '~/db/schema'
import type { ColumnVisibility } from '~/components/ColumnToggle'

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

/** The searchable file table: one row per indexed FASTQ with its upload control. */
export function FileTable({
  files,
  onUpload,
  pendingId,
  columnVisibility,
}: {
  files: FileRow[]
  onUpload: (id: number) => void
  pendingId: number | null
  columnVisibility: ColumnVisibility
}) {
  if (files.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        No files match. Run a scan or adjust your search.
      </div>
    )
  }

  const { instrument, flowcell, lane } = columnVisibility

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Run date</TableHead>
            {instrument && <TableHead>Instrument</TableHead>}
            {flowcell && <TableHead>Flowcell</TableHead>}
            {lane && <TableHead>Lane</TableHead>}
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((file) => (
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
                  {file.flowcell ?? '—'}
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
                <UploadAction
                  file={file}
                  onUpload={onUpload}
                  pending={pendingId === file.id}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
