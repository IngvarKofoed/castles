/**
 * The migrations ladder: how an old save becomes a current one.
 *
 * **Keyed by from-version** — `MIGRATIONS[1]` turns a version-1 state into a
 * version-2 state. `decode` walks the ladder one rung at a time from the
 * save's version up to `SAVE_VERSION`, so every migration only ever has to
 * know about the single step it performs.
 *
 * Append-only, per docs/ARCHITECTURE.md's versioning policy: a landed
 * migration is never edited, because saves in the wild still go through it.
 * Adding a rung means bumping `SAVE_VERSION`, writing the function here, and
 * leaving `fixtures/v1.castles` exactly as it is — that fixture failing to
 * load *is* the alarm, and it is meant to be loud.
 *
 * Pre-1.0 the escape hatch ARCHITECTURE allows is a refusal, not a guess: if a
 * store change is too deep to migrate, leave the rung out. `decode` then fails
 * with a plain message rather than loading something half-shaped.
 */
import { spawnItem } from "../items";
import { occupancy } from "../path";
import { spawnLairs } from "../threats/lairs";
import { ItemType, type Building, type Sim } from "../store";
import { PROVISION_BREAD, WANDERER_INTERVAL } from "../tuning";
import { recomputeEnclosure } from "../walls/enclosure";
import { WORLD_SIZE, generate } from "../world/world";

export type Migration = (state: unknown) => unknown;

export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  /**
   * 1 → 2: walls. A v1 colony has no wall graph, so it gains three zero-filled
   * layers and a clean enclosure flag; `decode` recomputes `insideMap` from
   * `wallMap` afterwards, so the zeroes here are a shape rather than a claim
   * (docs/specs/2026-09-02-palisade-walls.md).
   *
   * **Task kinds need no migration**, which is the whole reason `BuildWall`
   * and `Raze` were appended to `TaskKind` rather than slotted into its
   * priority order: a v1 save's live tasks still mean exactly what they meant.
   * The same held when `Mine` and `Terraform` were appended for v3, and it
   * keeps holding for exactly as long as nobody inserts.
   */
  1: (state) => {
    const s = object(state);
    const tiles = tileCount(s);
    return {
      ...s,
      wallMap: new Uint8Array(tiles),
      razeMap: new Uint8Array(tiles),
      insideMap: new Uint8Array(tiles),
      enclosureDirty: 0,
    };
  },

  /**
   * 2 → 3: the stone tier. Two zero-filled intent layers — nothing was
   * designated for quarrying or levelling in a v2 colony — **and the two new
   * stockpile filters stamped on to every building that already exists.**
   *
   * That second half is the whole reason this rung is more than a line. The
   * accept flags are per-good fields on `Building`, and a v2 building has no
   * `acceptRock`/`acceptBlock` at all: left alone they read as `undefined`,
   * `stockpileAccepts` refuses, and every stockpile in every migrated colony
   * would quietly refuse rock and blocks *forever* while the mason jammed at
   * output cap. Nothing would error; the colony would simply stop working, and
   * the player would have no way to tell why.
   *
   * Stamped to 1, matching what `place` gives a new building — a v2 player
   * never chose to exclude a good that did not exist, so the default is the
   * only honest reading of their intent.
   */
  2: (state) => {
    const s = object(state);
    const tiles = tileCount(s);
    return {
      ...s,
      mineMap: new Uint8Array(tiles),
      terraformMap: new Uint8Array(tiles),
      buildings: Array.isArray(s.buildings)
        ? // Non-object entries pass through untouched so `assertSim` still
          // refuses the save rather than this rung papering over it.
          s.buildings.map((b) =>
            b && typeof b === "object" ? { ...(b as Record<string, unknown>), acceptRock: 1, acceptBlock: 1 } : b,
          )
        : s.buildings,
    };
  },

  /**
   * 3 → 4: monsters. Two zero-filled layers — nothing has been bitten and
   * nobody has died in a colony that never had anything to fear — **and the
   * lair pass run over the save's own world**, so an old colony wakes up in a
   * wilderness that has always been there. Resting, at first: the pass seeds
   * each monster's phase from its own periods, so most of them are asleep on
   * the tick the save resumes.
   *
   * Running the pass rather than shipping an empty `monsters` array is the
   * whole point of this rung. Its draws come from a stream derived from the
   * world seed alone — never `rngState`, never the colony — which is what
   * makes a migrated v3 save and a fresh game on the same seed wake **the same
   * monsters at the same lairs on the same rhythms**. The ids differ, because
   * they come off the save's own counter; nothing else does.
   *
   * The colony enters in exactly one place, and only as a veto: **ground the
   * save has already claimed — enclosed ground, and every tile carrying a
   * wall — is refused a den** (`enclosedBefore`, which explains why both
   * halves are needed). Lair ground is never "inside" (see `walls/enclosure`),
   * so a den waking within an old ring would turn that colony's whole interior
   * to open country on load, which the player never chose and cannot undo.
   *
   * **The equality above holds exactly while the veto never fires**, which is
   * the ordinary case: a v3 ring is small and `LAIR_SPACING` keeps dens off it.
   * When it *does* fire, the wilderness is a near-miss rather than a match, and
   * that is unavoidable rather than an oversight — a rejected draw spends the
   * tile draw but not the monster's own (its kind, hours and four waypoints,
   * a variable number of values), and the rejection also changes what `placed`
   * holds and therefore which later draws the spacing rule refuses. So dens
   * before the rejection are identical, the ones after it are drawn from the
   * same gradient but not the same values. Filtering the candidate list instead
   * would shift *every* draw including the first, which is strictly worse.
   *
   * The pass mints ids through `nextId`, so this rung hands it the real store
   * shape rather than a partial one. `assertSim` still has the last word on
   * whether what comes out is a save at all.
   */
  3: (state) => {
    const s = object(state);
    const tiles = tileCount(s);
    const next: Record<string, unknown> = {
      ...s,
      monsters: [],
      wallDamageMap: new Uint8Array(tiles),
      graveMap: new Uint8Array(tiles),
    };
    // The pass reads a world **regenerated from the save's seed**, not the
    // save's own layers: those have been chopped and quarried, and the pass
    // filters on exactly those two layers, so reading them would hand a played
    // colony a different wilderness than a fresh game on its seed. Regenerating
    // is what makes "the same seed is the same world" survive the rung.
    //
    // Guarded, because a rung may be handed anything: `spawnLairs` is live sim
    // code and would throw a raw TypeError on a malformed world, which would
    // escape `decode` as something other than a `SaveError` and put a stack
    // trace in the menu's note row. A save that fails these checks passes
    // through with no monsters and `assertSim` refuses it properly.
    //
    // The size check is part of that guard rather than pedantry: `generate`
    // always builds at this build's `WORLD_SIZE`, and the pass writes circuit
    // *tile indices*, so a save from a differently sized world would get a
    // wilderness indexed against the wrong grid. No such save exists; skipping
    // is the safe answer if one ever does.
    const world = object(s.world);
    if (tiles > 0 && typeof next.nextId === "number" && typeof world.seed === "number" && world.size === WORLD_SIZE) {
      spawnLairs(next as unknown as Sim, generate(world.seed), enclosedBefore(next, tiles));
    }
    return next;
  },

  /**
   * 4 → 5: housing. Two defaults and nothing else — a v4 colony has no House,
   * so it has nobody walking in and nothing to walk to
   * (docs/specs/2026-09-07-housing-wanderers.md).
   *
   * **`dest` on every colonist is the half that cannot be skipped.** Left
   * missing it reads as `undefined`, `c.dest >= 0` is false and the colony
   * would appear to work — but the field is in the hash, in the save, and in
   * `stepColonists`' first branch, and a store that carries `undefined`
   * anywhere breaks the plain-data rule the whole format rests on. Stamped to
   * -1, which is what a colonist who lives here has always meant.
   *
   * `wandererTimer` gets a full interval, exactly as `createSim` gives a fresh
   * colony — the clock does not run until a House stands, so an old save is not
   * owed a head start it never earned, and it is not banking one either. Read
   * from the tunable rather than frozen as a number on purpose: a retuned
   * interval should reach a migrated colony as well as a new one, and the
   * fixture pins are what make that visible when it happens.
   */
  4: (state) => {
    const s = object(state);
    return {
      ...s,
      wandererTimer: WANDERER_INTERVAL,
      colonists: Array.isArray(s.colonists)
        ? // Non-object entries pass through untouched so `assertSim` still
          // refuses the save rather than this rung papering over it.
          s.colonists.map((c) => (c && typeof c === "object" ? { ...(c as Record<string, unknown>), dest: -1 } : c))
        : s.colonists,
    };
  },

  /**
   * 5 → 6: the patience clock gets its own field.
   *
   * v5 kept the wanderer's give-up clock in `work`, whose documented meaning is
   * task progress — the exact type pun the format's own rules forbid, and one
   * whose correctness rode on `abandonForFlight` and `clearWorker` happening to
   * zero it. `patience` is now a field of its own and `work` means only what it
   * says (docs/specs/2026-09-07-housing-wanderers.md, the 2026-09-07
   * amendment).
   *
   * **0 is the honest default, including for the one colonist it could be wrong
   * for.** A v5 save taken while a wanderer was *stuck* carries their elapsed
   * wait in `work`, and this rung deliberately does not read it across: `work`
   * is written by half a dozen systems, so a number found there means "task
   * progress" far more often than it means "waiting", and a settled colonist
   * mid-chop would arrive with a phantom clock. The cost is bounded and
   * invisible — one wanderer, in one save, waits up to two game-days longer
   * than they had left. Guessing the other way could only ever make somebody
   * vanish sooner than the save implied.
   */
  5: (state) => {
    const s = object(state);
    return {
      ...s,
      colonists: Array.isArray(s.colonists)
        ? s.colonists.map((c) => (c && typeof c === "object" ? { ...(c as Record<string, unknown>), patience: 0 } : c))
        : s.colonists,
    };
  },

  /**
   * 6 → 7: production ceilings. One `limits` array, one slot per `ItemType`
   * the game had at v7 — Log, Plank, Rock, Block — every slot `-1`, which is
   * "unlimited" and exactly how a v6 colony already behaved: nothing changes
   * until the player sets a ceiling (docs/specs/2026-09-07-production-control.md).
   *
   * **Four literal slots, not `unlimitedLimits()`.** A rung describes the save
   * it is handed, at the version it is handed, and a later good appends its own
   * `-1` in its own rung. Read the *current* type count here instead and a v6
   * save migrated after that good exists would leave this rung with five slots
   * and arrive at the next one with six — the same reason `MIGRATIONS[2]`
   * stamps exactly `acceptRock` and `acceptBlock` rather than "every accept
   * field the build knows". The stockpile filters themselves need nothing:
   * their fields have been in every save since v3, and the toggles that arrive
   * with v7 are UI over them.
   */
  6: (state) => {
    const s = object(state);
    return { ...s, limits: [-1, -1, -1, -1] };
  },

  /**
   * 7 → 8: the bread economy (docs/specs/2026-09-08-bread-economy.md). Four
   * things, three of them the documented append rituals and one of them a
   * genuine gift.
   *
   * **The two colonist fields**, both 0: `hunger` starts the meal clock from
   * the tick the save resumes — an old colony is not owed a day of arrears —
   * and `eating` is 0 because nobody in a v7 save was ever at lunch.
   *
   * **The three accept flags, stamped 1 on every saved building**, which is the
   * v2 rung's precedent and the half that cannot be skipped: `stockpileAccepts`
   * reads these by name for every kind, so a building that came through with
   * them missing would refuse grain, flour and bread *forever* while the oven
   * jammed at output cap and nothing in the game could say why. A v7 player
   * never chose to exclude a good that did not exist.
   *
   * **Three `-1`s appended to `limits`**, per the production-control append
   * ritual: this rung adds exactly its own three, so a v6 save migrated after
   * some later good exists still arrives at that good's rung with seven slots.
   *
   * **And three loaves per settled colonist, dropped at the colony.** Without
   * them a loaded colony is hungry by its second day with no farm and no way to
   * have built one, which is risk imposed rather than chosen — the one thing
   * CONCEPT does not allow. It is the same `PROVISION_BREAD` a fresh colony
   * opens with, and it is why this rung runs live drop code (`grantProvisions`
   * below).
   */
  7: (state) => {
    const s = object(state);
    const next: Record<string, unknown> = {
      ...s,
      colonists:
        Array.isArray(s.colonists) ?
          // Non-object entries pass through untouched so `assertSim` still
          // refuses the save rather than this rung papering over it.
          s.colonists.map((c) =>
            c && typeof c === "object" ? { ...(c as Record<string, unknown>), hunger: 0, eating: 0 } : c,
          )
        : s.colonists,
      buildings:
        Array.isArray(s.buildings) ?
          s.buildings.map((b) =>
            b && typeof b === "object" ?
              { ...(b as Record<string, unknown>), acceptGrain: 1, acceptFlour: 1, acceptBread: 1 }
            : b,
          )
        : s.buildings,
      limits: Array.isArray(s.limits) ? [...s.limits, -1, -1, -1] : s.limits,
    };
    grantProvisions(next, tileCount(s));
    return next;
  },

  /**
   * 8 → 9: the Watchtower. **An identity, deliberately** — the tower needed no
   * store field at all (coverage is derived per read, like the population cap),
   * so there is nothing here to change and this rung exists for a save it will
   * never be handed (docs/specs/2026-09-09-watchtowers.md).
   *
   * The bump is for the **older build**. `BuildingKind` gained a seventh kind,
   * and without a version rise an old build would load a kind-7 save cleanly
   * and then crash on its first frame — `defOf` of an unknown kind is
   * `undefined` — which is precisely the "loads garbage" ARCHITECTURE.md's
   * versioning policy forbids. `decode`'s future-version check is the one
   * refusal mechanism already shipped, so a new kind rides it and an old build
   * says "this save was made by a newer version of Castles" instead.
   *
   * State passes through untouched rather than being spread into a fresh
   * object: an identity that copies is an identity that can drift.
   */
  8: (state) => state,

  /**
   * 9 → 10: the sheep chain and the game's first equipment
   * (docs/specs/2026-09-10-sheep-and-clothes.md). Three append rituals, and no
   * gift — unlike the bread rung, which owed a migrating colony its provisions.
   *
   * **The two colonist fields**, both 0: `clothes` counts wear ticks
   * *remaining*, so 0 is "unclothed", which is what everybody in a v9 save has
   * always been and what an undressed colony stays. `dressing` is 0 because
   * nobody in a v9 save was ever at a fitting. Nothing is owed here: clothes
   * are a buff and not a floor, so arriving without them costs a loaded colony
   * exactly what it was already paying.
   *
   * **The four accept flags, stamped 1 on every saved building** — the v2
   * rung's precedent, and the half that cannot be skipped: `stockpileAccepts`
   * reads these by name for every kind, so a building that came through with
   * them missing would refuse wool, cloth, clothes and cheese *forever* while
   * the weaver jammed at output cap and nothing in the game could say why. A v9
   * player never chose to exclude a good that did not exist.
   *
   * **Four `-1`s appended to `limits`**, per the production-control append
   * ritual: exactly its own four, so a v6 save migrated after some later good
   * exists still arrives at that good's rung with eleven slots.
   */
  9: (state) => {
    const s = object(state);
    return {
      ...s,
      colonists:
        Array.isArray(s.colonists) ?
          // Non-object entries pass through untouched so `assertSim` still
          // refuses the save rather than this rung papering over it.
          s.colonists.map((c) =>
            c && typeof c === "object" ? { ...(c as Record<string, unknown>), clothes: 0, dressing: 0 } : c,
          )
        : s.colonists,
      buildings:
        Array.isArray(s.buildings) ?
          s.buildings.map((b) =>
            b && typeof b === "object" ?
              {
                ...(b as Record<string, unknown>),
                acceptWool: 1,
                acceptCloth: 1,
                acceptClothes: 1,
                acceptCheese: 1,
              }
            : b,
          )
        : s.buildings,
      limits: Array.isArray(s.limits) ? [...s.limits, -1, -1, -1, -1] : s.limits,
    };
  },

  /**
   * 10 → 11: hives, flower fields and mead
   * (docs/specs/2026-09-14-hives-and-mead.md). Two goods and three kinds; no
   * colonist field, no world field, and nothing derived — a hive's fields are
   * counted per read, so there is no state for the boost to migrate.
   *
   * **The two accept flags are stamped `0`, not `1`** — deliberately against
   * the v9 rung's rule one line above. Since
   * `2026-09-14-stockpile-default-and-clearing` a pile's filters are the
   * player's curation, and a good that did not exist when the save was written
   * was never opted into; a curated pile must not sprout acceptance of honey
   * and mead behind the player's back, and `all` is one press. The v9 rung's
   * reason for stamping `1` — that a missing flag refuses the good *forever*
   * while its workshop jams at output cap — is answered by writing the field,
   * not by its value.
   *
   * **Two `-1`s appended to `limits`**, per the production-control append
   * ritual: exactly its own two, so an older save migrated after some later
   * good exists still arrives at that good's rung with the right count.
   *
   * The three kinds need nothing in the state at all. The **bump** is for the
   * older build: `BuildingKind` gained three values, and without a version rise
   * an old build would load a kind-12 save cleanly and crash on its first frame
   * (`defOf` of an unknown kind is `undefined`) — rung 8's reason, three kinds
   * over.
   */
  10: (state) => {
    const s = object(state);
    return {
      ...s,
      buildings:
        Array.isArray(s.buildings) ?
          s.buildings.map((b) =>
            b && typeof b === "object" ? { ...(b as Record<string, unknown>), acceptHoney: 0, acceptMead: 0 } : b,
          )
        : s.buildings,
      limits: Array.isArray(s.limits) ? [...s.limits, -1, -1] : s.limits,
    };
  },
};

/**
 * Drop `PROVISION_BREAD` loaves per settled colonist at the colony, exactly as
 * `createSim` gives a fresh one — anchored on the **lowest-id building**, or on
 * the map centre when the save holds none.
 *
 * This is live sim code inside a migration, so it is **guarded** the way the
 * v3 lair pass is: `decode` promises a whole store or a `SaveError` and nothing
 * else, and `spawnItem` handed a malformed world would throw a raw TypeError
 * straight past that promise and put a stack trace in the menu's note row. A
 * save that fails these checks simply gets no bread and is refused a moment
 * later by `assertSim`.
 *
 * `dropTile` returning null on congested ground is **accepted**: a shorted
 * grant means the colony is hungry sooner, and hungry only ever plateaus.
 */
function grantProvisions(next: Record<string, unknown>, tiles: number): void {
  const world = object(next.world);
  if (tiles <= 0 || typeof next.nextId !== "number") return;
  if (!Number.isInteger(world.size) || (world.size as number) <= 0) return;
  for (const layer of [world.hmap, world.tmap, world.treeMap, next.wallMap]) {
    if (!(layer instanceof Uint8Array) || layer.length !== tiles) return;
  }
  if (!Array.isArray(next.items) || !Array.isArray(next.buildings) || !Array.isArray(next.colonists)) return;
  // Per *entry*, not merely per array: this rung passes a non-object building
  // through untouched so `assertSim` can refuse the save, and `occupancy`
  // reading `.y` off a `null` would throw a raw TypeError straight past
  // `decode`'s promise — the exact failure the guard above exists to prevent,
  // one level down. The colonist loop below guards its own entries the same way.
  for (const b of next.buildings) if (!b || typeof b !== "object") return;

  const sim = next as unknown as Sim;
  let mouths = 0;
  for (const c of next.colonists) {
    // A wanderer still walking in eats nothing and is owed nothing — their
    // clock starts at settling, so the grant counts the same heads the arrival
    // gate does.
    if (c && typeof c === "object" && (c as Record<string, unknown>).dest === -1) mouths++;
  }
  if (mouths === 0) return;

  let anchor: Building | null = null;
  for (const b of sim.buildings) if (!anchor || b.id < anchor.id) anchor = b;
  const centre = Math.floor((world.size as number) / 2);
  const ax = anchor ? anchor.x : centre;
  const ay = anchor ? anchor.y : centre;
  const occ = occupancy(sim);
  for (let n = 0; n < PROVISION_BREAD * mouths; n++) spawnItem(sim, ItemType.Bread, ax, ay, occ);
}

/**
 * Ground this save's colony has already claimed, as a per-tile mask: everything
 * it had enclosed, **plus every tile carrying a wall**.
 *
 * The enclosure half is computed here rather than trusted from the file:
 * `insideMap` is derived, a migrating save's copy may be stale or hand-edited,
 * and `decode` recomputes it after every rung anyway. So the layer is replaced
 * with a fresh one of the right length and the real fill runs over the save's
 * own `wallMap` — with `monsters` still empty, so it seeds from the map edge
 * alone and answers exactly the question being asked: *what was inside before
 * any den existed?* The write is deliberate and harmless: `decode`'s own
 * recompute overwrites it a moment later, that time with the new dens seeding
 * it too.
 *
 * **The wall half is not belt-and-braces, it is the same failure by a different
 * door.** A wall tile is never "inside" (the enclosure excludes the ground
 * under a segment), so masking enclosed tiles alone still lets a den land *on*
 * the ring — and since a lair seeds the flood unconditionally, one den on a
 * segment floods the interior behind it and the colony loses its enclosure
 * exactly as if the den had been placed in the middle. Refusing wall tiles also
 * makes the rung agree with the live rule: `canPlaceWall` refuses a lair tile,
 * so a den under a standing segment is a state the game never otherwise
 * produces.
 *
 * Guarded on the wall layer for the same reason the rung guards the world: this
 * is live sim code, and a save missing or mis-sizing `wallMap` would throw a
 * raw TypeError straight out of `decode`, which promises a `SaveError` or a
 * whole store and nothing else. A save that fails the check claims nothing as
 * far as this pass is concerned, and `assertSim` refuses it a moment later.
 */
function enclosedBefore(next: Record<string, unknown>, tiles: number): Uint8Array {
  const claimed = new Uint8Array(tiles);
  const wall = next.wallMap;
  if (!(wall instanceof Uint8Array) || wall.length !== tiles) return claimed;

  const inside = new Uint8Array(tiles);
  next.insideMap = inside;
  recomputeEnclosure(next as unknown as Sim);
  // Copied out rather than OR-ed in place, so what stays on the state is a
  // truthful `insideMap` rather than a mask wearing its name — even though
  // `decode` is about to recompute it anyway.
  for (let i = 0; i < tiles; i++) claimed[i] = inside[i] || wall[i] !== 0 ? 1 : 0;
  return claimed;
}

function object(state: unknown): Record<string, unknown> {
  return state && typeof state === "object" ? (state as Record<string, unknown>) : {};
}

/**
 * Tiles in the save's **own** world. Read off the file rather than from
 * `WORLD_SIZE`: a migration describes the save it is handed, not the build
 * reading it. A nonsense size yields zero-length layers and `assertSim`
 * refuses the save, which is the correct outcome — a rung guesses at nothing.
 */
function tileCount(s: Record<string, unknown>): number {
  const world = object(s.world);
  const size = typeof world.size === "number" && Number.isInteger(world.size) && world.size > 0 ? world.size : 0;
  return size * size;
}
