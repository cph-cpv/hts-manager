import { useCallback, useState } from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'
import { createFileRoute, redirect } from '@tanstack/react-router'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { me } from '~/functions/auth.fn'
import { listFiles, listRuns, requestUpload } from '~/functions/files.fn'
import { Button } from '~/components/ui/button'
import { SearchBar } from '~/components/SearchBar'
import { FileTable } from '~/components/FileTable'
import {
  ColumnToggle,
  DEFAULT_COLUMN_VISIBILITY,
  type ColumnVisibility,
} from '~/components/ColumnToggle'
import { RunsTable } from '~/components/RunsTable'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs'

const PAGE_SIZE = 100

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const { authenticated } = await me()
    if (!authenticated) throw redirect({ to: '/login' })
  },
  component: Home,
})

function Home() {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const [includeUndetermined, setIncludeUndetermined] = useState(false)
  const [colVis, setColVis] = useState<ColumnVisibility>(DEFAULT_COLUMN_VISIBILITY)

  const onSearch = useCallback((next: string) => {
    setQ(next)
    setOffset(0)
  }, [])

  const onToggleUndetermined = useCallback((next: boolean) => {
    setIncludeUndetermined(next)
    setOffset(0)
  }, [])

  const filesQuery = useQuery({
    queryKey: ['files', q, includeUndetermined, offset],
    queryFn: () =>
      listFiles({ data: { q, includeUndetermined, limit: PAGE_SIZE, offset } }),
    refetchInterval: 3000,
    placeholderData: keepPreviousData,
  })

  const runsQuery = useQuery({
    queryKey: ['runs'],
    queryFn: () => listRuns(),
    refetchInterval: 10000,
    placeholderData: keepPreviousData,
  })

  const uploadMutation = useMutation({
    mutationFn: (id: number) => requestUpload({ data: { id } }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['files'] }),
  })

  const result = filesQuery.data
  const files = result?.files ?? []
  const total = result?.total ?? 0
  const showingTo = Math.min(offset + files.length, total)

  const runs = runsQuery.data ?? []

  return (
    <main className="mx-auto max-w-6xl px-6 py-6">
      <Tabs defaultValue="files">
        <TabsList className="mb-4">
          <TabsTrigger value="files">Files</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>

        <TabsContent value="files">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <SearchBar onSearch={onSearch} />
              <ColumnToggle visible={colVis} onChange={setColVis} />
              <Button
                type="button"
                variant={includeUndetermined ? 'secondary' : 'outline'}
                size="sm"
                aria-pressed={includeUndetermined}
                onClick={() => onToggleUndetermined(!includeUndetermined)}
              >
                {includeUndetermined ? (
                  <EyeIcon className="h-4 w-4" />
                ) : (
                  <EyeOffIcon className="h-4 w-4" />
                )}
                Undetermined
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {total === 0
                ? 'No files'
                : `Showing ${offset + 1}–${showingTo} of ${total}`}
            </p>
          </div>

          <FileTable
            files={files}
            onUpload={(id) => uploadMutation.mutate(id)}
            pendingId={uploadMutation.isPending ? uploadMutation.variables : null}
            columnVisibility={colVis}
          />

          {total > PAGE_SIZE ? (
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0}
              >
                Previous
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={offset + PAGE_SIZE >= total}
              >
                Next
              </Button>
            </div>
          ) : null}
        </TabsContent>

        <TabsContent value="runs">
          <RunsTable runs={runs} />
        </TabsContent>
      </Tabs>
    </main>
  )
}
