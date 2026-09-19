import type { Command } from "../sim/commands";
import {
  BUILDING_DEFS,
  BuildingKind,
  BuildingState,
  GOODS,
  GOOD_LIST,
  HIVE_FIELDS_MAX,
  HIVE_REACH,
  ItemType,
  UNLIMITED,
  WALL_ITEM_COST,
  inspect,
  monsterName,
  type Inspection,
  monsters,
  readout,
  forecast,
  stepLimit,
  wallItem,
  type BuildingKindValue,
  type GoodDef,
  type ItemTypeValue,
  type Sim,
  type StoredGood,
  type WallMaterial,
} from "../sim/know";
import "./hud.css";

/**
 * The HUD: top ribbon, a left-edge column carrying the build rail over the
 * Stores panel, the right inspector, and a labour panel pinned to the
 * bottom-right.
 *
 * Plain DOM, per ARCHITECTURE.md — no framework. Every visual token comes from
 * `docs/STYLEGUIDE.md` via hud.css; nothing here picks a colour or a size.
 *
 * The HUD reads `sim/know` and never touches the store: intent leaves through
 * `send`, which queues a command for the next tick boundary.
 */

export type Tool =
  | { kind: "none" }
  | { kind: "chop" }
  | { kind: "mine" }
  | { kind: "terraform" }
  | { kind: "build"; building: BuildingKindValue }
  /** A wall tool carries its own material: two buttons, never one button with
   *  a mode, so a forgotten setting can never raise the wrong wall. */
  | { kind: "wall"; material: WallMaterial }
  | { kind: "gate"; material: WallMaterial }
  | { kind: "raze" };

/** The tools that put walls on the map, and the ones the enclosure wash
 *  appears for. Nothing tints the world permanently. */
export function isWallTool(tool: Tool): boolean {
  return tool.kind === "wall" || tool.kind === "gate" || tool.kind === "raze";
}

/** The four tools whose left-drag is an area box on the ground rather than a
 *  run. Named as a type so `TOOK_NOUN` cannot fall out of step with the set. */
export type AreaKind = "chop" | "mine" | "raze" | "terraform";

/** The tools whose left-drag is an area box on the ground rather than a run. */
export function isAreaTool(tool: Tool): tool is Tool & { kind: AreaKind } {
  return tool.kind === "chop" || tool.kind === "raze" || tool.kind === "mine" || tool.kind === "terraform";
}

/** The tools whose left-drag draws a wall run — an L of two legs. A gateway
 *  is a single tile in either material, so it is never a run. */
export function isRunTool(tool: Tool): boolean {
  return tool.kind === "wall";
}

/**
 * Which rail button a tool belongs to. One place, because the pressed state,
 * the click handler and the tool itself all have to agree on it — and a
 * material is part of the identity, or the stone buttons would share the
 * timber ones' pressed state.
 */
function toolKey(tool: Tool): string {
  if (tool.kind === "build") return BUILDING_DEFS[tool.building].name.toLowerCase();
  if (tool.kind === "wall" || tool.kind === "gate") {
    return tool.material === "stone" ? `stone${tool.kind}` : tool.kind;
  }
  return tool.kind;
}

/** Which of the rail's three sections is open. The rail shows exactly one. */
export type RailSection = "orders" | "build" | "walls";

/**
 * The rail's tab strip, in order.
 *
 * All three sections are tabs, including Orders and Walls at four tools each —
 * a rail whose sections behaved differently from one another would be harder to
 * learn than one that does not, and Walls has already grown once (timber, then
 * stone).
 */
const RAIL_SECTIONS: readonly { readonly key: RailSection; readonly label: string }[] = [
  { key: "orders", label: "Orders" },
  { key: "build", label: "Build" },
  { key: "walls", label: "Walls" },
];

export interface HudPorts {
  send(command: Command): void;
  setSpeed(speed: number): void;
  getSpeed(): number;
  /** Open or close the menu. The menu outlives any one sim, so the HUD only
   *  ever asks — it never owns the panel. */
  toggleMenu(): void;
  menuOpen(): boolean;
}

const SPEEDS: readonly { label: string; value: number; title: string }[] = [
  { label: "❚❚", value: 0, title: "Pause" },
  { label: "×1", value: 1, title: "Normal speed" },
  { label: "×2", value: 2, title: "Double speed" },
  { label: "×4", value: 4, title: "Quadruple speed" },
];

/**
 * The resource icons' colours, keyed by good. These are *UI* tokens from
 * docs/STYLEGUIDE.md, so they live here rather than in the sim's goods table —
 * which knows what a good is called and how storage treats it, and nothing
 * about how it is painted.
 */
const GOOD_VAR: Record<ItemTypeValue, string> = {
  [ItemType.Log]: "var(--timber)",
  [ItemType.Plank]: "var(--plank)",
  [ItemType.Rock]: "var(--rock)",
  [ItemType.Block]: "var(--block)",
  [ItemType.Grain]: "var(--grain)",
  [ItemType.Flour]: "var(--flour)",
  [ItemType.Bread]: "var(--bread)",
  [ItemType.Wool]: "var(--wool)",
  [ItemType.Cloth]: "var(--cloth)",
  [ItemType.Clothes]: "var(--clothes)",
  [ItemType.Cheese]: "var(--cheese)",
  [ItemType.Honey]: "var(--honey)",
  [ItemType.Mead]: "var(--mead)",
};

/**
 * The Stores panel's groups, in the order it emits them — **fixed here rather
 * than read off the enum**, because `ItemType` is append-only and a future wood
 * good would be appended after Bread. Cheese is exactly that case: it is the
 * newest good in the enum and it files under Food, at its foot — between Bread
 * and Wool.
 *
 * Cloth goes **after** food: the chain arrived after the bread chain, it is the
 * one group whose goods are not consumed by a building, and reading the panel
 * top to bottom then tells the colony's own story in the order it was built.
 * Drink goes after cloth for the same reason, and it is a **fifth group rather
 * than a corner of Food**: a group is what a colonist does with the good, and
 * nobody eats honey or mead — `FOODS` is unchanged and the arrival gate never
 * counts either (docs/specs/2026-09-14-hives-and-mead.md).
 */
export const GROUP_ORDER = ["wood", "stone", "food", "cloth", "drink"] as const;
type GoodGroup = (typeof GROUP_ORDER)[number];

/**
 * Which chain each good belongs to, and so which of the Stores panel's three
 * groups its row files itself under.
 *
 * Presentation, exactly like `GOOD_VAR` above — the sim's goods table knows
 * what a good is called and how storage treats it, and nothing about how it is
 * grouped on a panel. The `Record` is the forcing function: a new good with no
 * entry is a compile error, and so is a typo'd group, rather than a fourth
 * heading quietly appearing. A genuinely new group means widening the union,
 * deliberately.
 */
export const GOOD_GROUP: Record<ItemTypeValue, GoodGroup> = {
  [ItemType.Log]: "wood",
  [ItemType.Plank]: "wood",
  [ItemType.Rock]: "stone",
  [ItemType.Block]: "stone",
  [ItemType.Grain]: "food",
  [ItemType.Flour]: "food",
  [ItemType.Bread]: "food",
  [ItemType.Wool]: "cloth",
  [ItemType.Cloth]: "cloth",
  [ItemType.Clothes]: "cloth",
  // Cheese is a meal, so it files with the food it is: the group is what a
  // colonist does with the good, never which building made it.
  [ItemType.Cheese]: "food",
  // Honey rides with mead as grain rides with bread: the group is the chain's,
  // and the chain's product is a drink.
  [ItemType.Honey]: "drink",
  [ItemType.Mead]: "drink",
};

const GROUP_LABEL: Record<GoodGroup, string> = {
  wood: "Wood",
  stone: "Stone",
  food: "Food",
  cloth: "Cloth",
  drink: "Drink",
};

/**
 * What the rail's caption strip is naming, and whether it may be gold.
 *
 * Two shapes: a **tool**, named by its rail key so the caller can look its
 * label and cost up, or a **report** of what a released area box just took,
 * which is prose and belongs to no button.
 *
 * `gold` is the rail's one gold element. Gold while the strip names the
 * **active** tool, or reports what that tool just did — a hover or focus
 * preview of some *other* tool reads in plain ink, because hover is not intent.
 */
export type RailCaption =
  | { readonly kind: "tool"; readonly tool: string; readonly gold: boolean }
  | { readonly kind: "report"; readonly text: string; readonly gold: boolean };

/**
 * What the caption strip shows, as a pure function of the four things that can
 * claim it: the tool under the pointer, the tool with keyboard focus, the tool
 * actually held, and the report a released box left behind.
 *
 * A preview wins over both — you are asking what that button is — and the
 * report outranks the plain active-tool caption, because the count is the one
 * piece of feedback that survives a box drawn across a ridge: the marks it made
 * on the far slope are behind the crest, and the number is not. No timer holds
 * it; it stands until something else claims the strip, which keeps this a pure
 * function of its inputs.
 *
 * With nothing to show the strip is empty rather than absent, so the rail never
 * changes height under the pointer.
 */
export function railCaption(
  hovered: string | null,
  focused: string | null,
  active: string | null,
  report: string | null = null,
): RailCaption | null {
  const preview = hovered ?? focused;
  if (preview !== null) return { kind: "tool", tool: preview, gold: preview === active };
  if (report !== null) return { kind: "report", text: report, gold: true };
  if (active !== null) return { kind: "tool", tool: active, gold: true };
  return null;
}

/** What each area tool counts, singular and plural. */
const TOOK_NOUN: Record<AreaKind, readonly [string, string]> = {
  chop: ["tree", "trees"],
  mine: ["outcrop", "outcrops"],
  raze: ["segment", "segments"],
  terraform: ["tile", "tiles"],
};

/**
 * What a released area box says it took — `47 trees`, `1 outcrop`, `no tiles`.
 *
 * Zero is reported rather than swallowed, and that is the case the line exists
 * for: a box that caught nothing and a box whose marks are all behind a rise
 * look identical on screen, so silence would be the one answer the player
 * cannot act on.
 *
 * Null for any tool whose drag is not a box, which is the caller's guard as
 * well as this function's.
 */
export function tookCaption(tool: Tool, count: number): string | null {
  if (!isAreaTool(tool)) return null;
  const [one, many] = TOOK_NOUN[tool.kind];
  return `${count === 0 ? "no" : count} ${count === 1 ? one : many}`;
}

/** What `millNote` needs off an `Inspection` — narrowed so a test can hand it
 *  a literal, as `watchNote`'s signature already allows. */
type MillNote = Pick<
  Inspection,
  "staffed" | "worker" | "chain" | "stall" | "colonyCount" | "outputType"
>;

/** How the inspector names where a slot worker is. */
const WORKER_LABEL: Record<Inspection["worker"], string> = {
  none: "none",
  walking: "on the way",
  inside: "inside",
  eating: "eating",
  dressing: "dressing",
};

/**
 * The icons for every tool that is **not** a building — orders and walls. Flat
 * line marks in `currentColor`, so the rail's gold pressed state carries
 * through without a second asset.
 *
 * Keyed by `toolKey`, and loosely: this set changes about once a year, and a
 * missing entry falls through to an empty button. The buildings, which change
 * once a chain, are in `BUILDING_ICONS` below and are compile-forced instead.
 */
const ICONS: Record<string, string> = {
  // Axe at a trunk. Pick swung at an outcrop. Ground stepping down to a level
  // line. A stake coming apart.
  chop: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 15 L12 6"/><path d="M11 2 L19 6 L14 11 L9 5 Z"/></svg>`,
  mine: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 15 L11 7"/><path d="M7 3 q5 1 8 5"/><path d="M15 8 l-4 -5"/><path d="M13 15 h6 l-2 -4 h-3 Z"/></svg>`,
  terraform: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 14 h5 v-4 h5 v-4 h6"/><path d="M3 6 h6"/><path d="M6 4 v4"/></svg>`,
  raze: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 15 V7 L3 4"/><path d="M16 15 V8 L19 4"/><path d="M9 11 l4 -3"/><path d="M11 4 v3"/></svg>`,
  // Palisade: stakes under two rails. Gate: the same run with the middle open
  // under a lintel. Stone wall: coursed blocks. Stone gate: the same arch,
  // squared.
  wall: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 15 V5"/><path d="M8 15 V4"/><path d="M12 15 V5"/><path d="M16 15 V4"/><path d="M3 8 h16"/><path d="M3 12 h16"/></svg>`,
  gate: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 15 V6"/><path d="M17 15 V6"/><path d="M3 5 h16"/><path d="M9 15 v-4"/><path d="M13 15 v-4"/></svg>`,
  stonewall: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="6" width="16" height="4"/><rect x="3" y="10" width="16" height="4"/><path d="M8 6 v4"/><path d="M14 6 v4"/><path d="M5 10 v4"/><path d="M11 10 v4"/><path d="M17 10 v4"/></svg>`,
  stonegate: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="4" width="16" height="3"/><path d="M5 15 V7 h3 v8"/><path d="M17 15 V7 h-3 v8"/></svg>`,
};

/**
 * One icon per building, **keyed by kind and typed as a total `Record`** — so a
 * new `BuildingKind` with no icon is a compile error rather than a blank cell.
 *
 * That forcing function is the point of the split. The rail is icon-only, so a
 * button with no entry reads to the player as a *missing building*, and
 * `ICONS`' loose `Record<string, string>` with a `?? ""` fallback was the one
 * per-kind table in this codebase with nothing behind it — which is exactly how
 * the drink chain's three shipped blank past a build and two reviews.
 * `BUILDING_DEFS`, `GOODS`, `GOOD_VAR`, `GOOD_GROUP` and `GOOD_HEX` were all
 * already forced this way (docs/specs/2026-09-14-hives-and-mead.md).
 *
 * Same idiom throughout: a 22×18 viewBox, `fill="none"`, `currentColor` at 1.4.
 */
const BUILDING_ICONS: Record<BuildingKindValue, string> = {
  // A crate pair under a lintel. A gabled mill house. A block on a bench under
  // a chisel. A gabled box with a door — beds, and nothing that looks like work.
  [BuildingKind.Stockpile]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="7" width="7" height="7"/><rect x="12" y="7" width="7" height="7"/><path d="M3 5 h16"/></svg>`,
  [BuildingKind.Sawmill]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 8 L11 3 L19 8"/><rect x="5" y="8" width="12" height="7"/><path d="M9 15 v-4 h4 v4"/></svg>`,
  [BuildingKind.Mason]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="9" width="14" height="6"/><path d="M11 9 v6"/><path d="M8 6 h6"/><path d="M11 3 v3"/></svg>`,
  [BuildingKind.House]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 9 L11 3 L19 9"/><rect x="5" y="9" width="12" height="6"/><path d="M9 15 v-4 h4 v4"/></svg>`,
  // The bread chain: furrows under a fence line, a hopper over a millstone, a
  // domed stone oven with its mouth and a wisp above it.
  [BuildingKind.Farm]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 5 h16"/><path d="M3 15 l3 -7"/><path d="M9 15 l3 -7"/><path d="M15 15 l3 -7"/><path d="M6 3 v4"/><path d="M16 3 v4"/></svg>`,
  [BuildingKind.Mill]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 3 h10 l-2 5 h-6 Z"/><rect x="5" y="10" width="12" height="4"/><path d="M11 8 v2"/><path d="M4 15 h14"/></svg>`,
  [BuildingKind.Oven]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 15 V9 q7 -6 14 0 v6 Z"/><path d="M9 15 v-3 h4 v3"/><path d="M16 6 q2 -2 0 -4"/></svg>`,
  // Watchtower: battered legs under a railed platform with a cap over it — the
  // prop's own silhouette, which is all a 1×1 has to be recognised by.
  [BuildingKind.Watchtower]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M7 15 L9 7"/><path d="M15 15 L13 7"/><path d="M8 11 h6"/><path d="M6 7 h10"/><path d="M6 5 h10"/><path d="M8 5 V3 h6 v2"/></svg>`,
  // The sheep chain. Pasture: a fenced run with a sheep standing in it. Dairy:
  // a churn under a wheel of cheese. Weaver: a warp on a loom frame. Tailor:
  // shears over a folded bolt.
  [BuildingKind.Pasture]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 5 h16"/><path d="M6 3 v4"/><path d="M16 3 v4"/><path d="M3 15 h16"/><path d="M8 13 q0 -3 3 -3 q3 0 3 3 Z"/><path d="M14 11 l2 -1"/><path d="M9 13 v2"/><path d="M13 13 v2"/></svg>`,
  [BuildingKind.Dairy]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 15 L7 7 h5 l1 8 Z"/><path d="M7 4 h5"/><path d="M9 4 v3"/><path d="M15 15 a3 3 0 0 1 3 -3 v3 Z"/></svg>`,
  [BuildingKind.Weaver]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="3" width="14" height="12"/><path d="M7 3 v12"/><path d="M11 3 v12"/><path d="M15 3 v12"/><path d="M4 9 h14"/></svg>`,
  [BuildingKind.Tailor]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="10" width="16" height="5"/><path d="M3 12.5 h16"/><path d="M7 8 L13 3"/><path d="M13 8 L7 3"/><circle cx="6" cy="8.6" r="1.2"/><circle cx="14" cy="8.6" r="1.2"/></svg>`,
  // The drink chain, and each is drawn away from the one it could be confused
  // with. The Hive is a **banded skep** with an entrance arch at its foot —
  // stacked bands, not the Oven's single dome with a door and a chimney curl.
  // Flowers is **blooms on stems** over a ground line; circles on stems are in
  // nothing else in the set, so it can be neither the Farm's furrows nor the
  // Pasture's fence. The Meadery is a **cask on its side** with two hoops and a
  // spigot, lying down where the Dairy's churn stands up.
  [BuildingKind.Hive]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 15 q0 -12 6 -12 q6 0 6 12 Z"/><path d="M5.5 11 h11"/><path d="M6.5 7 h9"/><path d="M9.5 15 v-2 q1.5 -1.5 3 0 v2"/></svg>`,
  [BuildingKind.Flowers]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 15 h16"/><path d="M7 15 V9"/><circle cx="7" cy="7" r="2"/><path d="M11 15 V6"/><circle cx="11" cy="4" r="2"/><path d="M15 15 V9"/><circle cx="15" cy="7" r="2"/></svg>`,
  [BuildingKind.Meadery]: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 5 q6 -2 12 0 v8 q-6 2 -12 0 Z"/><path d="M9 4 v10"/><path d="M13 4 v10"/><path d="M17 9 h2 v2"/></svg>`,
};

export class Hud {
  private readonly root: HTMLElement;
  private readonly res: Record<string, HTMLElement> = {};
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly toolButtons = new Map<string, HTMLButtonElement>();
  private readonly toolCaptions = new Map<string, { name: string; cost: string }>();
  /** The tab strip's three buttons and the three grids they show, by section. */
  private readonly railTabs = new Map<RailSection, HTMLButtonElement>();
  private readonly railPanels = new Map<RailSection, HTMLElement>();
  /** Which section each tool's button lives in, so the strip can mark the tab
   *  owning a tool that is being held while its section is closed. */
  private readonly toolSection = new Map<string, RailSection>();
  /** The rail's caption strip, built up front because `buildRail` only hangs
   *  it on the end of the column it returns. */
  private readonly caption = el("div", { class: "rail-caption" });
  private readonly captionName = el("b");
  private readonly captionCost = el("u");
  /** Which tool the pointer is over, and which one holds keyboard focus — the
   *  two previews that outrank the active tool in the caption strip. */
  private hovered: string | null = null;
  private focused: string | null = null;
  private readonly inspector: HTMLElement;
  private readonly labourMeter: HTMLElement;
  private readonly labourLegend: HTMLElement;
  /**
   * What the last released area box took, as the caption strip's prose — or
   * null. Set on release, cleared by anything else that claims the strip: a
   * rail preview, a tool change, or the next gesture starting.
   */
  private report: string | null = null;
  private readonly menuButton = el("button", {
    class: "speedbtn",
    type: "button",
    title: "Menu — save, load, export",
    "aria-pressed": "false",
  }) as HTMLButtonElement;
  /** Kept so `dispose` can take it off `window` again — a load builds a new
   *  HUD, and an undead one would keep eating Escape presses forever. */
  private readonly onKeyDown: (e: KeyboardEvent) => void;

  private tool_: Tool = { kind: "none" };
  /**
   * Which rail section is open — one at a time, which is what stops the rail's
   * height depending on how many buildings exist.
   *
   * **It lives here and nowhere else.** This is view state, not game state: it
   * belongs in neither the save nor the command log, and nothing in the HUD
   * persists today — there is no `localStorage` anywhere in `src/ui/` or
   * `src/app/`, and the codebase's first storage read should not arrive as a
   * side effect of a layout fix. So **every session opens on Build**, the
   * section that grows and the one a player reaches for most.
   */
  private section: RailSection = "build";
  /**
   * What the inspector is showing. Two shapes — a building, or a monster —
   * because a landed monster is a thing worth looking at and nothing else in
   * the game is inspectable.
   */
  private selected: { kind: "building" | "monster"; id: number } | null = null;
  /** Last rendered inspector signature, so the panel only rebuilds on change. */
  private lastPanel = "";
  private readonly threatBars: HTMLElement;
  private readonly threatCaption: HTMLElement;

  constructor(
    private readonly sim: Sim,
    private readonly ports: HudPorts,
  ) {
    this.threatBars = el("div", { class: "bars", role: "img" });
    this.threatCaption = el("u", {}, "a storm is far off");
    this.root = el("div", { id: "hud" });
    this.root.append(this.buildRibbon(), this.buildLeftColumn());
    this.inspector = el("aside", { class: "panel inspector", "aria-live": "polite" });
    this.inspector.hidden = true;
    this.root.append(this.inspector);

    const labour = el("aside", { class: "panel labour" });
    labour.append(el("h4", {}, "Labour"));
    this.labourMeter = el("div", { class: "meter", role: "img" });
    this.labourLegend = el("p", { class: "legend" });
    labour.append(this.labourMeter, this.labourLegend);
    this.root.append(labour);

    document.body.append(this.root);
    this.onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") this.escape();
    };
    window.addEventListener("keydown", this.onKeyDown);
  }

  /**
   * Take the HUD off the page. A load replaces the whole sim-bound stack, and
   * this HUD captured the old `Sim` at construction — so it has to go, window
   * listener and all, or its Escape handler keeps firing over the new game's.
   */
  dispose(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    this.root.remove();
  }

  get tool(): Tool {
    return this.tool_;
  }

  /**
   * What the inspector is showing, for the one overlay that keys off a
   * selection rather than off a tool: a selected Watchtower draws its own
   * watch range. Read-only — `select` and `selectMonster` are still the only
   * ways in.
   */
  get selection(): { kind: "building" | "monster"; id: number } | null {
    return this.selected;
  }

  /**
   * The Escape ladder: **one rung per press**, in this one place.
   *
   * An open menu closes; else an active tool is dropped; else a selection is
   * cleared; else the menu opens. The menu is checked first rather than last
   * so that a selection left standing behind an open panel cannot swallow the
   * press that was meant to close it.
   *
   * Abandoning an in-flight drag is not a rung — `app/main.ts` owns that
   * gesture state and cancels it on the same press.
   */
  escape(): void {
    if (this.ports.menuOpen()) {
      this.ports.toggleMenu();
      return;
    }
    if (this.tool_.kind !== "none") {
      this.setTool({ kind: "none" });
      return;
    }
    if (this.selected) {
      this.selected = null;
      return;
    }
    this.ports.toggleMenu();
  }

  /** Clear the active tool and any selection — a right-click. */
  clear(): void {
    this.setTool({ kind: "none" });
    this.selected = null;
  }

  /**
   * Say in the caption strip what a released area box took. A press claims the
   * strip with `null` before the gesture that will fill it, so the previous
   * box's count can never be mistaken for this one's.
   */
  took(count: number | null): void {
    this.report = count === null ? null : tookCaption(this.tool_, count);
    this.renderCaption();
  }

  /** Show a building in the inspector, or nothing when the id is -1. */
  select(buildingId: number): void {
    this.selected = buildingId >= 0 ? { kind: "building", id: buildingId } : null;
  }

  /** Show a monster in the inspector — watching one creature's rounds, which
   *  is the per-monster version of the ribbon's meter. */
  selectMonster(id: number): void {
    this.selected = { kind: "monster", id };
  }

  /** Refresh the readouts. Called every frame; rebuilds only what changed. */
  update(): void {
    const r = readout(this.sim);
    // One `textContent` per good, into the Stores panel's rows — the same
    // numbers, off the same `readout()`, that the ribbon carried before them.
    for (const good of GOOD_LIST) this.res[`good${good.type}`].textContent = String(r.goods[good.type] ?? 0);
    // `folk` alone until the first House stands, then `folk / cap`. The suffix
    // arriving with the first house is the whole of the HUD's growth story —
    // no toast, no banner, nothing announces an arrival but this number
    // (docs/STYLEGUIDE.md, Tone).
    this.res.folk.textContent = r.cap >= 0 ? `${r.folk} / ${r.cap}` : String(r.folk);
    const hungry = this.res.hungry;
    hungry.hidden = r.hungry === 0;
    hungry.textContent = r.hungry > 0 ? `· ${r.hungry} hungry` : "";
    this.res.idle.textContent = String(r.idle);
    this.res.enclosed.textContent = String(r.enclosed);
    this.res.day.textContent = `Day ${r.day}`;

    const speed = this.ports.getSpeed();
    for (const b of this.speedButtons) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === speed));
    }
    this.menuButton.setAttribute("aria-pressed", String(this.ports.menuOpen()));

    this.updateLabour(r.folk, r.pool);
    this.updateThreat();
    this.updateInspector();
  }

  /**
   * The forecast meter: **one bar on one clock**, counting toward the next
   * landing and standing full while anything is ashore.
   *
   * It is the colony's weather rather than any one monster's hours, so there is
   * nothing to hold and nothing to re-target — which is what the old threat
   * meter needed a `watching` field for, and what made it flicker between
   * clocks (docs/specs/2026-09-17-incursions-from-the-sea.md). `sim/know` owns
   * the whole policy; the HUD only paints it.
   */
  private updateThreat(): void {
    const t = forecast(this.sim);
    const want = `${t.lit}/${t.buckets}|${t.caption}`;
    // Guarded, because `update()` runs every frame and this is DOM.
    if (this.threatBars.dataset.state === want) return;
    this.threatBars.dataset.state = want;
    this.threatBars.replaceChildren(
      ...Array.from({ length: t.buckets }, (_, i) => el("i", i < t.lit ? { class: "on" } : {})),
    );
    this.threatBars.setAttribute("aria-label", t.caption);
    this.threatCaption.textContent = t.caption;
  }

  // ---------------------------------------------------------------- ribbon

  private buildRibbon(): HTMLElement {
    const ribbon = el("div", { class: "panel ribbon" });
    ribbon.append(el("span", { class: "brand" }, "Castles"));
    // Colony facts only. The goods left for the Stores panel, and with them the
    // ribbon's one growth axis: it is the same width with seven goods as with
    // twenty, so it stays a single line at the minimum supported viewport
    // (1280×720) and never wraps again.
    ribbon.append(this.folkCluster());
    ribbon.append(this.count("idle", "idle"));
    ribbon.append(el("span", { class: "divider" }));
    // The game's progress bar: buildable ground the wall has actually claimed.
    ribbon.append(this.count("enclosed", "enclosed"));

    // And the one thing on the ribbon that is not a count: the weather — how
    // long until the wilds come, and from where. Five rust segments and a quiet
    // caption, the whole of the game's alarm vocabulary (docs/STYLEGUIDE.md).
    ribbon.append(el("span", { class: "divider" }));
    const threatBox = el("span", { class: "threat" });
    threatBox.append(this.threatBars, this.threatCaption);
    ribbon.append(threatBox);

    const clock = el("span", { class: "clock" });
    const speed = el("span", { class: "speed", role: "group", "aria-label": "Game speed" });
    for (const s of SPEEDS) {
      const b = el("button", {
        class: "speedbtn",
        type: "button",
        title: s.title,
        "aria-label": s.title,
        "aria-pressed": "false",
      }) as HTMLButtonElement;
      b.dataset.speed = String(s.value);
      b.textContent = s.label;
      b.addEventListener("click", () => this.ports.setSpeed(s.value));
      this.speedButtons.push(b);
      speed.append(b);
    }
    clock.append(speed);
    this.res.day = el("span", {}, "Day 1");
    clock.append(this.res.day);

    // The Menu button always works: with a tool active it drops the tool and
    // opens, so the player never has to guess why a click did nothing.
    this.menuButton.textContent = "Menu";
    this.menuButton.addEventListener("click", () => {
      if (!this.ports.menuOpen()) this.clear();
      this.ports.toggleMenu();
    });
    clock.append(this.menuButton);

    ribbon.append(clock);
    return ribbon;
  }

  /**
   * The folk readout, plus the one signal hunger ever gives the player: a quiet
   * `· 2 hungry` suffix, shown only while somebody is actually **slowed**.
   *
   * Ink-dim and never a colour change — rust would read as an alarm, and there
   * is nothing to react to: the colony is slower and will recover the moment
   * loaves exist again (docs/STYLEGUIDE.md, Tone).
   */
  private folkCluster(): HTMLElement {
    const span = this.count("folk", "folk");
    const hungry = el("u", { class: "hungry" });
    hungry.hidden = true;
    this.res.hungry = hungry;
    span.append(hungry);
    return span;
  }

  private count(key: string, label: string): HTMLElement {
    const span = el("span", { class: "res" });
    const value = el("b", {}, "0");
    this.res[key] = value;
    span.append(value, el("u", {}, label));
    return span;
  }

  // ----------------------------------------------------------- left column

  /**
   * The rail and the Stores panel, stacked in **one flex column** down the left
   * edge rather than pinned independently to the top and the bottom.
   *
   * That is what lets the two coexist without arithmetic: the rail takes the
   * height it wants and shrinks first (`flex: 0 1 auto`, scrolling inside
   * itself), Stores keeps its own height beneath it, and the browser resolves
   * the split at every window size — for ever, with no hardcoded stores height
   * to rot the day an eighth good adds a row. Pinned separately they would
   * simply slide over each other on a short window.
   */
  private buildLeftColumn(): HTMLElement {
    const column = el("div", { class: "leftcol" });
    column.append(this.buildRail(), this.buildStores());
    return column;
  }

  // ---------------------------------------------------------------- stores

  /**
   * Every good the colony holds, named and counted — the home the ribbon gave
   * up, and the reason the ribbon never has to grow again.
   *
   * Built by **bucketing `GOOD_LIST` by `GOOD_GROUP`**, with the groups emitted
   * in `GROUP_ORDER` rather than in enum order. That difference is load-
   * bearing: `ItemType` is append-only, so a future wood good is appended after
   * Bread and an emit-a-head-when-the-group-changes walk would file it under
   * Food. A new good adds a row to its own group, wherever it lands in the
   * enum, and nothing else about the HUD changes.
   */
  private buildStores(): HTMLElement {
    const stores = el("aside", { class: "panel stores" });
    stores.append(el("h4", {}, "Stores"));
    for (const group of GROUP_ORDER) {
      const goods = GOOD_LIST.filter((good) => GOOD_GROUP[good.type] === group);
      if (goods.length === 0) continue;
      stores.append(el("h5", {}, GROUP_LABEL[group]));
      // The rows go **two to a row**, in a grid per group, so the panel is seven
      // rows tall rather than thirteen — the height the rail needs to fit its
      // open section at 1280x720. The group heads stay full-width above their
      // goods, which is what keeps the five chains reading as chains rather than
      // as a wall of thirteen. An odd count leaves one empty cell, exactly as an
      // odd tool count does in the rail.
      const grid = el("div", { class: "store-grid" });
      for (const good of goods) grid.append(this.storeRow(good));
      stores.append(grid);
    }
    return stores;
  }

  /** One good's row: its pip, its name, and its count — the same number the
   *  ribbon used to carry, read from the same `readout()`. */
  private storeRow(good: GoodDef): HTMLElement {
    const row = el("div", { class: "store" });
    const pip = el("i");
    pip.style.background = GOOD_VAR[good.type];
    const value = el("b", {}, "0");
    this.res[`good${good.type}`] = value;
    row.append(pip, el("span", {}, good.name), value);
    return row;
  }

  // ------------------------------------------------------------------ rail

  /**
   * The rail: a **tab strip** of three sections — **Orders** (tell people to do
   * something to what is already there), **Build** (put a building down),
   * **Walls** (draw a line) — with **exactly one open at a time**.
   *
   * That is what makes the rail *one section tall*: a closed section costs
   * nothing however long it grows, which no layout change can promise. Three
   * stacked heads with every section open took twenty-three tools well past the
   * height the left column has at 1280x720, so of the fifteen build tools two
   * were on screen and the newest was nowhere near — a player who built one
   * could not see it (docs/specs/2026-09-15-rail-sections-and-fit.md).
   *
   * **It is a real tablist, not three disclosures.** `aria-expanded` announces
   * three independent collapsibles where the player has one of three, and gives
   * a screen-reader user no signal that choosing one closes the others. The
   * strip owns a roving tabindex and answers Left / Right; the closed grids take
   * `hidden`, so their buttons leave the tab order for free.
   *
   * Build's tools sit **three to a row** and Orders' and Walls' four each become
   * two rows of three, which with the strip in place of the heads is what puts
   * every tool of the open section on screen at 1280x720 without a scrollbar.
   *
   * Two things sit **outside** the scroller: the tab strip, which inside it
   * would scroll out of reach at exactly the heights this exists for, and the
   * caption strip, which carries the names and costs the icon-only buttons gave
   * up and must never be the thing a short window clips.
   *
   * Built **once**, at construction, and thereafter synced rather than rebuilt:
   * switching tabs is a class-and-attribute change on nodes that already exist,
   * so no node is created or destroyed after startup and nothing about focus
   * survival has to be arranged.
   */
  private buildRail(): HTMLElement {
    const rail = el("nav", { class: "panel rail", "aria-label": "Build tools" });
    const tabs = el("div", { class: "rail-tabs", role: "tablist", "aria-label": "Tool sections" });
    for (const { key, label } of RAIL_SECTIONS) {
      const tab = el(
        "button",
        {
          class: "rail-tab",
          type: "button",
          role: "tab",
          id: `railtab-${key}`,
          "aria-controls": `railpanel-${key}`,
          "aria-selected": "false",
          tabindex: "-1",
        },
        label,
      ) as HTMLButtonElement;
      tab.addEventListener("click", () => this.openSection(key));
      this.railTabs.set(key, tab);
      tabs.append(tab);
    }
    tabs.addEventListener("keydown", (e) => this.onTabKey(e));

    const sections = el("div", { class: "rail-scroll" });

    sections.append(
      this.railGrid("orders", [
        this.toolButton("Chop", { kind: "chop" }, ""),
        this.toolButton("Mine", { kind: "mine" }, ""),
        this.toolButton("Level", { kind: "terraform" }, "labour"),
        this.toolButton("Raze", { kind: "raze" }, ""),
      ]),
    );

    sections.append(
      this.railGrid(
        "build",
        ([
          BuildingKind.Stockpile,
          BuildingKind.Sawmill,
          BuildingKind.Mason,
          BuildingKind.House,
          BuildingKind.Farm,
          BuildingKind.Mill,
          BuildingKind.Oven,
          BuildingKind.Watchtower,
          BuildingKind.Pasture,
          BuildingKind.Dairy,
          BuildingKind.Weaver,
          BuildingKind.Tailor,
          BuildingKind.Hive,
          BuildingKind.Flowers,
          // Fifteen tools, three to a row: five rows exactly, and room for about
          // one more before the rail stops fitting at 1280x720. Adding a
          // sixteenth costs the rail nothing while some *other* section is open,
          // which is the whole point of the tab strip
          // (docs/specs/2026-09-15-rail-sections-and-fit.md).
          BuildingKind.Meadery,
        ] as BuildingKindValue[]).map((kind) => {
          const def = BUILDING_DEFS[kind];
          // The cost names the def's own material: the House costs planks, and
          // a button that said "4 logs" would be the rail lying about the one
          // building that pulls the sawmill chain.
          return this.toolButton(def.name, { kind: "build", building: kind }, costLabel(def.cost, def.costType));
        }),
      ),
    );

    // Each wall button carries its own material and says what it costs, so the
    // choice is made by which button you press rather than by a mode you have
    // to remember. A gate costs the same material as a plain run of its
    // material and differs only in labour.
    const walls: HTMLButtonElement[] = [];
    for (const material of ["timber", "stone"] as WallMaterial[]) {
      const cost = wallCost(material);
      const stone = material === "stone";
      walls.push(this.toolButton(stone ? "Stone wall" : "Wall", { kind: "wall", material }, cost));
      walls.push(this.toolButton(stone ? "Stone gate" : "Gate", { kind: "gate", material }, cost));
    }
    sections.append(this.railGrid("walls", walls));

    // The caption strip: always rendered, fixed height, empty when there is
    // nothing to name. Reserved space rather than a strip that appears — the
    // rail may never change height under the pointer.
    this.caption.append(this.captionName, this.captionCost);
    rail.append(tabs, sections, this.caption);
    this.syncRailTabs();
    return rail;
  }

  /**
   * One section's tools, **three to a row**, as the tabpanel its tab controls.
   * An odd count leaves the trailing cells empty — Build's fifteen fill five
   * rows exactly, Orders' and Walls' four leave one empty cell each.
   *
   * The grid also records which section each of its tools belongs to, which is
   * what lets the strip put a gold dot on the tab owning a tool held while its
   * own section is closed.
   */
  private railGrid(section: RailSection, tools: readonly HTMLButtonElement[]): HTMLElement {
    const grid = el("div", {
      class: "rail-grid",
      role: "tabpanel",
      id: `railpanel-${section}`,
      "aria-labelledby": `railtab-${section}`,
    });
    grid.append(...tools);
    for (const b of tools) {
      const key = b.dataset.tool;
      if (key !== undefined) this.toolSection.set(key, section);
    }
    this.railPanels.set(section, grid);
    return grid;
  }

  /** Open one section, closing the other two. Never touches the active tool:
   *  the caption strip sits outside the scroller, so a tool held in a closed
   *  section is still named, and its tab still carries the dot. */
  private openSection(section: RailSection): void {
    if (this.section === section) return;
    this.section = section;
    this.syncRailTabs();
  }

  /**
   * Left / Right across the strip, with the roving tabindex following.
   *
   * Automatic activation — moving the selection opens that section — because
   * the panels already exist and showing one costs nothing. The list wraps.
   */
  private onTabKey(e: KeyboardEvent): void {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const at = RAIL_SECTIONS.findIndex((s) => s.key === this.section);
    const next = RAIL_SECTIONS[(at + step + RAIL_SECTIONS.length) % RAIL_SECTIONS.length].key;
    this.openSection(next);
    this.railTabs.get(next)?.focus();
  }

  /**
   * Put the open section on the page: which tab is selected, which grid is
   * shown, and which tab — if any — owns the tool being held.
   *
   * The dot is **the only gold the rail grows here, and legitimately so**: the
   * rule that a tab is never gold is about which tab is *selected*, a view,
   * whereas the dot points at the tool being held, which is intent.
   */
  private syncRailTabs(): void {
    const held = this.tool_.kind === "none" ? undefined : this.toolSection.get(toolKey(this.tool_));
    for (const [key, tab] of this.railTabs) {
      const open = key === this.section;
      tab.setAttribute("aria-selected", String(open));
      tab.tabIndex = open ? 0 : -1;
      tab.classList.toggle("holds", key === held);
    }
    for (const [key, panel] of this.railPanels) panel.hidden = key !== this.section;
  }

  /**
   * One rail button: the icon, and nothing else drawn on it.
   *
   * The name and cost the button used to print live in its `aria-label` and
   * `title` as "Stone wall — 1 block", so the tooltip serves the pointer and
   * the accessible name serves the screen reader, and in the caption strip,
   * which is what serves the eye — including a keyboard user tabbing twenty
   * unlabelled icons.
   */
  private toolButton(label: string, tool: Tool, cost: string): HTMLButtonElement {
    const key = toolKey(tool);
    const named = cost ? `${label} — ${cost}` : label;
    const b = el("button", {
      class: "tool",
      type: "button",
      "aria-pressed": "false",
      "aria-label": named,
      title: named,
    }) as HTMLButtonElement;
    // No `??` on the building branch: `BUILDING_ICONS` is total over the kinds,
    // so a building with no icon fails to compile instead of rendering blank.
    b.innerHTML = tool.kind === "build" ? BUILDING_ICONS[tool.building] : (ICONS[key] ?? "");
    // Read back by `railGrid`, which is what knows the section: the button is
    // built before it is put in a grid, so the key rides along on it.
    b.dataset.tool = key;
    b.addEventListener("click", () => {
      this.setTool(sameTool(this.tool_, tool) ? { kind: "none" } : tool);
    });
    b.addEventListener("pointerenter", () => this.preview("hovered", key));
    b.addEventListener("pointerleave", () => this.preview("hovered", null, key));
    // `:focus-visible` rather than every focus: a click already says what it
    // meant by setting the tool, and the strip should not keep naming a button
    // the mouse merely left focused. It is the platform's own answer to "did
    // the keyboard do this".
    b.addEventListener("focus", () => {
      if (b.matches(":focus-visible")) this.preview("focused", key);
    });
    b.addEventListener("blur", () => this.preview("focused", null, key));
    this.toolButtons.set(key, b);
    this.toolCaptions.set(key, { name: label, cost });
    return b;
  }

  /**
   * Claim or release one of the two preview slots. A release names the key it
   * is releasing, so a `pointerleave` arriving after the pointer has already
   * entered the next button cannot blank that one's caption.
   */
  private preview(slot: "hovered" | "focused", key: string | null, only?: string): void {
    if (only !== undefined && this[slot] !== only) return;
    this[slot] = key;
    // A preview *claims* the strip rather than merely outranking it: the count
    // must not reappear when the pointer leaves the button again.
    if (key !== null) this.report = null;
    this.renderCaption();
  }

  /** Put the caption strip's pick on the page — the one gold element the rail
   *  is allowed, spent on the active tool and on nothing else. */
  private renderCaption(): void {
    const active = this.tool_.kind === "none" ? null : toolKey(this.tool_);
    const pick = railCaption(this.hovered, this.focused, active, this.report);
    const named = pick?.kind === "tool" ? this.toolCaptions.get(pick.tool) : undefined;
    this.captionName.textContent = pick?.kind === "report" ? pick.text : (named?.name ?? "");
    this.captionCost.textContent = named?.cost ?? "";
    this.caption.classList.toggle("on", pick?.gold === true);
  }

  private setTool(tool: Tool): void {
    this.tool_ = tool;
    this.report = null;
    if (tool.kind !== "none") this.selected = null;
    const active = tool.kind === "none" ? "" : toolKey(tool);
    for (const [key, b] of this.toolButtons) {
      b.setAttribute("aria-pressed", String(key === active));
    }
    // The open section is deliberately not touched: a tool held while its own
    // section is closed keeps its dot and its name in the caption strip.
    this.syncRailTabs();
    this.renderCaption();
  }

  // ------------------------------------------------------------- inspector

  private updateInspector(): void {
    if (!this.selected) {
      this.hideInspector();
      return;
    }
    if (this.selected.kind === "monster") {
      this.updateMonsterPanel(this.selected.id);
      return;
    }
    const b = inspect(this.sim, this.selected.id);
    if (!b) {
      this.hideInspector();
      return;
    }
    this.inspector.hidden = false;

    const signature = [
      b.id,
      b.state,
      b.staffed,
      b.delivered,
      // `clearing` and `stuck` join the count and the toggle here: pressing
      // `clear` on a good the pile refuses moves neither of the first two, so
      // without them the panel would never repaint — the button would keep
      // reading `clear` and the stuck note would never appear.
      ...b.stored.map((s) => `${s.count}${s.accepted ? "+" : "-"}${s.clearing ? "c" : ""}${s.stuck ? "!" : ""}`),
      Math.round(b.progress * 40),
      Math.round(b.milling * 50),
      b.stall,
      b.worker,
      b.limit,
      b.colonyCount,
      b.tableShort,
      // Both are derived from *other* buildings, so neither moves anything else
      // on this panel when it changes: a House's signature is otherwise wholly
      // static (no recipe means no milling, no limit and no colony count), and
      // an unstaffed Hive's is too. Without them the mead note would never
      // appear and the fields row would never leave `0 / 3`.
      b.cellarStocked,
      b.fields,
    ].join("|");
    if (signature === this.lastPanel) return;
    this.lastPanel = signature;

    // A rebuild replaces every node, including the button that was just
    // pressed — and the steppers and toggles are the first controls here a
    // player presses *repeatedly*. Carry keyboard focus over to the new node
    // with the same label, so a second press does not first mean tabbing
    // back in. Nothing to restore when the pointer did the pressing.
    const focused = document.activeElement;
    const label =
      focused instanceof HTMLElement && this.inspector.contains(focused) ? focused.getAttribute("aria-label") : null;
    this.inspector.replaceChildren(...this.panelFor(b));
    if (label) refocus(this.inspector, label);
  }

  private hideInspector(): void {
    this.selected = null;
    this.inspector.hidden = true;
    this.lastPanel = "";
  }

  /**
   * One monster's panel: what kind it is, and what it is doing.
   *
   * **No bar, and no clock.** It carried a five-bucket rhythm bar until the
   * wilds stopped living on the map; a monster now has no per-monster clock to
   * bucket — it is ashore until the storm passes, and that clock is the
   * colony's weather, which the ribbon already shows
   * (docs/specs/2026-09-17-incursions-from-the-sea.md).
   *
   * **No action button either.** There is nothing a player may do to a monster;
   * an inspector with no button is the honest way to say so, and adding one
   * would be the first crack in avoidance-only.
   */
  private updateMonsterPanel(id: number): void {
    const seen = monsters(this.sim).find((m) => m.id === id);
    if (!seen) {
      this.hideInspector();
      return;
    }
    this.inspector.hidden = false;

    const signature = `m${id}|${seen.doing}`;
    if (signature === this.lastPanel) return;
    this.lastPanel = signature;

    const name = monsterName(seen.kind);
    const head = el("div", { class: "insp-head" });
    head.append(el("h3", {}, name));
    head.append(el("span", { class: "tag threat" }, name));
    this.inspector.replaceChildren(
      head,
      rows([["Doing", seen.doing === "withdrawing" ? "heading for the boats" : "ashore"]]),
      // The house voice, and the whole of what the game will tell you about one:
      // it came off a boat and it will leave on one. A withdrawing monster is
      // already harmless, which is CONCEPT's "an attack ends only when the
      // monster leaves" said in the inspector.
      note(
        seen.doing === "withdrawing" ?
          "it is leaving — nothing it passes is in danger now"
        : "it came ashore with the storm, and leaves when the storm does",
      ),
    );
  }

  private panelFor(b: NonNullable<ReturnType<typeof inspect>>): Node[] {
    const nodes: Node[] = [];
    const head = el("div", { class: "insp-head" });
    head.append(el("h3", {}, b.name));
    head.append(el("span", { class: `tag ${tagClass(b)}` }, tagLabel(b)));
    nodes.push(head);

    if (b.state === BuildingState.Blueprint) {
      // Named off the def's material, both times: a House waits for planks,
      // and a panel that says "logs" is the panel lying — which is the one
      // thing it may never do, since it is the only diagnosis the game gives.
      const material = GOODS[b.costType as ItemTypeValue].label;
      nodes.push(rows([[`${capitalise(material)} delivered`, `${b.delivered} / ${b.cost}`]]));
      // The house voice: quiet text in the panel, no alert and no colour
      // change anywhere else (docs/STYLEGUIDE.md, Tone).
      nodes.push(note(`waiting for ${material} (${b.delivered} / ${b.cost})`));
      this.pushSiteFilters(b, nodes);
      nodes.push(this.actionButton("Cancel", () => this.ports.send({ kind: "cancelBlueprint", building: b.id })));
      return nodes;
    }

    if (b.state === BuildingState.Building) {
      nodes.push(rows([["Materials", `${b.cost} / ${b.cost}`]]));
      nodes.push(meter(b.progress));
      nodes.push(note("under construction"));
      this.pushSiteFilters(b, nodes);
      nodes.push(this.actionButton("Cancel", () => this.ports.send({ kind: "cancelBlueprint", building: b.id })));
      return nodes;
    }

    if (b.kind === BuildingKind.House) {
      // The whole panel: what it is, and how many beds it added. No action —
      // a House has no slot, nothing to staff and nothing to stop, and there
      // is no bed to assign because beds are a cap and not an assignment.
      //
      // The note is what connects six houses to `folk 6 / 17`: the beds row on
      // its own is a number with no consequence attached, and the player has to
      // be told once that this building *is* the population cap.
      nodes.push(rows([["Beds", String(b.beds)]]));
      nodes.push(note(`raises the cap by ${b.beds}`));
      // And when the *food* gate is what holds arrivals, this is where the
      // colony says so. Load-bearing rather than polish: the gate is silent,
      // player-caused, and can stand for game-days.
      if (b.tableShort) nodes.push(note("no one will come while the table is short"));
      // And when the cellar is what is *helping*, this is where the colony says
      // so — mead's whole effect is on a clock nobody can see, so unsaid it is
      // a lever with no readout at all. The short-table note wins where both
      // could apply, which `cellarStocked` already settles in `know`.
      else if (b.cellarStocked) nodes.push(note("mead in the cellar — folk come sooner"));
      return nodes;
    }

    if (b.kind === BuildingKind.Flowers) {
      // The House's shape: what it is, then the consequence. A field has no
      // worker, no recipe, no buffer and no action — the note is the whole
      // panel, and it is **state-independent** because a field standing alone
      // is still a field somebody may put a hive beside.
      nodes.push(rows([["Plot", `${b.cost} logs`]]));
      nodes.push(note(`boosts hives within ${HIVE_REACH} tiles`));
      return nodes;
    }

    if (b.kind === BuildingKind.Stockpile) {
      // A row per good — its count, its accept toggle and its `clear` — walked
      // from the goods table, so a new good gets a row by existing. Nothing
      // about the panel knows which goods exist; the Stored row carries the
      // `all` / `none` pair, which is what keeps a general-purpose pile one
      // press rather than eleven now that a new pile accepts nothing.
      const box = el("div", { class: "rows" });
      box.append(this.filterAllRow(b.id, "Stored", `${b.storedTotal} / ${b.capacity}`));
      for (const s of b.stored) box.append(this.filterRow(b.id, s, true));
      nodes.push(box);
      // The one sentence that keeps the two halves of production control apart:
      // filters route, ceilings brake. A player who wants a hoard the mill
      // cannot touch is looking for the workshop panel, and this says so.
      nodes.push(note(FILTER_NOTE));
      const second = stockNote(b);
      if (second) nodes.push(note(second));
      return nodes;
    }

    if (b.chain) nodes.push(chain(b.chain.input, b.chain.output));
    const box = rows([
      // The worker row is load-bearing once someone is inside: the renderer
      // stops drawing them, so this is where the player reads that the slot
      // is filled.
      ["Worker", WORKER_LABEL[b.worker]],
      // No input row for a workshop that consumes nothing — a Farm reading
      // `Input 0 / 0` would invite the player to look for the buffer it does
      // not have (docs/specs/2026-09-08-bread-economy.md).
      ...(b.inputCap > 0 ? ([["Input", `${b.inputCount} / ${b.inputCap}`]] as [string, string][]) : []),
      // And **no output row at all** for a slot building with no recipe: the
      // Watchtower's whole output is knowledge, so `Output 0 / 0` would be the
      // panel inviting a look for a buffer that does not exist — the Farm's
      // input lesson, one row down (docs/specs/2026-09-09-watchtowers.md).
      ...(b.chain ? ([["Output", `${b.outputCount} / ${b.outputCap}`]] as [string, string][]) : []),
    ]);
    // The ceiling, directly under the per-building output count and worded
    // "in colony" so the two plank numbers on this panel cannot be mistaken
    // for each other: this one is every plank anywhere, against the ceiling
    // the whole colony shares. Editing it edits the global number — a second
    // sawmill's panel shows the same row.
    if (b.outputType >= 0) box.append(this.limitRow(b));
    // A hive's rate is a fact about where it stands, so the panel prints the
    // number the batch length actually reads — the Watchtower's `watching` row,
    // one building over.
    if (b.fields >= 0) box.append(row("Fields in reach", `${b.fields} / ${HIVE_FIELDS_MAX}`));
    nodes.push(box);
    if (b.milling >= 0) nodes.push(meter(b.milling));
    // A tower has no recipe to stall, so it says what it is watching instead.
    nodes.push(note(b.watching >= 0 ? watchNote(b) : millNote(b)));
    // A hive with no fields is working, not stalled — so this is a second note
    // rather than a stall, and it names the distance because "in reach" is
    // otherwise a number with no unit.
    if (b.fields === 0) nodes.push(note(`no flowers in reach — plant fields within ${HIVE_REACH} tiles`));
    // The Meadery is the one place the game can say what mead is *for* before
    // it is already working, so this note is state-independent like the
    // Flowers' one.
    if (b.kind === BuildingKind.Meadery) nodes.push(note("mead in the cellar brings folk sooner"));
    nodes.push(
      b.staffed ?
        this.actionButton("Unstaff", () => this.ports.send({ kind: "unstaff", building: b.id }))
      : this.actionButton("Staff", () => this.ports.send({ kind: "staff", building: b.id })),
    );
    return nodes;
  }

  private actionButton(label: string, onClick: () => void): HTMLButtonElement {
    const b = el("button", { class: "action", type: "button" }, label) as HTMLButtonElement;
    b.addEventListener("click", onClick);
    return b;
  }

  /**
   * The filter rows and the `all` / `none` pair on a pile that is still a
   * blueprint or still going up — **toggles only**, with no counts and no
   * `clear`, because what the site holds is its own construction materials and
   * not stock. This is what keeps accept-nothing from meaning "every first pile
   * goes active accepting nothing": the click a player makes to check on the
   * site is where they configure it
   * (docs/specs/2026-09-14-stockpiles-default-off-and-clear.md).
   */
  private pushSiteFilters(b: NonNullable<ReturnType<typeof inspect>>, nodes: Node[]): void {
    if (b.kind !== BuildingKind.Stockpile) return;
    const box = el("div", { class: "rows" });
    box.append(this.filterAllRow(b.id, "Accepts", null));
    for (const s of b.stored) box.append(this.filterRow(b.id, s, false));
    nodes.push(box);
    const second = stockNote(b);
    if (second) nodes.push(note(second));
  }

  /**
   * One good's row on a stockpile: its name, how many the pile holds, the
   * accept toggle, and — while it holds any — `clear`. The toggle is the
   * styleguide's secondary recipe with its state carried by ink weight and
   * fill — never gold, which is intent, and never sage or rust, which mean
   * other things. `on`/`off` in caps is the whole of its vocabulary, and it
   * stays **binary**: a good being cleared reads `off` here, with the button
   * beside it saying what is actually happening.
   *
   * `detailed` is false on a site, where the row is the toggle alone.
   */
  private filterRow(id: number, s: StoredGood, detailed: boolean): HTMLElement {
    const good = GOODS[s.type as ItemTypeValue];
    const row = el("div", { class: "row filter" });
    const ctl = el("span", { class: "ctl" });
    const toggle = el(
      "button",
      {
        class: "toggle",
        type: "button",
        "aria-pressed": String(s.accepted),
        "aria-label": `accept ${good.label}`,
        title: s.accepted ? `accepting ${good.label} — click to refuse` : `refusing ${good.label} — click to accept`,
      },
      s.accepted ? "on" : "off",
    ) as HTMLButtonElement;
    toggle.addEventListener("click", () => this.ports.send({ kind: "toggleFilter", building: id, type: s.type }));
    if (detailed) ctl.append(el("b", {}, String(s.count)));
    ctl.append(toggle);
    // Offered from `on` and `off` alike, so "empty this pile of planks" is one
    // press whatever the toggle says — and withdrawn once the pile holds none,
    // where a finished clear is indistinguishable from `off` and meant to be.
    if (detailed && s.count > 0) {
      const clearing = s.clearing;
      const button = el(
        "button",
        {
          class: "word",
          type: "button",
          // One label for both faces, so keyboard focus survives the rebuild
          // the press itself causes.
          "aria-label": `clear ${good.label}`,
          title:
            clearing ?
              `clearing ${good.label} out to other piles`
            : `send the ${good.label} here to other piles, and take no more`,
        },
        clearing ? "clearing" : "clear",
      ) as HTMLButtonElement;
      if (clearing) button.disabled = true;
      else button.addEventListener("click", () => this.ports.send({ kind: "clearFilter", building: id, type: s.type }));
      ctl.append(button);
    }
    row.append(el("span", {}, good.name), ctl);
    return row;
  }

  /** The row the `all` / `none` pair sits in — the Stored row on a finished
   *  pile, a bare `Accepts` label on a site that has no stock to count. */
  private filterAllRow(id: number, label: string, value: string | null): HTMLElement {
    const row = el("div", { class: "row filter" });
    const ctl = el("span", { class: "ctl" });
    if (value !== null) ctl.append(el("b", {}, value));
    const press = (text: string, aria: string, title: string, on: boolean): HTMLButtonElement => {
      const button = el(
        "button",
        { class: "word", type: "button", "aria-label": aria, title },
        text,
      ) as HTMLButtonElement;
      button.addEventListener("click", () => this.ports.send({ kind: "setAllFilters", building: id, on }));
      return button;
    };
    ctl.append(
      press("all", "accept every good", "accept every good", true),
      // `none` steps around a good that is clearing — see `setAllFilters`.
      press("none", "refuse every good", "refuse every good, but let a clear finish", false),
    );
    row.append(el("span", {}, label), ctl);
    return row;
  }

  /**
   * The "produce until" row: the colony-wide count of the workshop's output
   * against its ceiling, with `−`/`+` steppers either side. `sim/know` owns the
   * landings (`stepLimit`) — from unlimited the first `−` lands on the current
   * count rounded up to the step, so "stop making this" is one press. A press
   * sends the **direction**, not a computed target: the sim resolves the
   * landing against the live ceiling when the tick applies it, so two quick
   * presses, or a run of them queued while paused, each count as one press
   * rather than replaying the value this panel happened to show. The landing
   * is still computed here, once, to know when a button has reached the end
   * of the range and should go quiet: `−` at zero, `+` at unlimited.
   */
  private limitRow(b: NonNullable<ReturnType<typeof inspect>>): HTMLElement {
    const good = GOODS[b.outputType as ItemTypeValue];
    const row = el("div", { class: "row limit" });
    const ctl = el("span", { class: "ctl" });
    const ceiling = b.limit === UNLIMITED ? "unlimited" : String(b.limit);
    const step = (dir: -1 | 1, glyph: string, title: string): HTMLButtonElement => {
      const button = el("button", { class: "stepper", type: "button", title, "aria-label": title }, glyph) as HTMLButtonElement;
      button.disabled = stepLimit(b.limit, b.colonyCount, dir) === b.limit;
      button.addEventListener("click", () => this.ports.send({ kind: "stepLimit", type: b.outputType, dir }));
      return button;
    };
    ctl.append(
      step(-1, "−", `lower the ${good.label} ceiling`),
      el("b", {}, `${b.colonyCount} / ${ceiling}`),
      step(1, "+", `raise the ${good.label} ceiling`),
    );
    row.append(el("span", {}, `${capitalise(good.label)} in colony`), ctl);
    return row;
  }

  // ---------------------------------------------------------------- labour

  private updateLabour(folk: number, pool: number): void {
    const slots = folk - pool;
    const want = `${folk}:${pool}`;
    // Guarded, because `update()` runs every frame: the legend is five fresh
    // DOM nodes and it only ever changes when the split does.
    if (this.labourMeter.dataset.state === want) return;
    this.labourMeter.dataset.state = want;
    this.labourMeter.replaceChildren(
      ...Array.from({ length: folk }, (_, i) => el("i", { class: i < pool ? "p" : "s" })),
    );
    this.labourMeter.setAttribute(
      "aria-label",
      `${pool} of ${folk} colonists in the shared pool, ${slots} locked to workshop slots`,
    );
    this.labourLegend.replaceChildren(
      el("em", {}, `${pool} in the pool`),
      text(" — hauling and building, switching freely."),
      el("br"),
      el("em", {}, `${slots} in slots`),
      text(" — locked to a workshop until you pull them out."),
    );
  }
}

/**
 * Put keyboard focus back on the control the player was pressing, found in the
 * freshly rebuilt panel by its `aria-label`.
 *
 * The fallback is the point: a stepper that just reached the end of its range
 * comes back **disabled**, and `focus()` on a disabled button silently does
 * nothing — focus falls to the document body, so the next Tab starts at the
 * top of the page. Walking a ceiling down to zero on the keyboard is exactly
 * that case, so when the twin comes back dead, focus the other control in the
 * same cluster instead — the one still worth pressing.
 */
function refocus(panel: HTMLElement, label: string): void {
  const nodes = [...panel.querySelectorAll<HTMLElement>("[aria-label]")];
  const match = nodes.find((n) => n.getAttribute("aria-label") === label);
  if (!match) return;
  if (!(match instanceof HTMLButtonElement) || !match.disabled) {
    match.focus();
    return;
  }
  const alive = match.closest(".ctl")?.querySelector<HTMLButtonElement>("button:not(:disabled)");
  alive?.focus();
}

function sameTool(a: Tool, b: Tool): boolean {
  return toolKey(a) === toolKey(b);
}

/** "4 planks", "2 logs" — a cost in the rail's own words, off the def's own
 *  material. Singular where the good's label already is (rock). */
function costLabel(cost: number, type: number): string {
  const good = GOODS[type as ItemTypeValue];
  return `${cost} ${cost === 1 ? good.name.toLowerCase() : good.label}`;
}

/** Sentence case for a good's lower-case label, so a panel row reads "Planks
 *  delivered" without a second name per good living in the table. */
function capitalise(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** What one segment of this material costs, in the goods table's own words. */
function wallCost(material: WallMaterial): string {
  return costLabel(WALL_ITEM_COST, wallItem(material));
}

/**
 * What a workshop is doing, in the house voice. A stalled workshop has to name
 * the reason it stalled — "waiting for logs" while the input buffer is full is
 * the panel lying, and the panel is the only diagnosis the player gets. The
 * goods are named from the chain, so the mason waits for *rock* rather than
 * inheriting the sawmill's words.
 */
export function millNote(b: MillNote): string {
  if (!b.staffed) return "no one is working here";
  // A worker away on a self-errand, said plainly: the row above already says
  // `eating` or `dressing`, and a note claiming "working" while nobody is in
  // there would be the panel lying about the one thing it exists to explain.
  // Both errands need their own line — falling through to the stall ladder
  // would report a stall that is not happening, and falling through past it
  // says "working" of an empty workshop.
  if (b.worker === "eating") return "gone to eat — back shortly";
  if (b.worker === "dressing") return "gone for clothes — back shortly";
  const chainOf = b.chain;
  if (!chainOf) return "";
  // The ceiling holding the mill is the player's own setting, said in the
  // same quiet voice as "waiting for logs": no readout, no alert, and the
  // slot worker stays put — unstaffing is still the lever for the hands.
  if (b.stall === "at-limit") {
    return `at limit (${b.colonyCount} ${GOODS[b.outputType as ItemTypeValue].label} in the colony)`;
  }
  if (b.stall === "output-full") return `output full — nowhere to put the ${chainOf.output.toLowerCase()}s`;
  if (b.stall === "no-input" && chainOf.input) return `waiting for ${chainOf.input.toLowerCase()}`;
  return "working";
}

/**
 * The Watchtower's note row: how much sea it is watching, in the house voice.
 *
 * **Keyed off the worker's whereabouts, never off `staffed`, so the panel
 * cannot lie.** Coverage requires the watcher *inside* — the same gate
 * production uses — so a tower whose watcher is walking over, or away at a
 * loaf, is sharpening nothing at that moment and has to say so. That is the
 * only place the game ever tells the player their picture just went coarse,
 * and the worker row above it is the corroboration
 * (docs/specs/2026-09-09-watchtowers.md).
 *
 * `watching` counts **tiles of shore** whether or not anybody is standing in
 * the tower, which is what lets an unstaffed one honestly say what it *would*
 * watch. It counted dens until the wilds started arriving by sea
 * (docs/specs/2026-09-17-incursions-from-the-sea.md).
 */
export function watchNote(b: Pick<Inspection, "watching" | "worker">): string {
  // No sea in range outranks every other wording: a tower facing inland is a
  // tower in the wrong place, and that is worth saying whoever is in it.
  if (b.watching === 0) return "the watcher sees no shore from here";
  const shore = `${b.watching} ${b.watching === 1 ? "tile" : "tiles"} of shore`;
  if (b.worker === "none") return `${shore} in reach — no watcher`;
  if (b.worker !== "inside") return `${shore} in reach — the watcher is away`;
  return `watching ${shore}`;
}

/**
 * The stockpile panel's one sentence. Filters and ceilings are the two halves
 * of production control and are easy to mistake for each other, so the panel
 * that carries one names the other: a filter chooses what a pile takes in and
 * never stops a good being made — the mill pulls from any pile regardless.
 */
const FILTER_NOTE = "filters choose what this pile accepts — to stop a good being made, set its limit on the workshop";

/**
 * The stockpile panel's **second** note, in the consequence voice — the
 * styleguide allows one when it says what follows rather than what is, and both
 * of these do. The two states are mutually exclusive by construction: a pile
 * with a good stuck mid-clear is holding some of it, which is exactly what the
 * accept-nothing note excludes.
 *
 * "Clearing" is defined here as *clearing with a count above zero*, on purpose:
 * a finished `2` reads as `off` everywhere else in the panel, and it must not
 * cost a pile the note that explains why it is empty.
 */
export function stockNote(b: Pick<NonNullable<ReturnType<typeof inspect>>, "stored">): string | null {
  const stuck = b.stored.find((s) => s.stuck);
  if (stuck) return `clearing ${GOODS[stuck.type as ItemTypeValue].label} — no other pile will take them`;
  const idle = !b.stored.some((s) => s.accepted) && !b.stored.some((s) => s.clearing && s.count > 0);
  return idle ? "accepts nothing yet — turn on what this pile should take" : null;
}

function tagClass(b: NonNullable<ReturnType<typeof inspect>>): string {
  if (b.state !== BuildingState.Active) return "blueprint";
  return b.hasSlot ? "slot" : "pool";
}

function tagLabel(b: NonNullable<ReturnType<typeof inspect>>): string {
  if (b.state !== BuildingState.Active) return "Blueprint";
  return b.hasSlot ? "Slot" : "Pool";
}

function rows(pairs: [string, string][]): HTMLElement {
  const box = el("div", { class: "rows" });
  for (const [label, value] of pairs) box.append(row(label, value));
  return box;
}

/** One label-left, value-right row, for appending to a box built already. */
function row(label: string, value: string): HTMLElement {
  const node = el("div", { class: "row" });
  node.append(el("span", {}, label), el("b", {}, value));
  return node;
}

function note(message: string): HTMLElement {
  return el("div", { class: "row note" }, message);
}

function meter(fraction: number): HTMLElement {
  const bar = el("div", { class: "meter" });
  const fill = el("span");
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  bar.append(fill);
  return bar;
}

/**
 * A workshop's chain chip. **One-sided when there is no input** — the Farm
 * reads `→ Grain`, because a recipe that consumes nothing has nothing to put
 * on the left of the arrow, and an empty chip there would read as a missing
 * good rather than as no good at all.
 */
function chain(from: string | null, to: string): HTMLElement {
  const box = el("div", { class: "chain" });
  if (from !== null) box.append(el("span", { class: "chip" }, from));
  box.append(el("span", { class: "arrow" }, "→"), el("span", { class: "chip" }, to));
  return box;
}

function text(value: string): Text {
  return document.createTextNode(value);
}

function el(tag: string, attrs: Record<string, string> = {}, content?: string): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (content !== undefined) node.textContent = content;
  return node;
}
