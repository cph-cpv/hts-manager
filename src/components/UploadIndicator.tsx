import { CheckIcon, TriangleAlertIcon } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { Spinner } from '~/components/ui/spinner'
import type { UploadState } from '~/server/uploader'

/**
 * Upload activity indicator: current file + queue depth while uploading, a
 * "K queued" hint when work is pending, an error chip when attempts have failed,
 * and an idle state otherwise.
 */
export function UploadIndicator({ upload }: { upload: UploadState }) {
  if (upload.uploading) {
    return (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Uploading {upload.currentName ?? '…'}
        {upload.queued > 0 ? ` · ${upload.queued} queued` : null}
        {upload.errors > 0 ? (
          <Badge variant="destructive">{upload.errors} failed</Badge>
        ) : null}
      </span>
    )
  }

  return (
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      {upload.queued > 0 ? (
        <>
          <Spinner className="size-4" />
          {upload.queued} queued
        </>
      ) : upload.errors > 0 ? null : (
        <>
          <CheckIcon className="size-4" />
          Idle
        </>
      )}
      {upload.errors > 0 ? (
        <Badge variant="destructive">
          <TriangleAlertIcon className="size-3" />
          {upload.errors} failed
        </Badge>
      ) : null}
    </span>
  )
}
