import { Badge } from '~/components/ui/badge'
import { Spinner } from '~/components/ui/spinner'
import type {
  RunTransferStatus,
  TransferActivity,
} from '~/db/runs'

export function RunTransferStatusBadge({
  status,
  activity,
}: {
  status: RunTransferStatus
  activity: TransferActivity
}) {
  if (activity === 'copying') {
    return (
      <Badge variant="secondary">
        <Spinner className="size-3" />
        Transferring
      </Badge>
    )
  }

  if (activity === 'removing') {
    return (
      <Badge variant="secondary">
        <Spinner className="size-3" />
        Removing source
      </Badge>
    )
  }

  switch (status) {
    case 'detected':
      return <Badge variant="secondary">Detected</Badge>
    case 'ready':
      return <Badge variant="secondary">Awaiting transfer</Badge>
    case 'transferred':
      return (
        <Badge className="border-transparent bg-emerald-600 text-white">
          Transferred
        </Badge>
      )
    case 'removed':
      return <Badge variant="outline">Source removed</Badge>
    case 'manual':
    default:
      return <Badge variant="outline">Manual</Badge>
  }
}
