import { Badge } from '~/components/ui/badge'
import { Spinner } from '~/components/ui/spinner'
import { cn } from '~/lib/utils'
import type { UploadStatus } from '~/db/schema'

/** Map an upload status to a labelled badge for the file table. */
export function StatusBadge({ status }: { status: UploadStatus }) {
  switch (status) {
    case 'uploaded':
      return (
        <Badge className="border-transparent bg-emerald-600 text-white">
          Uploaded
        </Badge>
      )
    case 'uploading':
      return (
        <Badge variant="secondary">
          <Spinner className="size-3" />
          Uploading
        </Badge>
      )
    case 'queued':
      return <Badge variant="secondary">Queued</Badge>
    case 'error':
      return <Badge variant="destructive">Error</Badge>
    case 'idle':
    default:
      return (
        <Badge variant="outline" className={cn('text-muted-foreground')}>
          Not uploaded
        </Badge>
      )
  }
}
