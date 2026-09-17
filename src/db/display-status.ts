import type { AnalysisStatus } from './analyses'
import type { RunStatus } from './runs'

export type RunDisplayStatus = 'Sequencing' | 'Processing' | 'Ready' | 'Blocked'
export type AnalysisDisplayStatus = 'Processing' | 'Ready' | 'Blocked'

export function deriveRunDisplayStatus(input: {
  status: RunStatus
  hasIndexedAnalysis: boolean
  hasBlockedAnalysis: boolean
}): RunDisplayStatus {
  if (input.status === 'manually_copied') return 'Ready'
  if (input.hasIndexedAnalysis) return 'Ready'
  if (input.status === 'blocked' || input.hasBlockedAnalysis) return 'Blocked'
  if (input.status === 'sequencing') return 'Sequencing'
  return 'Processing'
}

export function deriveAnalysisDisplayStatus(input: {
  status: AnalysisStatus
}): AnalysisDisplayStatus {
  if (input.status === 'indexed') return 'Ready'
  if (input.status === 'blocked') return 'Blocked'
  return 'Processing'
}
