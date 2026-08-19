# hts-manager — Implementation Plan

## Context

A short-lived internal tool to help a lab get sequencing reads into Virtool's
preview instance. Someone points the tool at a directory full of `*.fq.gz`
files, the tool indexes them (name, size, and a best-effort Illumina run date
peeked from each file), and presents a searchable list behind a shared PIN.
Each file row has a one-click **Upload** button that queues the file; a
background worker uploads queued files one at a time to `preview.virtool.ca`,
survives restarts (resuming incomplete/queued work), and marks each file
`uploaded` on success.

This is intentionally minimal: no user accounts (one global PIN), credentials
and config come from env vars.

### Confirmed decisions
- **Framework:** TanStack Start (server functions + TanStack Query, no separate REST layer).
- **Two in-process background tasks:** the server process runs a **scanner** and an **uploader**, each a guarded singleton loop. Scanning indexes the target dir (on startup and on manual "Scan now"); uploading drains the queue. (A standalone `scan` CLI is kept as an optional convenience but is no longer the primary path.)
- **Status indicators:** the top bar shows a **scanning indicator** (spinner + progress while a scan runs) and an **upload activity indicator** (current file + queue depth). Both driven by polling a single `getStatus` server function.
- **Re-scan:** insert new files, leave existing rows untouched (preserve flags); rows whose files have disappeared under the scanned root are flagged `missing = 1` (re-appearing clears it).
- **Upload UI:** per-file button only, no bulk actions.
- **All metadata comes from the run-folder name + filename — no file peeking.** The **Illumina run-folder name** is the source of truth: a full name `230615_A00123_0456_BHGV7DSX3` yields date (`2023-06-15`), instrument (`A00123`), run number (`0456`), and flowcell (`BHGV7DSX3`); a stripped name `230615` yields only the date (instrument/run/flowcell null). Lane comes from the FASTQ **filename** (`..._L001_...` → `L001`). The slow gunzip-and-read-header peek is dropped — scanning is pure path parsing + `fs.stat` for size. mtime (filesystem **and** gzip-header) is rejected as a source: this data has been copied/reorganized, so neither reflects the run.
- **Run folder gates indexing.** A file is indexed only if it lives under a directory whose name matches the run-folder pattern (`/^(\d{6})(_|$)/`, date calendar-validated). Files with no matching run-folder ancestor are **skipped, not indexed** — the user maintains the tree so run folders conform. `run_date` is therefore **NOT NULL**.

## Verified facts (Virtool upload protocol, from github.com/virtool/uploader)
- Single `POST` to a full upload URL (no chunking, no server-side resume).
- Auth: HTTP Basic — `Authorization: Basic base64(user_handle:api_key)`.
- Query params: `name=<filename>`, `type=reads`.
- Body: `multipart/form-data`, field name `file`.
- Success = HTTP `201`. "Resume" therefore means re-POSTing an interrupted file whole.

## Tech stack
- TanStack Start (React 19, TanStack Router + Query), TypeScript, Vite.
- `better-sqlite3` (synchronous, no native-build surprises on Node 24) for SQLite.
- `zod` for server-fn input validation.
- `form-data` + `undici` for streaming multipart upload (avoids loading whole fastq into memory).
- `commander` (or `node:util` parseArgs) for the CLI.
- **Radix UI primitives + shadcn/ui** for all UI components (Button, Input, Badge, Table, Spinner, etc.). Tailwind CSS v4.
- pnpm.

## Configuration (env vars)
| Var | Purpose | Default |
|---|---|---|
| `HTSM_PIN` | shared access PIN | (required) |
| `HTSM_SESSION_SECRET` | HMAC secret for the session cookie | (required) |
| `HTSM_DB_PATH` | SQLite file path | `./hts-manager.db` |
| `VT_UPLOAD_URL` | full upload endpoint | `https://preview.virtool.ca/api/uploads` |
| `VT_UPLOAD_USER_HANDLE` | Virtool username | (required for upload) |
| `VT_UPLOAD_API_KEY` | Virtool PAT | (required for upload) |
| `VT_UPLOAD_FILE_TYPE` | `type` query param | `reads` |

Scan/serve target directory is a CLI arg (`scan <path>` / `serve <path>`), falling back to `HTSM_SCAN_PATH`.

## Data model — `files` table
```
id              INTEGER PK
path            TEXT UNIQUE         -- absolute path
name            TEXT
size            INTEGER             -- bytes
run_date        TEXT NOT NULL       -- ISO date (YYYY-MM-DD) parsed from run-folder name; files without a parseable run folder are skipped, not indexed
run_folder      TEXT                -- the run-folder segment the metadata came from, for provenance
instrument      TEXT                -- from full run-folder name (null for date-only folders)
run_number      TEXT                -- from full run-folder name (null for date-only folders)
flowcell        TEXT                -- from full run-folder name (null for date-only folders)
lane            TEXT                -- from the filename (_L00N_), null if absent
missing         INTEGER DEFAULT 0   -- file gone on last scan
upload_requested INTEGER DEFAULT 0  -- button pressed
uploaded        INTEGER DEFAULT 0
upload_status   TEXT DEFAULT 'idle' -- idle | queued | uploading | uploaded | error
upload_error    TEXT
uploaded_at     TEXT
first_seen_at   TEXT
last_scanned_at TEXT
```
Indexes on `name`, `run_date`, `upload_requested`, `uploaded`.

## Project structure
```
package.json, tsconfig.json, vite.config.ts, app.config.ts   # TanStack Start scaffold
src/
  db/
    schema.ts          # open better-sqlite3, CREATE TABLE IF NOT EXISTS, migrations
    queries.ts         # typed query helpers (list/search, requestUpload, claimNext, markUploaded...)
  scan/
    parse.ts           # pure run-folder-name + filename parsing (date/instrument/run/flowcell/lane), no file reads
    scan.ts            # walk run folders under root, INSERT OR IGNORE, flag missing (pure, reusable)
  cli.ts               # `serve <path>` (primary) + optional `scan <path>` -> bin
  server/
    auth.ts            # PIN check, signed-cookie issue/verify, authMiddleware
    scanner.ts         # background scan singleton + live scan state
    uploader.ts        # background upload singleton + live upload state
    status.ts          # combined status snapshot (scanner + uploader)
    bootstrap.ts       # guarded ensureWorkersStarted() (scanner + uploader)
  functions/
    auth.fn.ts         # login({pin}) / logout / me
    files.fn.ts        # listFiles({q,limit,offset}) / requestUpload({id})  (authMiddleware)
    status.fn.ts       # getStatus() / requestScan()  (authMiddleware)
  routes/
    __root.tsx         # renders <TopBar/> (polls getStatus) around the outlet
    login.tsx          # PIN entry form
    index.tsx          # protected file list + search + upload buttons
  components/
    TopBar.tsx, ScanIndicator.tsx, UploadIndicator.tsx
    FileTable.tsx, StatusBadge.tsx, SearchBar.tsx
    ui/                 # shadcn/ui generated components (button, badge, input, table, spinner…)
  lib/format.ts        # humanFileSize, formatDate
```

## Implementation steps

Progress: **steps 1–7 done** (scaffold, DB layer, parse, scan core + scanner
worker, auth, background uploader + worker bootstrap, status function). Next:
**step 8** (file list UI + top bar).

### 1. Scaffold ✅ done
`npx @tanstack/cli@latest create` (TS, pnpm), strip demo content. Add deps:
`better-sqlite3 zod form-data undici commander`, dev `@types/better-sqlite3`.
Add bin entry in `package.json` (`"hts-manager": "dist/cli.js"`) and scripts: `dev`, `build`, `start`, `scan`.

### 2. DB layer (`src/db/db.ts`, `files.ts`, `runs.ts`, `queries.ts`) ✅ done
- `getDb()` (not `openDb()`) opens `HTSM_DB_PATH`, sets `PRAGMA journal_mode = WAL` (+ `foreign_keys = ON`), creates the table + indexes if absent. Single shared module-level instance (server + CLI both import it). `FileRow`/`UploadStatus` types live alongside the schema.
- Query helpers in `queries.ts` (better-sqlite3 caches prepared statements, so they prepare inline):
  - `insertIfNew(file)` — `INSERT OR IGNORE`, stamps `first_seen_at`/`last_scanned_at`; returns whether a row was added.
  - `flagMissingExcept(root, seenPaths)` — single helper covering both "mark seen" and "flag missing": seen paths → `missing=0`, under-`root`-but-unseen → `missing=1`, both re-stamped; returns the new missing count. Uses a **temp table** of seen paths (scales past SQLite's bound-param limit) and **`substr(path,1,len)=prefix`** prefix-equality (not `LIKE`) so separators / `_` / `%` in `root` match literally.
  - `searchFiles({q,limit,offset})` + `countFiles({q})` — `WHERE name LIKE ? ESCAPE '\' AND missing=0`, newest run first; `q` metacharacters escaped so they match literally.
  - `getAggregateCounts()` — one-pass `{total, uploaded, queued, missing, errors}` for the status bar.
  - `requestUpload(id)` (set `upload_requested=1, upload_status='queued'`, clear prior error; no-op once uploaded), `claimNext()` (interrupted `uploading` first, else oldest `queued`/`error` requested-not-uploaded; returns one row or `undefined`), `setUploading`/`markUploaded`/`markError`.
- Verified: `pnpm typecheck` clean + a throwaway smoke test exercising every helper against a real SQLite DB.

### 3. Parse (`src/scan/parse.ts`) — pure string parsing, no file reads ✅ done
- `parseRunFolder(segment)`: test `/^(\d{6})(?:_(.+))?$/`. Interpret the 6 digits as `YYMMDD`, calendar-validate (month `01–12`, day `01–31`; reject otherwise so stray 6-digit dirs don't match), century pivot (`00–69` → 20xx, `70–99` → 19xx). If a tail follows the date, split it on `_` → `{ instrument, run_number, flowcell }` (best-effort; tolerate extra trailing fields). Returns `{ run_date: 'YYYY-MM-DD', instrument?, run_number?, flowcell? }`, or `null` if the segment isn't a run folder.
- `parseLane(filename)`: match `/_L(\d{3})_/` → `L###`, else null.
- `deriveRecord(path)`: pick the matching run-folder segment (per the walk in step 4), merge `parseRunFolder(segment)` + `parseLane(basename)` + `fs.stat` size + `run_folder = <segment>` into a record. No gunzip, no stream — fast.

### 4. Scan core + scanner worker (`src/scan/scan.ts`, `src/server/scanner.ts`) ✅ done
- **Pure scan (`scan.ts`)** — `runScan(root, onProgress?)`:
  - **Run folders are the direct children of `<root>`.** `fs.readdir(root)`; for each top-level **directory**, test its name with `parseRunFolder`. **No match → skip the whole subtree** (the user renames non-conforming folders). Match → it's a run folder: recurse fully inside it (its internal layout varies by NextSeq 500/1000) collecting files matching `/\.f(ast)?q\.gz$/i`, and derive every file's metadata from **this** run-folder segment + the filename. Files sitting loose at `<root>` (not inside a run folder) are skipped — no `run_date`, so they can't be indexed.
  - For each collected file: if path not in DB → `deriveRecord(path, runFolderSegment)` + `insertIfNew`. If already present → skip (untouched). Collect all seen paths; call `onProgress({processed, added})` periodically.
  - After walk: `flagMissingExcept(root, seenPaths)` sets `missing=1` for rows under `root` not seen, clears `missing=0` for seen ones.
  - Returns `{added, skipped, missing}`. Reused by both the worker and the optional CLI.
- **Scanner worker (`scanner.ts`)** — a singleton holding live state `{ scanning, startedAt, processed, added, finishedAt, lastResult, error }`:
  - `requestScan()`: if not already scanning, kick off `runScan(HTSM_SCAN_PATH, updateState)`; ignore if a scan is in flight (returns "already running"). Errors are captured into state, not thrown.
  - Runs one scan automatically on server startup (if `HTSM_SCAN_PATH` is set).
  - `getScanState()` returns the current snapshot for the status function.

### 5. Auth (`src/server/auth.ts`, `functions/auth.fn.ts`, `routes/login.tsx`)
- `login({pin})` server fn: constant-time compare to `HTSM_PIN`; on match set httpOnly cookie `htsm_session = <value>.<HMAC(value, HTSM_SESSION_SECRET)>` via TanStack Start's `setCookie`/`getWebRequest` helpers.
- `authMiddleware` (`createMiddleware`): read + verify cookie HMAC; throw redirect/401 if invalid. Applied to every data server fn.
- `__root`/`index` loader checks `me()`; unauthenticated → redirect to `/login`. `login.tsx` is a simple PIN form (mutation → on success `router.navigate('/')`).

### 6. Background uploader + worker bootstrap (`src/server/uploader.ts`, `bootstrap.ts`) ✅ done
- **Uploader (`uploader.ts`)** — a singleton loop plus live state `{ uploading, currentId, currentName, queued, errors }`:
  - Loop: `claimNext()`; if none, wait ~3 s and repeat. If a row: `setUploading` + update state, build `form-data` with `fs.createReadStream(path)` as field `file`, `undici.request(VT_UPLOAD_URL, { method:'POST', query:{name,type}, headers:{ Authorization: Basic..., ...form.getHeaders() }, body: form })`. `201` → `markUploaded` (`uploaded=1, upload_status='uploaded', uploaded_at`). Otherwise `markError` (keep `upload_requested=1` for retry; exponential-ish backoff before re-claiming the same errored row).
  - Strictly one upload at a time (the loop is serial). On restart, an interrupted `uploading` row is re-claimed first and re-POSTed whole (Virtool has no resumable upload) — satisfies "resumes incomplete or next upload".
  - `queued`/`errors` counts come from cheap `COUNT(*)` DB queries so the indicator stays accurate even across restarts.
- **Bootstrap (`bootstrap.ts`)** — `ensureWorkersStarted()`, guarded by `globalThis.__htsmWorkersStarted` so it runs exactly once per server process. Starts the **scanner** and the **uploader** loops (and the startup scan). Called from the root route's server loader / first authed fn; safe to call repeatedly.

### 7. Status function (`src/server/status.ts`, `functions/status.fn.ts`) ✅ done
- `getStatus()` (authed server fn) returns a single snapshot: `{ scan: getScanState(), upload: getUploadState() }` plus aggregate counts (total files, uploaded, queued, missing) and `lastScanFinishedAt`.
- `requestScan()` (authed server fn) calls the scanner's `requestScan()` and returns whether a scan was started or one was already running.

### 8. File list UI + top bar (`routes/__root.tsx`, `routes/index.tsx`, components)
- **Top bar (`TopBar.tsx`)**, rendered by `__root.tsx`, polls `getStatus` via TanStack Query (`refetchInterval: 2000`):
  - `ScanIndicator` — spinner + "Scanning… (N indexed, M new)" while `scan.scanning`, otherwise "Last scan: <time>"; includes a **Scan now** button (`requestScan` mutation, disabled while scanning).
  - `UploadIndicator` — spinner + "Uploading <name> · K queued" while `upload.uploading`, "K queued" when work is pending, an error chip when `errors > 0`, and "Idle / All uploaded" otherwise.
- **File list (`index.tsx`)**: `listFiles` query with `refetchInterval: 3000` so per-row status surfaces without manual refresh.
  - `SearchBar` (debounced) uses shadcn `Input`; drives the `q` param; server-side `LIKE` search + pagination.
  - `FileTable`: shadcn `Table`; columns name, human size, run date, instrument/flowcell, `StatusBadge` (shadcn `Badge`), and an **Upload** shadcn `Button`.
  - Button → `requestUpload` mutation → invalidate `listFiles`. Button disabled/hidden when `uploaded` or status `queued`/`uploading`; `error` shows a retry.

### 9. Serve command + docs
- `cli.ts serve <path>` sets `HTSM_SCAN_PATH` and starts the TanStack Start server (`node .output/server/index.mjs` in prod, or `vite dev` in dev). The startup scan then runs automatically in-process.
- Optional `cli.ts scan <path>` still calls `runScan` directly for a headless one-off (prints the summary), sharing the exact same core.
- `README.md`: env vars, the `serve` workflow (scan happens in-app), the run-date caveat, and the "whole-file re-POST on resume" note.

## Verification (end-to-end)
1. Create gzipped files under run-folder-named dirs that are **direct children** of the scan root (file *contents* are irrelevant now — nothing is decompressed — but the run-folder name and the filename's `_L00N_` matter).  Real NextSeq 500 runs put FASTQ files in a `fastq/` subdirectory; the scanner's layout-agnostic walk finds them regardless of nesting depth:
   ```
   # Full run-folder name — exercises instrument/run/flowcell + lane parsing
   mkdir -p /tmp/reads/150106_NS500598_0004_AH2NH3BGXX/fastq
   touch /tmp/reads/150106_NS500598_0004_AH2NH3BGXX/fastq/GV1_S1_L001_R1_001.fastq.gz
   # Lane-less file in the same run folder — exercises lane = null (merged/combined outputs)
   touch /tmp/reads/150106_NS500598_0004_AH2NH3BGXX/fastq/GV1_S1_R1_001.fastq.gz
   # Date-only folder — exercises stripped run-folder name
   mkdir -p /tmp/reads/230616
   touch /tmp/reads/230616/y_S2_L002_R1_001.fastq.gz
   # Loose file at root — must be skipped (no run folder)
   touch /tmp/reads/orphan.fastq.gz
   ```
2. Start the app pointed at the dir, e.g. `HTSM_DB_PATH=/tmp/htsm.db HTSM_SCAN_PATH=/tmp/reads HTSM_PIN=1234 HTSM_SESSION_SECRET=dev VT_UPLOAD_USER_HANDLE=... VT_UPLOAD_API_KEY=... pnpm dev`.
3. Auth: wrong PIN rejected, correct PIN reaches the list.
4. Scanner: the startup scan runs in-process — the **top-bar scanning indicator** shows progress then "Last scan: <time>". Two rows appear for `150106_NS500598_0004_AH2NH3BGXX`: one with `run_date = 2015-01-06`, instrument `NS500598`, run `0004`, flowcell `AH2NH3BGXX`, lane `L001`; the other with the same run metadata but `lane = null` (the merged file). The date-only row shows `run_date = 2023-06-16`, lane `L002`, and null instrument/run/flowcell. The loose `orphan.fastq.gz` is **not** indexed. Click **Scan now** → indicator re-activates; with no new files it reports "0 added". Delete a file, **Scan now** again → its row flagged `missing` and drops from the default list.
5. Upload: search filters by name; click **Upload** → row status goes `queued → uploading → uploaded` while the **top-bar upload indicator** shows the current file + queue depth. Point `VT_UPLOAD_URL` at a throwaway local endpoint (a tiny script returning 201) to validate the multipart POST shape (`name`/`type` query, Basic auth, `file` field) before touching the real instance; then run once against `preview.virtool.ca` with real creds.
6. Restart the server mid-upload → confirm the interrupted file re-uploads and ends `uploaded`; already-uploaded files are not re-sent.
7. Optional headless check: `HTSM_DB_PATH=/tmp/htsm.db pnpm scan /tmp/reads` prints the same add/skip/missing summary via the shared core.

## Notes / things to flag
- TanStack Start server functions are request-scoped, so the worker lives as a guarded singleton outside them (step 6); if a more formal boot hook is preferred, the same `ensureUploaderStarted()` can move into a Nitro startup plugin.
- Matches both `.fastq.gz` and `.fq.gz` (NextSeq output is `.fastq.gz`). Real NextSeq 500 runs place FASTQ files in a `fastq/` subdirectory; the layout-agnostic recursive walk finds them regardless. Run folders must be **direct children of the scan root**; top-level dirs that don't match the run-folder pattern are skipped wholesale — the user keeps the tree conforming.
- Some run outputs produce both per-lane files (`sample_S1_L001_R1_001.fastq.gz`, `…_L002_…`, etc.) and a merged/combined file for the same sample (`sample_S1_R1_001.fastq.gz` with no `_L00N_` token). Each is indexed independently; `lane` is `null` for merged files. This is normal and expected from NextSeq 500 demultiplexing.
- Instrument IDs vary by platform: `NS500598` (NextSeq 500), `A00123` (NovaSeq), etc. All parse identically — the tail after the 6-digit date is split on `_` into instrument / run_number / flowcell.
- All metadata (date, instrument, run, flowcell, lane) is parsed from the **run-folder name + filename** — no file is decompressed, so scanning is fast. mtime is unusable (data copied/reorganized). A file with no parseable run folder has no `run_date` (NOT NULL) and is **skipped, not indexed** — documented in the README so missing files are understood as "not under a recognized run folder," not lost.
