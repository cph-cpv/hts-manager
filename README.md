# hts-manager

hts-manager is an internal tool for managing Illumina sequencing output. It
indexes compressed FASTQ files, provides searchable run and file views, and
supports downloads and uploads to Virtool. It can also copy completed runs from
sequencer storage and maintain a stable FASTQ view for CLC users.

## Getting started

hts-manager requires Node.js 24 and pnpm.

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Fill in the required values in `.env`, then open <http://localhost:3000>. Set
`HTSM_SECURE=false` when developing over plain HTTP.

For production:

```bash
pnpm build
pnpm start
```

### Docker test environment

To run the app with local fixture data and temporary storage:

```bash
docker compose -f compose.test.yaml up --build
```

Open <http://localhost:3000> and log in with the PIN `test`. Data is discarded
when the container stops.

## Configuration

Configuration is provided through environment variables. Copy
[`.env.example`](./.env.example) to `.env` for a complete template.

| Variable | Default | Description |
| --- | --- | --- |
| `HTSM_PIN` | Required | Shared access PIN. |
| `HTSM_SESSION_SECRET` | Required | Secret used to protect login sessions. Use a long random value. |
| `HTSM_SECURE` | `true` | Set to `false` only when serving over plain HTTP. |
| `HTSM_DB_PATH` | `./hts-manager.db` | SQLite database path. |
| `HTSM_SCAN_PATH` | — | Directory containing Illumina runs. |
| `HTSM_FASTQ_SYMLINK_PATH` | — | Optional absolute directory for the CLC FASTQ view. Requires `HTSM_SCAN_PATH`. |
| `HTSM_TRANSFER_SOURCE_PATH` | — | Optional absolute sequencer-output directory. Enables automatic transfer into `HTSM_SCAN_PATH`. |
| `VT_UPLOAD_URL` | `https://preview.virtool.ca/api/v1/uploads` | Virtool upload endpoint. |
| `VT_UPLOAD_USER_HANDLE` | — | Virtool username. Required for uploads. |
| `VT_UPLOAD_API_KEY` | — | Virtool personal access token. Required for uploads. |
| `VT_UPLOAD_FILE_TYPE` | `reads` | Virtool upload type. |

## Scanning and transfer

When `HTSM_SCAN_PATH` is configured, hts-manager scans it automatically and
provides a **Scan now** action for on-demand updates.

Set `HTSM_TRANSFER_SOURCE_PATH` to copy completed runs from sequencer output
into `HTSM_SCAN_PATH`. The source and destination directories must already
exist, must not overlap, and must both be mounted into the container when using
Docker. Transfers resume after restarts, and source data is retained. Problems
that need operator attention are shown as **Blocked**.

Set `HTSM_FASTQ_SYMLINK_PATH` to maintain a CLC-compatible view of the FASTQ
files in `HTSM_SCAN_PATH`. The view is updated automatically as runs and
analyses change.

## Development

```bash
pnpm typecheck
pnpm test
```
