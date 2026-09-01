# Repo scaffolded: git, CLAUDE.md files, v0.1.0 anchor

The repo is now a git repository (direct-to-main, worktrees in
`.claude/worktrees/`) with root + `src/sim` + `src/render` + `src/ui`
CLAUDE.md scaffolding anchored on CONCEPT.md and ARCHITECTURE.md. Version
anchor: annotated tag `v0.1.0` — the version is `git describe`, to be baked
at build time once the Vite build exists.

## Detail
- Stack decided: TypeScript + three.js + Vite, browser-first with a
  Tauri/Electron wrap later, saves in IndexedDB plus file export.
- Required skills for `src/ui` deliberately left empty (`frontend-design`
  offered and declined).
- Plain DOM for the HUD — introducing a UI framework requires updating
  ARCHITECTURE.md first.
