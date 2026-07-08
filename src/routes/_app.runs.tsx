import { createFileRoute } from '@tanstack/react-router'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { listRuns } from '~/functions/files.fn'
import { RunsTable } from '~/components/RunsTable'

export const Route = createFileRoute('/_app/runs')({
  component: RunsView,
})

function RunsView() {
  const runsQuery = useQuery({
    queryKey: ['runs'],
    queryFn: () => listRuns(),
    refetchInterval: 10000,
    placeholderData: keepPreviousData,
  })

  return <RunsTable runs={runsQuery.data ?? []} />
}
