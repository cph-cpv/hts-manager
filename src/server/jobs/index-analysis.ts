import { getAnalysisWithRun, indexAnalysisFiles } from '../../db/analyses'
import { collectAnalysisFastqs } from '../../scan/analysis'

/** Permanent analysis-content or database-ownership violation. */
export class AnalysisContentError extends Error {}

/**
 * Make one published analysis uploadable in the same transaction that records
 * its indexed state. Filesystem metadata is collected before the transaction.
 */
export async function indexPublishedAnalysis(
  analysisId: number,
  publishedPath: string,
): Promise<number> {
  const analysis = getAnalysisWithRun(analysisId)
  if (!analysis) throw new AnalysisContentError(`Analysis ${analysisId} not found`)
  if (analysis.status !== 'transferred') {
    throw new AnalysisContentError(`Analysis ${analysisId} is not transferred`)
  }

  const records = await collectAnalysisFastqs(
    publishedPath,
    analysis.run.run_folder,
  )
  if (!records.length) {
    throw new AnalysisContentError(
      `Completed analysis ${analysis.analysis_folder} contains no FASTQ files`,
    )
  }

  const result = indexAnalysisFiles(analysisId, records)
  if (result.blocked) {
    throw new AnalysisContentError(
      `Analysis ${analysis.analysis_folder} contains a FASTQ owned by another run or analysis`,
    )
  }
  if (!result.handled) {
    throw new AnalysisContentError(`Analysis ${analysisId} is not indexable`)
  }
  return records.length
}
