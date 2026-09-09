import { describe, expect, it } from "vitest";
import { GOOD_LIST, ItemType, type ItemTypeValue } from "../sim/know";
import { GOOD_GROUP, GROUP_ORDER, railCaption, watchNote } from "./hud";

/**
 * The pieces of the HUD that are logic rather than markup: which tool the
 * rail's caption strip names, which group each good's Stores row files itself
 * under, and what a Watchtower's panel says it is watching. Everything else is
 * verified in the browser, per `src/ui/CLAUDE.md`.
 */

describe("the rail's caption strip", () => {
  it("shows nothing when nothing is hovered, focused or held", () => {
    expect(railCaption(null, null, null)).toBeNull();
  });

  it("names the active tool in gold when nothing is being previewed", () => {
    expect(railCaption(null, null, "wall")).toEqual({ tool: "wall", gold: true });
  });

  it("lets a hover outrank the active tool, in plain ink", () => {
    expect(railCaption("gate", null, "wall")).toEqual({ tool: "gate", gold: false });
  });

  it("lets keyboard focus name a tool when the pointer is elsewhere", () => {
    expect(railCaption(null, "mine", "wall")).toEqual({ tool: "mine", gold: false });
  });

  it("prefers the pointer to the keyboard when both have a claim", () => {
    expect(railCaption("chop", "mine", null)).toEqual({ tool: "chop", gold: false });
  });

  // Hovering the tool you are already holding is still your intent, so the
  // strip keeps its gold rather than dropping to ink under the pointer.
  it("keeps the gold when the previewed tool is the active one", () => {
    expect(railCaption("wall", null, "wall")).toEqual({ tool: "wall", gold: true });
    expect(railCaption(null, "wall", "wall")).toEqual({ tool: "wall", gold: true });
  });

  it("previews a tool even with no tool held", () => {
    expect(railCaption("oven", null, null)).toEqual({ tool: "oven", gold: false });
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
  });

  // Emission order is fixed rather than read off the enum: `ItemType` is
  // append-only, so a future wood good would land after Bread and an
  // emit-on-change walk would file it under Food.
  it("emits the groups in a fixed order, not in enum order", () => {
    expect([...GROUP_ORDER]).toEqual(["wood", "stone", "food"]);
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
