# Castles — sim

The game itself: the pure TypeScript simulation — world, labour, economy,
walls, threats, knowledge, saves. This subtree lives under the contract in
`docs/ARCHITECTURE.md` ("The one hard boundary"); read that section before
working here.

Contents: `world/`, `labour/`, `economy/`, `walls/`, `threats/`, `know/`,
`save/`.

## Required tools

- **`LSP`** — TypeScript symbol navigation (definitions, references, rename)
  for any non-trivial edit here. The tool is deferred: load it via
  `ToolSearch` with `select:LSP` before use.

## Hard rules — the boundary is the architecture

- **No DOM, no three.js, no browser APIs.** Nothing in `src/sim/` may import
  from `src/render/`, `src/ui/`, `src/app/`, or `three`. If an edit needs a
  browser API, the edit belongs outside `sim/`.
- **No `Math.random`, no `Date.now`.** All randomness comes from the sim's
  single seeded PRNG; all time is the tick counter. Same seed + same commands
  must produce the same colony — a change that breaks that is wrong even if
  every test passes.
- **State is plain data.** All sim state lives in the one serializable store:
  plain objects and typed arrays, systems as functions over it. If
  `structuredClone` can't copy it, it doesn't go in the store.
- **Mutations enter as commands at tick boundaries** — never mutate the store
  from outside a system.
- **Truth vs knowledge.** Anything the player is entitled to see goes through
  `know/`. Never export truth (exact monster schedules, unobserved state) in
  a shape `render/` or `ui/` could consume directly — that quietly deletes
  the watchtower mechanic.

## Testing

Vitest, colocated `*.test.ts` next to the code under test. Determinism makes
golden-master tests cheap: fixed seed, run N ticks, assert on the store. Do
not introduce a different test framework without updating the architecture
doc.

The test suite **is** the verification for this subtree — a sim change is not
complete until the relevant tests exist and pass.
