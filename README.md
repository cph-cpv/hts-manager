# hts-manager

An internal tool for managing Illumina sequencing run output and getting reads
into Virtool. Point it at a directory of Illumina run folders; it indexes the
`*.fastq.gz` / `*.fq.gz` files (name, size, and run metadata parsed from the
run-folder name + filename), and presents searchable file and run views behind a
shared PIN. Files can be downloaded or queued individually for upload, and all
currently indexed files in a run can be queued together. A background worker
uploads queued files one at a time to Virtool, survives restarts, and marks each
file `uploaded` on success. `Undetermined_*` files are hidden from the file view
by default and can be shown with its **Undetermined** toggle.

Originally scoped as a short-lived internal tool, hts-manager is now on a path
to become a production service for the sequencing pipeline — see
[Roadmap](#roadmap) for where it's headed.

## Stack

TanStack Start (React 19, Router + Query), TypeScript, Vite, better-sqlite3,
zod, undici, Tailwind CSS v4 + shadcn/ui. Package manager: pnpm.
Node 24.

## Getting started

```bash
pnpm install
cp .env.example .env   # fill in HTSM_PIN, HTSM_SESSION_SECRET, HTSM_SCAN_PATH, VT_* creds
pnpm dev               # http://localhost:3000

# production
pnpm build && pnpm start
```

Scans of `HTSM_SCAN_PATH` run as persisted background jobs. When configured, the
app queues a scan on boot if none has finished in the last hour and continues
that hourly schedule afterward. The top bar shows queued/scanning and upload
activity; **Scan now** queues a scan on demand.

### Disposable Docker test environment

The test Compose configuration mounts local fake sequencer output from
`test/input` and keeps both the destination files and SQLite database in the
same container-local tmpfs:

```bash
docker compose -f compose.test.yaml up --build
```

Open <http://localhost:3000> and log in with the test PIN `test`. The `test/`
directory is ignored by Git, so local fixture data is never committed. The
database and transferred output are both discarded when the test container is
stopped.

## Configuration

All configuration is via env vars — see [`.env.example`](./.env.example); there
are no CLI options. Required to boot are `HTSM_PIN` and `HTSM_SESSION_SECRET`;
the `VT_UPLOAD_*` credentials are only validated once an upload actually runs.

### Access

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `HTSM_PIN` | Yes | — | Shared access PIN. Anyone who knows it gets a signed session cookie. Compared in constant time. |
| `HTSM_SESSION_SECRET` | Yes | — | HMAC-SHA256 secret used to sign the session cookie. Use a long random string. |

### Storage

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `HTSM_SCAN_PATH` | No | _(unset)_ | Directory of Illumina run folders to scan. If unset, no scans are scheduled; existing database records remain available. |
| `HTSM_FASTQ_SYMLINK_PATH` | No | _(unset)_ | Absolute destination for the reconciled FASTQ symlink tree. Set to `/mnt/raw/fastq` in production. Requires `HTSM_SCAN_PATH`. |
| `HTSM_DB_PATH` | No | `./hts-manager.db` | Path to the better-sqlite3 database file. |

### FASTQ symlinks for CLC

Set `HTSM_FASTQ_SYMLINK_PATH=/mnt/raw/fastq` to give CLC users a stable view of
the FASTQ files under `HTSM_SCAN_PATH`. An in-process worker reconciles the view
at startup and every 30 seconds. Every direct source directory gets a
destination run directory, even if it has no eligible files.

For NextSeq 500 runs, files directly under `<run>/fastq` are linked into the
destination run directory. For NextSeq 1000 runs, files directly under
`<run>/Analysis/<analysis>/Data/fastq` are linked into the run directory when
there is one analysis; multiple analyses get real `<analysis>` subdirectories.
Only `.fastq.gz` and `.fq.gz` regular files are linked, and every link has an
absolute target.

The destination is managed from source state: stale, broken, and incorrect
symlinks are removed or replaced, while correct links are left untouched. Empty
directories and directories containing only managed symlinks may also be
removed as layouts change. Reconciliation refuses to modify a tree containing
regular files or other unexpected entries, preserving them and logging an
error for the operator to resolve.

### Transfer from sequencer output

hts-manager provides automated transfer of completed Illumina run folders from
a sequencer-output directory to `HTSM_SCAN_PATH`, the central storage directory
it scans for sequencing data. Set
`HTSM_TRANSFER_SOURCE_PATH` to the sequencer-output directory to configure the
source. hts-manager discovers immediate child directories with valid Illumina
run-folder names and registers them for managed transfer. A run becomes ready
when it has an exact, root-level regular file named `CopyComplete.txt`; other
completion metadata and nested markers do not qualify. Ready runs are copied
automatically into `HTSM_SCAN_PATH`, preserving their original folder names and
directory trees except the root `Analysis/` folder. Completed analysis trees are
copied separately and indexed directly, so their FASTQs become uploadable
without waiting for a global scan.

Source run folders are retained. `HTSM_TRANSFER_REMOVE_AFTER_DAYS` reserves
retention configuration for the later source-removal implementation; copying
never deletes source data.

Both directories must already exist, the source must be an absolute path, and
the source and destination must be distinct and not nested inside each other.
Discovery, readiness detection, and copying run automatically when transfer is
enabled. Source removal is not implemented.

Copying runs serially in the background using **rsync**, which is included in
the Docker image. Install rsync on the host when running outside Docker.
Base-run copies and per-analysis transfers use separate `copy-run` and
`copy-analysis` jobs. Each analysis job targets one durable analysis row, so a
failure does not prevent sibling analyses from progressing. Temporary
filesystem/NFS failures and rsync transfer failures retry on the next polling
pass; rsync's partial-transfer errors can
also indicate issues such as permissions, so repeated failures require
inspecting the error message. A process restart marks interrupted job attempts
as failed, then queues fresh work. If the prior attempt had already published
its base-run directory, the new job verifies that directory against the source
and records the run as transferred. Otherwise, it discards the
application-owned staging directory and starts the entire copy again.

Run discovery also records every immediate, non-hidden
`<run>/Analysis/<analysis>/` directory. An exact, regular `report.html` at the
analysis root is the sole completion indicator. Completed analyses become
eligible after their parent base run is transferred. Existing destinations are
verified before acceptance, and interrupted work resumes from durable state.

Runs and analyses have separate backing state machines:

```text
source run: running → run_complete → transferred → source_deleted
                               ↘ blocked → run_complete
manual run:  manually_copied

analysis: running → analysis_complete → transferred → indexed
                              ↘ blocked → analysis_complete
                                            ↑
                              transferred → blocked

destination analysis discovered by scan: indexed
                                  conflict: blocked
```

`source_deleted` and blocked-state recovery are represented for future work;
this release does not delete sources or expose managed-transfer recovery
controls. The scan job indexes newly discovered destination analyses directly;
empty analysis directories are ignored until FASTQs appear, and indexed
analyses do not regress when individual files become missing. The UI derives
the operator statuses **Running**, **Transferring**, **Ready**, and **Blocked**
from durable state plus waiting/running jobs. A run with at least one indexed
analysis remains Ready while later analyses transfer or need attention.

Reserved `.htsm-copy-<run-id>.partial` and
`.htsm-analysis-<analysis-id>.partial`
directories under `HTSM_SCAN_PATH` hold unfinished copies. Both file scanning
and FASTQ symlink reconciliation ignore these directories. Successful copies
are verified and published by renaming the whole staging directory. The
application refuses publication when the destination already exists. Staging
and the final destination must be on the same filesystem; cross-mount
publication fails without a copying fallback. An existing base-run folder is
accepted only when its inventory matches the source (excluding `Analysis/`);
otherwise it is a conflict. An existing analysis directory is accepted only
after its inventory matches the source; the parent `Analysis/` folder may exist.

Destination conflicts, verification failures, and unsupported source entries
(including symbolic links) put the base-run transfer in `Blocked` and stop its
automatic attempts. An analysis failure does not change the base run's status
or block sibling analyses from being copied. Permanent analysis conflicts,
invalid ownership, and completed analyses with no FASTQs block that analysis;
transient copy, NFS, and database failures leave it eligible for a later
attempt. Rediscovery and restarting do not reset blocked entities.

Verification compares relative paths, entry types, and file sizes, not file
contents. Same-size corruption is not detected; checksum verification is
deferred to source removal. The base-run inventory excludes `Analysis/`, so
ongoing analyses cannot invalidate its verification. Analysis publication
indexes regular `.fastq.gz` and `.fq.gz` files in one transaction, attaching
them to both their run and analysis while preserving existing upload history.
The full scheduled scanner remains responsible for manual runs and missing-file
reconciliation. Run only one hts-manager server process against a database.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `HTSM_TRANSFER_SOURCE_PATH` | No | — | Absolute source directory containing sequencer-side run folders. Setting it enables managed transfer. |
| `HTSM_TRANSFER_REMOVE_AFTER_DAYS` | No | _(unset)_ | Reserved retention setting for future source removal; currently no source files are deleted. |

### Virtool upload target

These are only read when an upload runs. `VT_UPLOAD_USER_HANDLE` and
`VT_UPLOAD_API_KEY` must both be set or the upload throws.

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `VT_UPLOAD_URL` | No | `https://preview.virtool.ca/api/uploads` | Endpoint the uploader `POST`s each file to. |
| `VT_UPLOAD_USER_HANDLE` | To upload | — | Virtool username, sent as HTTP Basic auth user. |
| `VT_UPLOAD_API_KEY` | To upload | — | Virtool personal access token, sent as HTTP Basic auth password. |
| `VT_UPLOAD_FILE_TYPE` | No | `reads` | Value of the `type` query param on the upload request. |

### Runtime

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `HTSM_SECURE` | No | `true` | Controls the `Secure` flag on the session cookie. Set to `false` only when serving over plain HTTP (e.g. by IP on a trusted, cert-less network) — browsers silently drop `Secure` cookies set over non-HTTPS connections, which otherwise makes the PIN login appear to silently fail. |

## How metadata is derived

Everything is parsed from the **run-folder name + filename** — no file is
decompressed, so scanning is fast.

- A run folder is a **direct child of the scan root** whose name matches the
  Illumina pattern (`230615_A00123_0456_BHGV7DSX3` → date `2023-06-15`,
  instrument `A00123`, run `0456`, flowcell `BHGV7DSX3`). The date must be
  followed by a full instrument/run/flowcell tail; partial names like `230615`
  or `230615_A00123` do not match.
- Lane comes from the filename `_L00N_` token (null for merged outputs).
- Top-level directories that don't match the run-folder pattern are **skipped
  wholesale**, as are files not under a recognized run folder — keep the tree
  conforming. Such files are *not lost*, just not indexed.
- Within each recognized run, every non-hidden immediate directory at
  `Analysis/<analysis>/` that contains a regular `.fastq.gz` or `.fq.gz` file is
  recorded and indexed as an analysis. FASTQs are found recursively below the
  analysis directory and linked to both the run and analysis; this scan-path
  discovery does not require a `report.html` marker. The generic recursive walk
  skips the entire top-level `Analysis` subtree, so these files cannot fall back
  to run-only ownership. FASTQs elsewhere in the run remain discoverable with
  run ownership only.
- mtime is intentionally ignored: this data has been copied/reorganized, so
  neither filesystem nor gzip-header mtime reflects the actual run date.

## Upload protocol

A single `POST` to `VT_UPLOAD_URL` (no chunking, no server-side resume): HTTP
Basic auth, `name`/`type` query params, and the raw file as an
`application/octet-stream` request body with an explicit `Content-Length`.
Success = HTTP `201`. "Resume" therefore means re-POSTing an interrupted file
whole on restart.

## Project status

The application includes run-folder and filename parsing, persisted scanning
and transfer jobs, automatic copying of completed runs and analyses, optional
FASTQ symlink reconciliation, single-PIN authentication, serial Virtool
uploads, file downloads, and file/run views with transfer and worker status.
Source removal, automatic upload tagging, and other production-hardening work
remain on the [Roadmap](#roadmap).

## Roadmap

Planned as hts-manager grows from a stopgap script into a production service:

- **Automatic whole-run upload to Virtool** — allow a run to be tagged for
  upload before it finishes sequencing. Manual whole-run upload of currently
  indexed files is already available.
- **`Undetermined` file exclusion from upload** — excluded by default, with a
  per-run opt-out.
- **Samplesheet parsing** — read samplesheets from run folders when present,
  to enrich run metadata.
