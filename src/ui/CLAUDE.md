# Castles — ui

The HUD, build menus, and overlays — plain DOM and TypeScript. Broader
context in `docs/ARCHITECTURE.md`.

## Required tools

- **`LSP`** — TypeScript symbol navigation. The tool is deferred: load it via
  `ToolSearch` with `select:LSP` before use.
- **Playwright MCP** (`mcp__playwright__*`) — every UI change is verified in
  the browser, not by reading the code. The tools are deferred: load what the
  verification needs via `ToolSearch` (e.g.
  `select:mcp__playwright__browser_navigate,mcp__playwright__browser_snapshot,mcp__playwright__browser_click,mcp__playwright__browser_console_messages`).

## Hard rules

- **Read `sim/know` only; act through commands.** The HUD never reaches into
  sim truth and never mutates the store — player intent becomes commands
  applied at tick boundaries.
- **Plain DOM.** No UI framework — adding one is an architecture change:
  update `docs/ARCHITECTURE.md` first.
- **Every visual token comes from `docs/STYLEGUIDE.md`.** Read it before
  any UI work and copy its palette, type, and component recipes — never
  invent colors, fonts, or new component shapes. The live reference mock is
  linked at its top.

## Testing

Vitest for logic (formatting, command construction). Do not introduce a
different test framework without updating the architecture doc.

## Verification workflow

1. Start the dev server.
2. Drive the changed feature via Playwright MCP — headless by default, so
   rely on the page snapshot, not a visible window.
3. Check console messages and network requests for errors.
4. Only then report the change as complete.

## Required skills

None mandated — deliberately empty. Add here when a project-specific skill
exists (e.g. a design-system skill built with `/skill-creator`).
