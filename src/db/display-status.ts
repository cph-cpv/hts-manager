import type { AnalysisStatus } from './analyses'
import type { RunStatus } from './runs'

export type RunDisplayStatus = 'Running' | 'Transferring' | 'Ready' | 'Blocked'
export type AnalysisDisplayStatus = RunDisplayStatus

export function deriveRunDisplayStatus(input: {
  status: RunStatus
  hasIndexedAnalysis: boolean
  hasBlockedAnalysis: boolean
  hasActiveTransfer: boolean
}): RunDisplayStatus {
  if (input.status === 'manually_copied') return 'Ready'
  if (input.hasIndexedAnalysis) return 'Ready'
  if (input.status === 'blocked' || input.hasBlockedAnalysis) return 'Blocked'
  if (input.hasActiveTransfer) return 'Transferring'
  return 'Running'
}

export function deriveAnalysisDisplayStatus(input: {
  status: AnalysisStatus
  hasActiveTransfer: boolean
}): AnalysisDisplayStatus {
  if (input.status === 'indexed') return 'Ready'
  if (input.status === 'blocked') return 'Blocked'
  if (input.hasActiveTransfer) return 'Transferring'
  return 'Running'
}
