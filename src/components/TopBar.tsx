import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { LogOutIcon } from 'lucide-react'
import { getStatus, requestScan } from '~/functions/status.fn'
import { logout } from '~/functions/auth.fn'
import { Button } from '~/components/ui/button'
import { ScanIndicator } from '~/components/ScanIndicator'
import { UploadIndicator } from '~/components/UploadIndicator'

/** Stable query key for the status poll, shared with the mutations that invalidate it. */
export const statusQueryKey = ['status'] as const

/**
 * Top bar rendered around every authed page. Polls `getStatus` every 2 s and
 * drives the scan + upload indicators, plus the "Scan now" and sign-out buttons.
 */
export function TopBar() {
  const queryClient = useQueryClient()
  const router = useRouter()

  const statusQuery = useQuery({
    queryKey: statusQueryKey,
    queryFn: () => getStatus(),
    refetchInterval: 2000,
  })

  const scanMutation = useMutation({
    mutationFn: () => requestScan(),
    onSettled: () => queryClient.invalidateQueries({ queryKey: statusQueryKey }),
  })

  const logoutMutation = useMutation({
    mutationFn: () => logout(),
    onSuccess: async () => {
      await router.invalidate()
      await router.navigate({ to: '/login' })
    },
  })

  const status = statusQuery.data

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <span className="font-semibold">hts-manager</span>

        {status ? (
          <>
            <ScanIndicator
              scan={status.scan}
              lastScanFinishedAt={status.lastScanFinishedAt}
              onScanNow={() => scanMutation.mutate()}
              scanPending={scanMutation.isPending}
            />
            <UploadIndicator upload={status.upload} />
            <span className="text-sm text-muted-foreground">
              {status.counts.uploaded}/{status.counts.total} uploaded
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Loading status…</span>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
        >
          <LogOutIcon />
          Sign out
        </Button>
      </div>
    </header>
  )
}
