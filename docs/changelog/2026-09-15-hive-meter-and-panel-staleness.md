# A boosted hive's meter fills, and two panel rows stop going stale

A Hive's progress meter is measured against the batch length it is actually
running — the flower-field table — not the def's base `ticks`, so a hive among
three fields no longer fills to 30% and snaps back.

The inspector's repaint signature now carries `cellarStocked` and `fields`.
Both are derived from *other* buildings, so neither moved anything else on the
panel: a House's signature is otherwise wholly static, which meant the mead
note could never appear, and an unstaffed Hive's is too, which froze `Fields in
reach` at the count it had when you clicked.

## Detail

- Found by the commit review of `2026-09-14-hives-and-mead`. `know.milling` was
  the only consumer of `recipe.ticks` outside `economy/workshop`; there are now
  none — `batchTicks` is the single answer to "how long is this batch", and a
  future rate that depends on placement needs no second edit here.
- `watching` is deliberately still out of the signature: a Watchtower's den
  count cannot change while a panel is open, because dens are world generation.
  `fields` is the case that *can*.
- The door guard (`labour/colonists`) now takes the tick's own `Occupancy`
  instead of rebuilding one. `leaveBuilding` still rebuilds its own on the same
  tick — left alone as a pre-existing redundancy rather than widened into here.
- Not repaired, and worth knowing: a stockpile panel with goods mid-clear asks
  `canRehome` per clearing good per frame, and each call walks every stockpile
  and, inside `freeCapacity`, every item in the colony. Bounded by how many
  goods a player clears at once, so it is a late-colony stutter risk rather
  than a bug — it wants a per-frame memo if it ever bites.
- Cosmetic, same pass: the Pasture's prop docstring had been orphaned above
  `hive()` and is back over `pasture()`.
