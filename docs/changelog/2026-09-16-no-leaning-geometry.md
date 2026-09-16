# Two renderer limits are hard rules, not findings buried in one entry

`src/render/CLAUDE.md` now states that **nothing in this renderer can lean** —
`Box.rot` spins about +y only, so a diagonal is a stepped run of boxes — and
that **geometry is never "visual only"**: anything standing proud of a
footprint costs that footprint clickable area, because `Picker.tileAt` floors
the hit position. Both were discovered by `2026-09-16-site-scaffolding` and
recorded there; this puts them where a prop author reads *before* starting.

## Detail

**Promoted rather than restated.** The scaffolding entry keeps the measurements
and the reasoning — the probe grid, the 22°-versus-45° brace geometry, the
`emitBox` axis — and the hard rules carry only the constraint and a pointer.
Two copies of a number is how one of them goes stale.

**Not added to ARCHITECTURE's Gotchas, deliberately**, even though
`src/render/CLAUDE.md` routes people there and these two cost real time in
exactly the way that list collects. That section sits inside *The mockups — a
record*, and its entries are mockup lessons that carried forward; neither
`Box.rot` nor `Picker.tileAt` existed in the mockups. Filing current-renderer
facts in a historical record would make the record wrong about what it is. The
Gotchas' "all eight" count is therefore still correct.

**The spec that caused this asserted both wrongly.**
`docs/specs/2026-09-16-site-scaffolding.md` specified a diagonal brace that no
box can draw, and called an overhang "visual only — props feed neither
placement nor pathing", which omits the third consumer. Both were caught in the
build rather than in two fresh-eyes review passes, which is the argument for
the rules being somewhere a builder meets them early.
