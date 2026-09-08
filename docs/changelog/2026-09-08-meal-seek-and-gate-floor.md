# Per-tick meal seeking and the wiped-colony gate waiver ratified

The bread-economy spec now matches what shipped: hungry colonists
re-seek bread with a per-tick scan (a cooldown rhythm deferred meals
almost every time — a pool worker is between tasks for one tick), and
the wanderer gate's bread bar is waived at zero settled, so a wiped
colony can still receive its first pair of hands and recovery stays
possible. Four smaller ratifications rode along.

## Detail

- All six items in the build's spec-issues report were spec defects;
  the build (`2026-09-08-bread-economy`) stands unchanged and only
  `docs/specs/2026-09-08-bread-economy.md` moved (edits in place plus
  an Amendments entry).
- The cooldown rhythm for meal re-seek is recorded as rejected in the
  spec so it isn't reintroduced as an "optimization": the per-tick
  scan is O(items) with no route planned when nothing is free; the
  residual (one A* per tick while free bread is unreachable) is
  accepted.
- Also ratified: the chain's golden runs on its own selected seed (the
  main golden's seed has no near outcrop and no House); the re-record
  ripple is behaviour-wide, not shape-only; `Beds 2` + note *raises
  the cap by 2* replaces the one-row copy that broke the 246 px
  cluster rule; and the first-stockpile reservation transient over the
  provision pile (~half a game-day of possibly missed meals) is stated
  and accepted — exempting bread from tidy-hauling was rejected
  because it would jam the oven's two-slot output buffer.
