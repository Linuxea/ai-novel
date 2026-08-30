# AGENTS.md

Compact guidance for OpenCode sessions. High-signal only — read before editing.

## Commands

```bash
npm run dev              # dev server (Turbopack), http://localhost:3000
npm run build            # production build
npm run lint             # eslint + architecture import boundaries
npm run typecheck        # TypeScript
npm test                 # all Vitest regression/unit/integration/component tests
npm run test:unit        # domain + architecture tests (Node)
npm run test:integration # application + SQLite fixture tests (Node)
npm run test:component   # React component tests (jsdom)
npm run test:e2e         # Playwright E2E (opt-in; starts dev server)
npm run db:migrate       # apply generated SQLite migrations
npm run db:backup -- <path> # consistent SQLite backup
npm run db:restore -- <path> # atomic restore; stop app first
```

Verify order before considering work done: **lint → typecheck → test → build**. All four must pass clean (currently do).
Run the matching layered command while iterating; run E2E when changing a browser-visible flow. `npm test` never downloads or launches a browser and must not call a real AI provider.
The supported runtime is Node.js **^22.22.2 || ^24.15.0 || >=26.0.0**. E2E uses unique `DATA_DIR`, `.next-e2e`, and `.playwright-e2e` run directories, forces empty AI/embedding credentials, and only retains that run's trace/report when it fails.

## Toolchain quirks (gotchas that will bite you)

### Tailwind is v3, NOT v4 — despite appearances
- `components.json` declares `style: base-nova` (a v4/Base-UI registry) and `tailwind.config: ""`, but the project actually runs **Tailwind v3** (`tailwind.config.ts` + `postcss.config.mjs`). Do not "fix" this back to v4.
- Reason: Tailwind v4 pulls `lightningcss`, whose prebuilt native binary core-dumps in this environment (both Turbopack build and dev). v3 is pure JS and avoids it.
- `src/app/globals.css` uses v3 directives + HSL CSS variables; colors in `tailwind.config.ts` use `<alpha-value>` form (required for the `/50` opacity modifiers the components use).
- **Adding shadcn components via CLI is dangerous**: `npx shadcn add <x>` emits v4-only syntax (`gap-(--var)` shorthand, `--spacing()`, `@container/name`). These break the v3 build. After adding, manually convert: `foo-(--var)` → `foo-[var(--var)]`, `--spacing(N)` → `(N*0.25)rem`, drop `@container/...`. The already-installed components in `src/components/ui/` were patched this way.

### xyflow stylesheet is a static asset, not a JS import
- React Flow's CSS is served from `public/xyflow.css` via a `<link>` in `src/app/layout.tsx`.
- Do NOT replace it with `import "@xyflow/react/dist/style.css"` — routing that file through PostCSS triggers the lightningcss crash. If you upgrade `@xyflow/react`, re-copy `node_modules/@xyflow/react/dist/style.css` → `public/xyflow.css`.

### AI SDK v7 specifics (all learned the hard way)
- Tool definitions use **`inputSchema`**, not `parameters` (renamed in v7).
- `useChat` lives in **`@ai-sdk/react`**, not `ai`. In v7 it does NOT manage `input`/`handleSubmit`/`isLoading` — call `sendMessage({ text })` and track input state yourself. `status: 'submitted' | 'streaming' | 'ready' | 'error'`.
- Convert UI→model messages with **`await convertToModelMessages(messages)`** (async; renamed from `convertToCoreMessages`).
- Multi-step tool calls: `stopWhen: stepCountIs(n)`. Chat persistence is client-side (save on `status==='ready'`).
- **Streaming**: chat uses `toUIMessageStreamResponse()`. Chapter generation wraps `streamText().textStream` in NDJSON `GenerationEvent`s (`delta`/`progress`/`error`/`done`) via `generation-stream.ts`; the client only commits after `done`.
- **Non-streaming**: `generateText` (sync, one-shot — used by summary & outline-sync), `generateObject({ schema })` for **structured** output (used by consistency check → `ConsistencyCheckOutputSchema`, beat sheet → `BeatSheetSchema`). Pass a zod schema; SDK auto-retries on validation failure.
- **Multi-step prose loop** (`src/lib/ai/multi-step.ts`) is NOT SDK multi-step — it's a hand-rolled `for` loop of `streamText` calls whose chunks are emitted as typed generation events. Beat-planning uses `generateObject` awaited *before* the stream starts, so beat failure can cleanly fall back to single-shot.
- **`getModel()` in `src/lib/ai/client.ts` uses `@ai-sdk/deepseek` only** — default model `deepseek-v4-flash`; per-project override via `project.aiModel` (e.g. `deepseek-v4-pro`). Chat route uses `sendReasoning: true` for thinking stream parts.

### Next.js 16
- Dynamic route `params`/`searchParams` are **`Promise`** — `await params` in every route handler and page.

### Drizzle uses the Node SQLite RC line
- The target adapter is `drizzle-orm/node-sqlite` over built-in `node:sqlite`; do not add `better-sqlite3`, `sqlite3`, libSQL, or another native SQLite package.
- `drizzle-orm` and `drizzle-kit` are intentionally pinned exactly to matching `1.0.0-rc.4` because the `0.45` stable line does not expose the Node SQLite adapter. Upgrade them together only after confirming that import path and the SQLite fixture still pass.

## Architecture

### Target modular monolith (migration in progress)

- The target is a **Next.js 16 modular monolith** documented in `docs/architecture/`.
- New business code belongs to one of six vertical modules under `src/modules/`: `projects`, `canon`, `narrative`, `manuscript`, `changes`, `intelligence`.
- Every module's `index.ts` is its public entrypoint. Cross-module imports MUST use `@/modules/<module>` and MUST NOT import internal paths. Inside one module, use relative imports.
- Module domain code depends only on its local domain and `src/shared/contracts`; it MUST NOT depend on Next.js, Drizzle/SQLite, AI SDKs, `src/platform`, or legacy AI code.
- Technical adapters live under `src/platform/`: `database`, `events`, `jobs`, `ai`, `observability`. Shared code is limited to stable contracts in `src/shared/contracts`.
- The new platform database defaults to `data/ai-novel.sqlite` (`DATABASE_PATH`). It is separate from legacy `data/projects`, uses generated SQL migrations under `drizzle/`, and must never read or mutate legacy project files. Connections enable WAL, foreign keys, and busy timeout; synchronous Unit of Work callbacks must not perform AI/network/async work.
- Node instrumentation starts one global outbox/job worker pair unless building, testing, running Edge, or `PLATFORM_WORKERS_ENABLED=false`. Timers are stoppable/unref'ed. Before `npm run db:restore -- <path>`, stop the app/workers; use `npm run db:backup -- <path>` for a consistent database backup. These commands do not back up `data/projects`.
- `eslint.config.mjs` and `tests/architecture/` are executable boundaries, not advisory documentation. Do not disable them to land a feature.
- The legacy implementation below remains active during migration. Until a complete use case has switched with data compatibility and regression coverage, do not delete or casually refactor its `src/app`, `src/lib`, file-storage, or sidecar paths.
- **Projects vertical slice is live**: root `/`, `/studio/[projectId]`, and `/api/v1/projects` use the SQLite `NovelProject` aggregate. New project links must stay under `/studio`; never route them into the legacy `/projects/[id]` store. Project writes require `expectedVersion`, increment `version` and `projectSequence` once, and commit state plus `projects.project.<action>.v1` outbox events in one Unit of Work. TanStack Query owns new project server state; do not mirror it into Zustand.
- The versioned public `NovelExportManifestSchema` currently registers only the `projects` contribution. SQLite files are never an export/interchange format; full zip export remains on the legacy path until later module slices migrate.

- **Next.js App Router**, all under `src/app`. API routes in `src/app/api/**`, pages in `src/app/projects/[id]/**`.
- **Application commands** live in `src/lib/application/project-commands.ts`. Routes call these commands for canonical mutations; each command holds one reentrant project transaction and returns a revision-stamped response from `src/lib/api-contracts.ts`. Keep HTTP parsing in routes and file CRUD in `storage.ts`; do not move snapshot orchestration back into either layer.
- **AI writes data via function calling**, not JSON-in-text. `src/lib/ai/tools.ts` defines 8 tools (`upsert_character`/`delete_character`, `upsert_relationship`, `upsert_world_section`, `upsert_plot_note`/`delete_plot_note`, `create_chapter_outline`, `list_relationship_types`) whose `execute` write to the file system via `src/lib/storage.ts`. Each execute is wrapped in `safe()` so a single tool failure returns `{success:false}` instead of crashing the stream — wrap any new tool the same way. `src/app/api/chat/route.ts` streams via `streamText` + `toUIMessageStreamResponse()`. Chapter prose uses a separate typed NDJSON stream at `chapters/[chapterId]/generate`.
- **Storage is local files**, server-only. `src/lib/storage.ts` (guarded by `server-only`) reads/writes `data/projects/<id>/`. Writes use durable temp-file replacement and a per-project before-image journal under `data/.transactions/`; `withProjectTransaction` is reentrant and rolls back failed or crash-interrupted multi-file commands. Never import storage into client components. `Project.schemaVersion` is upgraded through `src/lib/storage/migrations.ts`; `Project.revision` versions canonical project state; `Chapter.contentRevision` plus `contentHash` provide optimistic concurrency for prose. Summary/check/beat commits use CAS and discard stale AI output.
- **Prompt layer** in `src/lib/ai/`: `writer-prompt.ts` exports `ContextBundle` + `assembleContextBundle()` + `buildSharedContext(bundle, currentOrder?)` (the shared设定/前文 renderer used by all prose prompts) and `buildWriterPrompt()` (single-shot chapter prompt). New prose prompts (beat sheet, expand-beat) MUST call `buildSharedContext` rather than re-assembling设定 — it's the single integration point for all context-enhancement features.
- **Five AI-enhancement subsystems** (all share one invariant: **failure degrades to no-op, never blocks writing/generation**):
  - **滚动摘要** (`src/lib/ai/summary.ts` + `/chapters/[id]/summary` route): after chapter save/generation, client fires `summarizeChapter()` → `generateText` 200-300字摘要, **server-side persisted** into `chapter.summary` (NOT client-save like outline). `summaryOfContentHash` + `summaryInputFingerprint` make it idempotent; commit compares content/project revisions and discards stale output. Only content-hash-fresh summaries are injected by `buildSharedContext`.
  - **RAG** (`src/lib/rag/chunk.ts` pure layer + `retrieve.ts` server + index in `rag/index.json`): BM25 (char-bigram + character-name boost, zero native deps — **do not** swap in transformers.js/onnx, lightningcss crash risk) is default; `embed` mode calls OpenAI-compatible `/embeddings` via `src/lib/ai/embedder.ts` (config: `EMBED_*` env). **Write-time hooks** in every `*Impl` (chapter/world/plot create/update/delete) re-chunk into the index inside `withProjectLock` (try/catch, silent). `embed` mode only vectorizes on **rebuild** (not per-write) — new content post-rebuild needs another rebuild to be vector-retrievable; BM25 has no such gap. `retrieveContext()` never throws → returns `[]`.
  - **伏笔到期** (`src/lib/plot-due.ts` pure, shared server+client): `classifyDuePlotNotes(notes, currentOrder)` buckets pending foreshadows into mustResolve/mustPlant/approaching. Injected by `buildWriterPrompt` as `# 本章需处理的伏笔` + rewrites writing-requirement #4. PlotNote fields: `expectedPlantChapter`/`expectedResolveChapter` (AI/user planning) and `plantedInChapter`/`resolvedInChapter` (**system-only** — NOT in `UpsertPlotNoteInputSchema`; consistency-check and the dedicated resolve command write them). Client UI (planning cards + editor banner) reuses the same `classifyDuePlotNotes` — keep one source of truth.
  - **一致性检查** (`src/lib/ai/consistency-check.ts` + `checks.json` + `/chapters/[id]/check`): post-generation `generateObject` → `ConsistencyCheckOutputSchema` (findings + foreshadowResolutions). Reports store content/project revisions and an input fingerprint; stale commits return 409 and stale reports are not shown as passed. Foreshadow IDs are included in the prompt and model-returned IDs are allow-listed before optional backfill.
  - **多步循环** (`src/lib/ai/multi-step.ts` + `.beats.json`): `streamMultiStep()` = `generateObject`(BeatSheetSchema, temp 0.4) → `for` loop of `streamText` per beat (temp ~0.85) → typed events. `continue` only reuses a versioned cache whose mode, content/outline hashes, revisions and model all match; old/raw beat files safely invalidate. RAG is injected into successful multi-step prompts. **critique/rewrite sub-loop NOT implemented**.
- **Client state**: `src/lib/store.ts` creates one vanilla Zustand store per `/projects/[id]` layout and exposes it through `ProjectStoreProvider`; the server layout hydrates it with `getProjectData()`. Never restore a module-level global store. `reload()` rejects snapshots overtaken by local commits and retries; canonical chapter/character/world/plot/relationship mutations atomically commit their server-issued `project.revision`. `chapter-editor.tsx` keeps the server-issued content revision, commits generated prose only after a `done` event, then triggers summary/check with that exact revision. Add new post-save AI hooks there, not in storage (Next.js Node runtime drops un-awaited promises after response).
- **shadcn Button is Base-UI-based** and has **no `asChild`**. To render a button as a link, apply `buttonVariants({ variant })` as className on `<Link>`.
- `src/env.ts` is server-only; client components cannot read `process.env.*` (non-`NEXT_PUBLIC_`). The settings page passes server-read values (default model, `embedConfigured`) down as props.

### Data layout (`data/projects/<id>/`)
```
project.json        # Project (now: ragMode, ragTopK, generateStrategy, multiStepCritique, multiStepRewrite, autoResolveForeshadow)
characters.json     worldbuilding.json  planning.json  chapters.json   # + chat.json (capped at CHAT_HISTORY_LIMIT)
chapters/<cid>.md                    # prose
chapters/<cid>.beats.json            # multi-step beat sheet (cache for continue)
checks.json                          # Record<chapterId, ConsistencyReport>
rag/index.json                       # RagIndexRecord[] (chunk + optional embedding)
rag/meta.json                        # {mode, builtAt, chunkCount}
```
Schema-shape changes must add an ordered `Project.schemaVersion` migration; optional/default fields remain useful for sidecar compatibility but do not replace explicit project migrations.

## Environment

- `.env.local` (gitignored) configures DeepSeek: `AI_API_KEY`, `AI_BASE_URL` (default `https://api.deepseek.com/v1`), `AI_MODEL` (default `deepseek-v4-flash`; must support **tool calling**). Template in `.env.example`.
- **RAG vector mode** (optional): `EMBED_API_KEY`, `EMBED_BASE_URL` (OpenAI-compatible `/embeddings` root, e.g. `http://localhost:11434/v1` for local Ollama or a cloud BGE endpoint), `EMBED_MODEL` (default `bge-m3`). When unset, settings disables the「向量检索」option and embed retrieve degrades to `[]`; BM25 still works. `isEmbedConfigured()` requires key + base URL.
- Without `AI_API_KEY`, `/api/chat` returns 503 with a friendly message (not a crash).
- Per-project feature toggles live on `Project` (settable from settings page): `ragMode` (off/bm25/embed), `ragTopK`, `generateStrategy` (auto/single/multi), `multiStepCritique`, `multiStepRewrite`, `autoResolveForeshadow`. All default to safe/off states.
- Runtime data lives in `data/` (gitignored). Deleting it loses all projects.
- `DATABASE_PATH` stores the new project catalogue as well as platform outbox/jobs. `DATA_DIR/projects` remains the separate legacy content store; backup or restore each boundary with its own supported workflow.

## Style

- UI text and AI prompts are **Chinese** (中文). Keep new UI strings in Chinese unless asked otherwise.
- No comments unless asked (per repo convention).
- Primary color is violet (`262 83% 58` HSL in `:root`).
