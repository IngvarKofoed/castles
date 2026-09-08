# Relative stepper command and blueprint counting ratified in the spec

The production-control spec now matches what shipped: the panel
steppers send the relative `stepLimit (type, dir)` command, resolved by
the sim against live state at apply time — an absolute `set-limit`
computed from the panel snapshot misbehaves across queued and paused
presses. And blueprint-committed materials keep counting toward
ceilings: a ceiling below one building's cost stalling that build is
accepted, not a bug.

## Detail

- Both changes ratify decisions the build made and defended in
  `2026-09-07-production-limits-and-filters` — the spec was the thing
  out of date, so only `docs/specs/2026-09-07-production-control.md`
  changed (edits in place plus an Amendments entry).
- Discounting committed materials was recorded as a rejected
  alternative in the spec so nobody "fixes" the stall later: the count
  would disagree with the ribbon and with what a cancelled blueprint
  hands back.
- `set-limit` stays absolute, for scripts, replays and tests — it is
  not dead, it is just not what the steppers send.
