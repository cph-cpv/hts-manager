import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { ArrowLeftIcon, UploadIcon } from 'lucide-react'
import { me } from '~/functions/auth.fn'
import { getRun, requestRunUpload, requestUpload } from '~/functions/files.fn'
import { Button } from '~/components/ui/button'
import { FileTable } from '~/components/FileTable'
import type { ColumnVisibility } from '~/components/ColumnToggle'
import { statusQueryKey } from '~/components/TopBar'
import { WorkflowStatusBadge } from '~/components/WorkflowStatusBadge'
import { formatDate, formatTime, humanFileSize } from '~/lib/format'
import { getRunStatusPresentation } from '~/lib/run-status'
import type { FileWithRun } from '~/db/files'

export const Route = createFileRoute('/runs/$runId')({
  beforeLoad: async () => {
    const { authenticated } = await me()
    if (!authenticated) throw redirect({ to: '/login' })
  },
  component: RunDetail,
})

// Run-level columns are redundant here (they live in the header); the lane
// varies per file within a run, so keep it visible.
const COLUMN_VISIBILITY: ColumnVisibility = {
  instrument: false,
  flowcell: false,
  lane: true,
}

/** How many bytes a set of files totals, for the header summary. */
function totalSize(files: FileWithRun[]): number {
  return files.reduce((sum, f) => sum + f.size, 0)
}

/** A run's files still eligible for upload (not already done). */
function pendingUploads(files: FileWithRun[]): number {
  return files.filter((f) => !f.uploaded).length
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  )
}

function RunDetail() {
  const { runId } = Route.useParams()
  const id = Number(runId)
  const queryClient = useQueryClient()

  const runQuery = useQuery({
    queryKey: ['run', id],
    queryFn: () => getRun({ data: { runId: id } }),
    refetchInterval: 3000,
    placeholderData: keepPreviousData,
    enabled: Number.isInteger(id) && id > 0,
  })

  const uploadMutation = useMutation({
    mutationFn: (fileId: number) => requestUpload({ data: { id: fileId } }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['run', id] })
      queryClient.invalidateQueries({ queryKey: statusQueryKey })
    },
  })

  const runUploadMutation = useMutation({
    mutationFn: () => requestRunUpload({ data: { runId: id } }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['run', id] })
      queryClient.invalidateQueries({ queryKey: statusQueryKey })
    },
  })

  const backLink = (
    <Link
      to="/runs"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeftIcon className="size-4" />
      Back to runs
    </Link>
  )

  const result = runQuery.data
  const run = result?.run ?? null
  const files = result?.files ?? []
  const analyses = result?.analyses ?? []

  if (runQuery.isPending) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-6">
        {backLink}
        <p className="mt-6 text-sm text-muted-foreground">Loading run…</p>
      </main>
    )
  }

  if (!run) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-6">
        {backLink}
        <div className="mt-6 rounded-md border p-8 text-center text-sm text-muted-foreground">
          Run not found.
        </div>
      </main>
    )
  }

  const pending = pendingUploads(files)
  const { displayStatus, message } = getRunStatusPresentation(run)

  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      {backLink}

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">{run.run_folder}</h1>
            <WorkflowStatusBadge status={displayStatus} />
          </div>
          {(message || (displayStatus === 'Blocked' && run.last_blocking_reason)) && (
            <p className="mt-1 text-sm text-muted-foreground">
              {message ?? run.last_blocking_reason}
            </p>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
            {files.length} file{files.length === 1 ? '' : 's'} ·{' '}
            {humanFileSize(totalSize(files))}
          </p>
        </div>
        {files.length > 0 && (
          <Button
            type="button"
            onClick={() => runUploadMutation.mutate()}
            disabled={runUploadMutation.isPending || pending === 0}
            title={pending === 0 ? 'All files uploaded' : undefined}
          >
            <UploadIcon />
            {pending === 0 ? 'All uploaded' : 'Upload Run'}
          </Button>
        )}
      </div>

      <dl className="mt-6 grid grid-cols-2 gap-4 rounded-md border p-4 sm:grid-cols-3 lg:grid-cols-6">
        <MetaItem label="Run date" value={formatDate(run.run_date)} />
        <MetaItem label="Instrument" value={run.instrument || '—'} />
        <MetaItem label="Run number" value={run.run_number || '—'} />
        <MetaItem label="Flowcell" value={run.flowcell || '—'} />
        <MetaItem label="First seen" value={formatTime(run.first_seen_at)} />
        <MetaItem
          label="Last scanned"
          value={run.last_scanned_at ? formatTime(run.last_scanned_at) : 'Never'}
        />
      </dl>

      {analyses.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium">Analysis</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">FASTQs</th>
                <th className="px-4 py-3 font-medium">Attention</th>
              </tr>
            </thead>
            <tbody>
              {analyses.map((analysis) => (
                <tr key={analysis.id} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-medium">{analysis.analysis_folder}</td>
                  <td className="px-4 py-3">
                    <WorkflowStatusBadge status={analysis.display_status} />
                  </td>
                  <td className="px-4 py-3 text-right text-muted-foreground">
                    {analysis.indexed_file_count}
                  </td>
                  <td className="max-w-sm px-4 py-3 text-muted-foreground">
                    {analysis.status === 'blocked'
                      ? analysis.last_blocking_reason ?? 'Needs operator attention'
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6">
        <FileTable
          files={files}
          onUpload={(fileId) => uploadMutation.mutate(fileId)}
          pendingId={uploadMutation.isPending ? uploadMutation.variables : null}
          columnVisibility={COLUMN_VISIBILITY}
        />
      </div>
    </main>
  )
}
