import { Badge } from '~/components/ui/badge'
import { Spinner } from '~/components/ui/spinner'
import type { RunDisplayStatus } from '~/db/display-status'

/** Shared operator-facing status badge for runs and analyses. */
export function WorkflowStatusBadge({ status }: { status: RunDisplayStatus }) {
  switch (status) {
    case 'Ready':
      return (
        <Badge className="border-transparent bg-emerald-600 text-white">
          Ready
        </Badge>
      )
    case 'Blocked':
      return <Badge variant="destructive">Blocked</Badge>
    case 'Processing':
      return (
        <Badge variant="secondary">
          <Spinner className="size-3" />
          Processing
        </Badge>
      )
    case 'Sequencing':
    default:
      return <Badge variant="secondary">Sequencing</Badge>
  }
}
