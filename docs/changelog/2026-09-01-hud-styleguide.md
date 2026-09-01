# HUD style guide established before the first UI ships

`docs/STYLEGUIDE.md` now defines the HUD language — moss-glass panels, the
gold/sage/rust meaning system, type scale, panel anatomy, and the in-world
overlay grammar — distilled from a visual mock approved on a live design
canvas. `src/ui/CLAUDE.md` and `src/render/CLAUDE.md` mandate it, and the
tick-and-labour spec's UI section builds on it (ribbon with readouts
including the idle count, build rail, inspector).

## Detail
- Written *before* any `src/ui/` code exists, deliberately: implementation
  sessions share no memory, so whatever the first session invented would
  have become the de facto style. The guide is the durable cross-session
  carrier.
- Color meanings are load-bearing, not decorative: gold = player intent,
  sage = pool/validity, rust = slots/invalidity; no pure red anywhere. An
  overlay or widget that needs a fourth meaning is a design question, not
  a new color.
- The reference mock lives at
  https://claude.ai/code/artifact/fa8e50e2-7a08-422e-890b-23e3f262711c
  (panel opacity and accent gold are dialable there); the guide and the
  mock must never disagree — re-dialing means updating the guide.
- The mock also settled two spec-level details: the ribbon carries
  resource/population/idle readouts, and a cosmetic day caption derived
  from ticks (`DAY_TICKS`) — no day/night simulation in step 2.
