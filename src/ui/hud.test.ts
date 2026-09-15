import { describe, expect, it } from "vitest";
import { GOOD_LIST, ItemType, type ItemTypeValue, type StoredGood } from "../sim/know";
import { GOOD_GROUP, GROUP_ORDER, millNote, railCaption, stockNote, tookCaption, watchNote } from "./hud";

/**
 * The pieces of the HUD that are logic rather than markup: which tool the
 * rail's caption strip names, which group each good's Stores row files itself
 * under, and what a workshop's and a Watchtower's panel say about themselves.
 * Everything else is verified in the browser, per `src/ui/CLAUDE.md`.
 */

describe("the rail's caption strip", () => {
  it("shows nothing when nothing is hovered, focused or held", () => {
    expect(railCaption(null, null, null)).toBeNull();
  });

  it("names the active tool in gold when nothing is being previewed", () => {
    expect(railCaption(null, null, "wall")).toEqual({ kind: "tool", tool: "wall", gold: true });
  });

  it("lets a hover outrank the active tool, in plain ink", () => {
    expect(railCaption("gate", null, "wall")).toEqual({ kind: "tool", tool: "gate", gold: false });
  });

  it("lets keyboard focus name a tool when the pointer is elsewhere", () => {
    expect(railCaption(null, "mine", "wall")).toEqual({ kind: "tool", tool: "mine", gold: false });
  });

  it("prefers the pointer to the keyboard when both have a claim", () => {
    expect(railCaption("chop", "mine", null)).toEqual({ kind: "tool", tool: "chop", gold: false });
  });

  // Hovering the tool you are already holding is still your intent, so the
  // strip keeps its gold rather than dropping to ink under the pointer.
  it("keeps the gold when the previewed tool is the active one", () => {
    expect(railCaption("wall", null, "wall")).toEqual({ kind: "tool", tool: "wall", gold: true });
    expect(railCaption(null, "wall", "wall")).toEqual({ kind: "tool", tool: "wall", gold: true });
  });

  it("previews a tool even with no tool held", () => {
    expect(railCaption("oven", null, null)).toEqual({ kind: "tool", tool: "oven", gold: false });
  });

  // What a released box took is the feedback that survives occlusion — a box
  // across a ridge marks the far slope and the marks are behind the crest — so
  // it outranks the caption naming the tool that is still held.
  it("lets a released box's count outrank the active tool, in gold", () => {
    expect(railCaption(null, null, "chop", "47 trees")).toEqual({
      kind: "report",
      text: "47 trees",
      gold: true,
    });
  });

  it("still lets a rail preview outrank the count", () => {
    expect(railCaption("mine", null, "chop", "47 trees")).toEqual({ kind: "tool", tool: "mine", gold: false });
    expect(railCaption(null, "mine", "chop", "47 trees")).toEqual({ kind: "tool", tool: "mine", gold: false });
  });

  it("reports a count even with no tool held", () => {
    expect(railCaption(null, null, null, "no trees")).toEqual({ kind: "report", text: "no trees", gold: true });
  });
});

describe("what a released box says it took", () => {
  it("names what each area tool counts, singular and plural", () => {
    expect(tookCaption({ kind: "chop" }, 47)).toBe("47 trees");
    expect(tookCaption({ kind: "chop" }, 1)).toBe("1 tree");
    expect(tookCaption({ kind: "mine" }, 3)).toBe("3 outcrops");
    expect(tookCaption({ kind: "raze" }, 1)).toBe("1 segment");
    expect(tookCaption({ kind: "terraform" }, 12)).toBe("12 tiles");
  });

  // Zero is the case the line exists for: a box that caught nothing and a box
  // whose marks are all behind a rise look identical on screen.
  it("says so when the box took nothing", () => {
    expect(tookCaption({ kind: "chop" }, 0)).toBe("no trees");
    expect(tookCaption({ kind: "terraform" }, 0)).toBe("no tiles");
  });

  it("has nothing to say for a tool whose drag is not a box", () => {
    expect(tookCaption({ kind: "wall", material: "timber" }, 4)).toBeNull();
    expect(tookCaption({ kind: "none" }, 4)).toBeNull();
  });
});

describe("the Stores panel's grouping", () => {
  // The type is the real guard — a good with no entry will not compile — but
  // this is what catches a group name that is spelled right and filed wrong.
  it("gives every good a group the panel actually emits", () => {
    for (const good of GOOD_LIST) {
      expect(GROUP_ORDER).toContain(GOOD_GROUP[good.type]);
    }
  });

  it("groups each chain together", () => {
    const of = (type: ItemTypeValue): string => GOOD_GROUP[type];
    expect([of(ItemType.Log), of(ItemType.Plank)]).toEqual(["wood", "wood"]);
    expect([of(ItemType.Rock), of(ItemType.Block)]).toEqual(["stone", "stone"]);
    expect([of(ItemType.Grain), of(ItemType.Flour), of(ItemType.Bread)]).toEqual(["food", "food", "food"]);
    expect([of(ItemType.Wool), of(ItemType.Cloth), of(ItemType.Clothes)]).toEqual(["cloth", "cloth", "cloth"]);
    // Cheese files with the food it *is*, not with the chain that made it —
    // which is also the case the fixed emission order below exists for: it is
    // the newest good in the enum and its row belongs between Bread and Wool.
    expect(of(ItemType.Cheese)).toBe("food");
  });

  // Emission order is fixed rather than read off the enum: `ItemType` is
  // append-only, so a future wood good would land after Bread and an
  // emit-on-change walk would file it under Food. Cheese is that case having
  // actually happened — appended last, emitted with Food.
  it("emits the groups in a fixed order, not in enum order", () => {
    expect([...GROUP_ORDER]).toEqual(["wood", "stone", "food", "cloth", "drink"]);
  });
});

describe("a stockpile's second note row", () => {
  /** A pile's `stored` list, built from the goods table so a new good cannot
   *  quietly fall out of the note's reach. */
  const pile = (patch: Partial<Record<number, Partial<StoredGood>>> = {}): { stored: StoredGood[] } => ({
    stored: GOOD_LIST.map((good) => ({
      type: good.type,
      name: good.name,
      count: 0,
      accepted: false,
      clearing: false,
      stuck: false,
      ...patch[good.type],
    })),
  });

  it("says what an accept-nothing pile is waiting for", () => {
    expect(stockNote(pile())).toBe("accepts nothing yet — turn on what this pile should take");
  });

  it("falls silent the moment one good is turned on", () => {
    expect(stockNote(pile({ [ItemType.Log]: { accepted: true } }))).toBeNull();
  });

  it("names a stuck clear, and the good it is stuck on", () => {
    expect(stockNote(pile({ [ItemType.Plank]: { count: 3, clearing: true, stuck: true } }))).toBe(
      "clearing planks — no other pile will take them",
    );
  });

  it("names the first stuck good in goods order when more than one is", () => {
    const both = pile({
      [ItemType.Log]: { count: 1, clearing: true, stuck: true },
      [ItemType.Plank]: { count: 3, clearing: true, stuck: true },
    });
    expect(stockNote(both)).toBe("clearing logs — no other pile will take them");
  });

  it("lets a pile that is clearing something keep its silence, accepting nothing or not", () => {
    // A pile emptying itself is not a pile waiting to be configured, so the
    // accept-nothing note would be the wrong sentence — but only while it still
    // holds some, since a finished clear reads as `off` everywhere else.
    expect(stockNote(pile({ [ItemType.Plank]: { count: 3, clearing: true } }))).toBeNull();
    expect(stockNote(pile({ [ItemType.Plank]: { count: 0, clearing: true } }))).toBe(
      "accepts nothing yet — turn on what this pile should take",
    );
  });
});

describe("a Watchtower's note row", () => {
  /**
   * Four wordings off two facts, and the panel may never claim coverage it
   * does not have: coverage needs the watcher *inside*, so the note is keyed
   * off where the worker is and never off `staffed`
   * (docs/specs/2026-09-09-watchtowers.md).
   */
  it("claims coverage only while the watcher is inside", () => {
    expect(watchNote({ watching: 3, worker: "inside" })).toBe("watching 3 dens");
  });

  it("says the watcher is away while they walk or eat", () => {
    // The two states the browser cannot easily be held in, and the two that
    // matter most: a tower mid-handover and a watcher at lunch are both
    // sharpening nothing, and the panel has to say so.
    expect(watchNote({ watching: 3, worker: "walking" })).toBe("3 dens in reach — the watcher is away");
    expect(watchNote({ watching: 3, worker: "eating" })).toBe("3 dens in reach — the watcher is away");
  });

  it("says what an unstaffed tower would watch", () => {
    expect(watchNote({ watching: 3, worker: "none" })).toBe("3 dens in reach — no watcher");
  });

  it("counts one den in the singular", () => {
    expect(watchNote({ watching: 1, worker: "inside" })).toBe("watching 1 den");
    expect(watchNote({ watching: 1, worker: "none" })).toBe("1 den in reach — no watcher");
  });

  it("puts a tower in the wrong place above every other wording", () => {
    // Nothing in range is worth saying whoever is standing in it — a tower
    // watching no dens is a tower sited badly, not a staffing problem.
    for (const worker of ["inside", "walking", "eating", "none"] as const) {
      expect(watchNote({ watching: 0, worker })).toBe("the watcher sees no dens from here");
    }
  });
});

/**
 * A workshop's note row, and the one rule it exists for: **it may never claim
 * work that is not happening, and never a stall that is not happening either.**
 * Both self-errands take the slot worker out of the building, so both need a
 * line of their own — with neither, a Pasture whose shepherd is at a fitting
 * read "working" with nobody in it.
 */
describe("a workshop's note row", () => {
  const shed = (patch: Partial<Parameters<typeof millNote>[0]> = {}): Parameters<typeof millNote>[0] => ({
    staffed: true,
    worker: "inside",
    chain: { input: "Wool", output: "Cloth" },
    stall: "none",
    colonyCount: 0,
    outputType: 8,
    ...patch,
  });

  it("says who is missing before it says anything about the recipe", () => {
    expect(millNote(shed({ staffed: false }))).toBe("no one is working here");
    expect(millNote(shed({ worker: "eating" }))).toBe("gone to eat — back shortly");
    expect(millNote(shed({ worker: "dressing" }))).toBe("gone for clothes — back shortly");
  });

  it("never reports a stall for a worker who is simply away", () => {
    // `inspect` already gates `stall` on both errands, so this is belt to that
    // braces — but the note is a second reader of the same fact, and the one a
    // player actually reads.
    for (const worker of ["eating", "dressing"] as const) {
      expect(millNote(shed({ worker, stall: "no-input" }))).not.toContain("waiting");
    }
  });

  it("says working only when somebody is actually in there", () => {
    expect(millNote(shed())).toBe("working");
    expect(millNote(shed({ stall: "no-input" }))).toBe("waiting for wool");
  });
});
