# AGENTS.md

`CLAUDE.md` is a symlink to this file — edit `AGENTS.md`, not `CLAUDE.md`.

## Project

hts-manager: internal tool to index Illumina sequencing reads (`*.fastq.gz` /
`*.fq.gz`) from run folders and one-click upload them to Virtool. TanStack
Start (React 19, Router + Query), TypeScript, Vite, better-sqlite3, zod,
undici, Tailwind CSS v4 + shadcn/ui. Package manager: pnpm, Node 24.

See [`README.md`](./README.md) for setup/configuration and
[`plan.md`](./plan.md) for original design and rationale.

## Commands

```bash
pnpm dev          # start dev server (http://localhost:3000)
pnpm build        # production build
pnpm start        # run production build (.output/server/index.mjs)
pnpm typecheck    # tsc --noEmit
```

There is no lint or test script configured currently — rely on `pnpm typecheck`.

## TypeScript

- Prefer `type` aliases over `interface` for object shapes, using intersections
  when extending another type.
- Use `interface` only when declaration merging or module augmentation requires
  it.
- Use verb-focused function names that describe what the function does. For
  example, prefer `getRunPaths` over `runPaths`.
- Before implementing a common helper, check the relevant `utils.ts` files for
  existing shared functionality that can be reused.
- Put generally reusable functions in the appropriate `utils.ts` file when
  other parts of the codebase are likely to need the same behavior.

## Production Code and Tests

- Design core production functions around the inputs and behavior production
  actually needs. Do not add optional parameters or dependency objects solely
  to make tests easier to write.
- Keep functions in `src/db/` focused on direct database operations. Put
  externally consumed workflows in `src/functions/`, where they can compose
  database operations with validation and other application behavior.
- Keep test seams at appropriate boundaries (for example, module boundaries,
  integration tests, or focused adapters) instead of exposing test-only
  injection hooks in core production APIs.

## Layout

- `src/routes/` — TanStack Router routes/pages.
- `src/functions/` — server functions (e.g. `files.fn.ts`).
- `src/db/` — schema (`schema.ts`) and queries (`queries.ts`), better-sqlite3.
- `src/scan/` — run-folder scanning + filename/run-metadata parsing.
- `src/server/` — server-only setup (auth middleware, uploader worker).
- `src/components/` — React components, `src/components/ui/` for shadcn/ui.
- `example/` — fixture run-folder trees used to exercise `parse.ts`.

## Linear

- Team: `CPH`
- Project: `HTSM`
- Label: `HTSM`

Use this team/project/label combination when creating or updating issues for
this repo.
