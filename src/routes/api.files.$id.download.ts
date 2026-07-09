/**
 * File download server route. Streams one indexed FASTQ off disk to the browser,
 * gated on the same PIN session as every data server function.
 *
 * This is a server *route* rather than a server function because `createServerFn`
 * serializes its return value and cannot carry a multi-gigabyte binary body. The
 * flip side is that {@link file://../server/auth-middleware.ts}'s `authMiddleware`
 * does not apply here — it is built with `type: 'function'` — so the handler gates
 * on `hasValidSession()` directly. That is server-only code in a server-only
 * module, so none of the client-bundle concerns that motivated the separate
 * middleware file apply.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { createFileRoute } from '@tanstack/react-router'
import { getFileById } from '../db/queries'
import { hasValidSession } from '../server/auth'

/** Plain-text response with no body caching, for the error paths. */
function fail(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

/**
 * True if `path` lives under the configured scan root. The scanner stores
 * resolved absolute paths (see `runScan`), so this is a prefix test on resolved
 * paths, terminated with a separator so `/data/runs-old` cannot pass as
 * `/data/runs`. Defense in depth: today every `files.path` comes from the
 * scanner, and this route never joins user input onto a path — but it means a
 * future writer of that column cannot turn this route into an arbitrary file read.
 */
function isUnderScanRoot(path: string): boolean {
  const root = process.env.HTSM_SCAN_PATH
  if (!root) return false
  const absRoot = resolve(root)
  const prefix = absRoot.endsWith(sep) ? absRoot : absRoot + sep
  return resolve(path).startsWith(prefix)
}

export const Route = createFileRoute('/api/files/$id/download')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        // A redirect would be useless to an `<a download>`: the browser would
        // follow it and silently save the login page's HTML to disk. Say 401.
        if (!hasValidSession()) return fail(401, 'Unauthorized')

        const id = Number(params.id)
        if (!Number.isInteger(id) || id <= 0) return fail(400, 'Invalid file id')

        const row = getFileById(id)
        if (!row) return fail(404, 'File not found')
        if (row.missing) return fail(410, 'File is no longer present on disk')
        if (!isUnderScanRoot(row.path)) return fail(403, 'Forbidden')

        // Length comes from the filesystem, not `row.size`: the DB value is only
        // as fresh as the last scan, and a Content-Length that contradicts the
        // body truncates or hangs the download.
        let size: number
        try {
          const stats = await stat(row.path)
          if (!stats.isFile()) return fail(410, 'File is no longer present on disk')
          size = stats.size
        } catch {
          return fail(410, 'File is no longer present on disk')
        }

        const body = Readable.toWeb(
          createReadStream(row.path),
        ) as ReadableStream<Uint8Array>

        return new Response(body, {
          headers: {
            'content-type': 'application/gzip',
            'content-length': String(size),
            // RFC 5987 form: names come off the filesystem and may hold quotes
            // or non-ASCII, which the bare `filename="..."` form cannot encode.
            'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,
          },
        })
      },
    },
  },
})
