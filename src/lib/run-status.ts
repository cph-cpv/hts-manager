import { deriveRunDisplayStatus, type RunDisplayStatus } from '~/db/display-status'
import type { RunState } from '~/db/runs'

type RunStatusPresentation = {
  displayStatus: RunDisplayStatus
  message: string | null
}

/** Choose browser-facing status wording from a run's complete workflow state. */
export function getRunStatusPresentation(run: RunState): RunStatusPresentation {
  const displayStatus = deriveRunDisplayStatus({
    status: run.status,
    hasIndexedAnalysis: run.indexed_analysis_count > 0,
    hasBlockedAnalysis: run.blocked_analysis_count > 0,
    hasActiveTransfer: run.active_transfer_count > 0,
  })
  const messages: string[] = []
  if (displayStatus === 'Ready' && run.active_transfer_count > 0) {
    messages.push('Transferring another analysis')
  }
  if (displayStatus === 'Ready' && run.blocked_analysis_count > 0) {
    const count = run.blocked_analysis_count
    messages.push(
      `${count} analysis${count === 1 ? '' : 'es'} ${count === 1 ? 'needs' : 'need'} attention`,
    )
  }
  return { displayStatus, message: messages.length ? messages.join(' · ') : null }
}
