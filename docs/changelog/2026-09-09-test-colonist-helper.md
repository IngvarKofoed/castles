# `testColonist` is the one place a test's Colonist literal lives

`sim/test-sim.ts` gained `testColonist(patch)` beside `flatSim`, `testMonster`
and `testBuilding`, and the twelve test files that hand-built the literal now
call it — the three local factories that had grown up around it included. A new
`Colonist` field is one edit now rather than a dozen compile errors, which is
what `2026-09-08-bread-economy` cost when it added two.

## Detail

- **It builds and returns without pushing**, as `testMonster` and `testBuilding`
  do, so the three pushing factories — `walker` in `flee.test.ts` and
  `monsters.test.ts`, `colonist` in `hunger.test.ts` — stayed local rather than
  being unified into a shared one. Two take `(sim, x, y, patch)` and one takes
  `(sim, patch)`; the drift this item was about is the *literal*, and collapsing
  three call conventions into one is a different change nobody asked for.
- **`px`/`py` derive from the effective `x`/`y`** — the trap `testMonster`
  already documents, where a previous position half a tile off biases a range
  assertion. Three `hunger.test.ts` call sites that kept them in step by hand
  dropped the now-redundant fields; the spread still wins, so a test that wants
  them apart says so.
- **The default id is 90, out of the way of `mintId`'s small numbers**, and every
  caller in a peopled sim mints its own instead. Several colonists per sim is the
  normal case here, unlike the one-of-a-kind building and monster the sibling
  helpers return.
- **The two literals left in `src/` are production and must stay** — `createSim`
  and `arrive` (`sim/store.ts`, `sim/settlers.ts`). `test-sim.ts` is deliberately
  imported by nothing in the app so it is never bundled; reaching for it from
  `store.ts` would put a test helper in the shipped game.
- **No behaviour was intended to move and none did**: the helper writes the same
  fields the literals did, all four golden hashes are unmoved, and the suite
  passes. That equality rests on the field-by-field match plus those pins — there
  is no test asserting the helper's output against a literal, because the point
  of the change is that no literal survives to compare against.
