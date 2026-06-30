# AGENTS.md

Compact guidance for OpenCode sessions. High-signal only — read before editing.

## Commands

```bash
npm run dev      # dev server (Turbopack), http://localhost:3000
npm run build    # production build
npm run lint     # eslint
npx tsc --noEmit # TYPECHECK — no npm script exists; run this directly
```

Verify order before considering work done: **lint → typecheck → build**. All three must pass clean (currently do).

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
- **`getModel()` in `src/lib/ai/client.ts` uses `@ai-sdk/deepseek` only** — default model `deepseek-v4-flash`; per-project override via `project.aiModel` (e.g. `deepseek-v4-pro`). Chat route uses `sendReasoning: true` for thinking stream parts.

### Next.js 16
- Dynamic route `params`/`searchParams` are **`Promise`** — `await params` in every route handler and page.

## Architecture

- **Next.js App Router**, all under `src/app`. API routes in `src/app/api/**`, pages in `src/app/projects/[id]/**`.
- **AI writes data via function calling**, not JSON-in-text. `src/lib/ai/tools.ts` defines tools (`upsert_character`, `upsert_relationship`, `upsert_world_section`, `create_chapter_outline`) whose `execute` write to the file system. `src/app/api/chat/route.ts` streams via `streamText` + `toUIMessageStreamResponse()`. Chapter prose uses a separate text stream at `chapters/[chapterId]/generate` (`toTextStreamResponse()`).
- **Storage is local files**, server-only. `src/lib/storage.ts` (guarded by `server-only`) reads/writes `data/projects/<id>/` (JSON for structured data, `chapters/*.md` for prose). Writes are atomic (temp file + rename). Never import storage into client components.
- **Client state**: Zustand store in `src/lib/store.ts` holds the active project's data; pages mutate via the `*Local` helpers then call `reload()`. `src/lib/api.ts` is the typed REST client.
- **shadcn Button is Base-UI-based** and has **no `asChild`**. To render a button as a link, apply `buttonVariants({ variant })` as className on `<Link>`.
- `src/env.ts` is server-only; client components cannot read `process.env.*` (non-`NEXT_PUBLIC_`). The settings page passes server-read values (e.g. default model) down as props.

## Environment

- `.env.local` (gitignored) configures DeepSeek: `AI_API_KEY`, `AI_BASE_URL` (default `https://api.deepseek.com/v1`), `AI_MODEL` (default `deepseek-v4-flash`; must support **tool calling**). Template in `.env.example`.
- Without `AI_API_KEY`, `/api/chat` returns 503 with a friendly message (not a crash).
- Runtime data lives in `data/` (gitignored). Deleting it loses all projects.

## Style

- UI text and AI prompts are **Chinese** (中文). Keep new UI strings in Chinese unless asked otherwise.
- No comments unless asked (per repo convention).
- Primary color is violet (`262 83% 58` HSL in `:root`).
