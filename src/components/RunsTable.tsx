import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table'
import { formatDate } from '~/lib/format'
import type { RunSummary } from '~/db/queries'

export function RunsTable({ runs }: { runs: RunSummary[] }) {
  if (runs.length === 0) {
    return (
      <div className="rounded-md border p-8 text-center text-sm text-muted-foreground">
        No runs found. Run a scan to index sequencing data.
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Run folder</TableHead>
            <TableHead>Run date</TableHead>
            <TableHead>Instrument</TableHead>
            <TableHead>Flowcell</TableHead>
            <TableHead className="text-right">Files</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="font-medium">{run.run_folder}</TableCell>
              <TableCell>{formatDate(run.run_date)}</TableCell>
              <TableCell className="text-muted-foreground">
                {run.instrument ?? '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {run.flowcell ?? '—'}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {run.file_count}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
