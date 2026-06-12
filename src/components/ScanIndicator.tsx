import { RefreshCwIcon } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { Spinner } from '~/components/ui/spinner'
import { formatTime } from '~/lib/format'
import type { ScanState } from '~/server/scanner'

/**
 * Scan status + "Scan now" button. Shows live progress while a scan runs,
 * otherwise the last-scan time (or an error). The button is disabled mid-scan.
 */
export function ScanIndicator({
  scan,
  lastScanFinishedAt,
  onScanNow,
  scanPending,
}: {
  scan: ScanState
  lastScanFinishedAt: string | null
  onScanNow: () => void
  scanPending: boolean
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {scan.scanning ? (
        <span className="flex items-center gap-2 text-muted-foreground">
          <Spinner className="size-4" />
          Scanning… ({scan.processed} indexed, {scan.added} new)
        </span>
      ) : scan.error ? (
        <span className="text-destructive">Scan failed: {scan.error}</span>
      ) : (
        <span className="text-muted-foreground">
          Last scan: {formatTime(lastScanFinishedAt)}
        </span>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onScanNow}
        disabled={scan.scanning || scanPending}
      >
        <RefreshCwIcon />
        Scan now
      </Button>
    </div>
  )
}
