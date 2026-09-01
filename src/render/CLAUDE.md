# Castles — render

The three.js renderer: chunked instanced meshes, materials, and the shader
injections carried over from the mockups. It draws sim state; it never
changes it. Broader context in `docs/ARCHITECTURE.md`.

## Required tools

- **`LSP`** — TypeScript symbol navigation. The tool is deferred: load it via
  `ToolSearch` with `select:LSP` before use.

## Hard rules

- **Read `sim/know`, never the sim's truth modules.** Drawing the sim's exact
  truth "temporarily" silently deletes the watchtower mechanic (see
  ARCHITECTURE, "Truth and knowledge").
- **Never mutate sim state.** Player input becomes commands to the sim; the
  renderer only reads.
- **three.js stays pinned.** Upgrade only deliberately — the gotchas record
  in ARCHITECTURE (π-scaled lights, tone-mapping behaviour) is
  version-sensitive.
- **Per-chunk, never per-world.** Rebuild only dirty chunks; a change must
  never trigger a whole-world rebuild.
- **Before renderer work, read the "Gotchas" section of
  `docs/ARCHITECTURE.md`** — all eight cost real time once already.

## Testing

Vitest for extractable logic: chunk dirty-marking, instance packing,
projection math. Do not introduce a different test framework without updating
the architecture doc.

## Verification workflow

Visual changes are not verified by tests alone:

1. Start the dev server.
2. Load the game via Playwright MCP — headless by default, so rely on
   screenshots and page snapshots, not a visible window.
3. Screenshot the affected view and check it; check the console for
   WebGL/three.js warnings and errors.
4. Only then report the change as complete.
