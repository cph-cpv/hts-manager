# hts-manager

A short-lived internal tool to get Illumina sequencing reads into Virtool's
preview instance. Point it at a directory of Illumina run folders; it indexes
the `*.fastq.gz` / `*.fq.gz` files (name, size, and run metadata parsed from the
run-folder name + filename), and presents a searchable list behind a shared PIN.
Each row has a one-click **Upload** button; a background worker uploads queued
files one at a time to `preview.virtool.ca`, survives restarts, and marks each
file `uploaded` on success.

See [`plan.md`](./plan.md) for the full design and rationale.

## Stack

TanStack Start (React 19, Router + Query), TypeScript, Vite, better-sqlite3,
zod, undici + form-data, Tailwind CSS v4 + shadcn/ui. Package manager: pnpm.
Node 24.

## Getting started

```bash
pnpm install
cp .env.example .env   # fill in HTSM_PIN, HTSM_SESSION_SECRET, HTSM_SCAN_PATH, VT_* creds
pnpm dev               # http://localhost:3000

# production
pnpm build && pnpm start
```

On boot the app scans `HTSM_SCAN_PATH` once, then keeps the file list and the two
top-bar indicators (scanning / upload activity) live; **Scan now** re-scans on
demand.

## Configuration

All configuration is via env vars — see [`.env.example`](./.env.example); there
are no CLI options. The directory to scan is `HTSM_SCAN_PATH`. Required to boot
are `HTSM_PIN` and `HTSM_SESSION_SECRET`; the `VT_UPLOAD_*` credentials are only
needed once an upload actually runs.

## How metadata is derived

Everything is parsed from the **run-folder name + filename** — no file is
decompressed, so scanning is fast.

- A run folder is a **direct child of the scan root** whose name matches the
  Illumina pattern (`230615_A00123_0456_BHGV7DSX3` → date `2023-06-15`,
  instrument `A00123`, run `0456`, flowcell `BHGV7DSX3`; a stripped `230615`
  yields only the date).
- Lane comes from the filename `_L00N_` token (null for merged outputs).
- Top-level directories that don't match the run-folder pattern are **skipped
  wholesale**, as are files not under a recognized run folder — keep the tree
  conforming. Such files are *not lost*, just not indexed.
- mtime is intentionally ignored: this data has been copied/reorganized, so
  neither filesystem nor gzip-header mtime reflects the actual run date.

## Upload protocol

A single `POST` to `VT_UPLOAD_URL` (no chunking, no server-side resume): HTTP
Basic auth, `name`/`type` query params, `multipart/form-data` with field `file`,
success = HTTP `201`. "Resume" therefore means re-POSTing an interrupted file
whole on restart.

## Project status

Feature-complete against [`plan.md`](./plan.md): DB layer, run-folder/filename
parsing, in-process scanner + uploader workers, single-PIN auth, status/file
server functions, and the file-list UI with top-bar indicators. Remaining is the
end-to-end verification pass (see the Verification section in `plan.md`).
