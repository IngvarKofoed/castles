import type { Command } from "../sim/commands";
import {
  BUILDING_DEFS,
  BuildingKind,
  BuildingState,
  GOODS,
  GOOD_LIST,
  ItemType,
  UNLIMITED,
  WALL_ITEM_COST,
  inspect,
  monsterName,
  monsters,
  readout,
  rhythm,
  stepLimit,
  threat,
  wallItem,
  type BuildingKindValue,
  type GoodDef,
  type ItemTypeValue,
  type Sim,
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

/** The tools whose left-drag is a selection marquee rather than a run. */
export function isMarqueeTool(tool: Tool): boolean {
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
};

/**
 * The Stores panel's groups, in the order it emits them — **fixed here rather
 * than read off the enum**, because `ItemType` is append-only and a future wood
 * good would be appended after Bread.
 */
export const GROUP_ORDER = ["wood", "stone", "food"] as const;
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
};

const GROUP_LABEL: Record<GoodGroup, string> = { wood: "Wood", stone: "Stone", food: "Food" };

/** What the rail's caption strip is naming, and whether it may be gold. */
export interface RailCaption {
  readonly tool: string;
  /**
   * The rail's one gold element. Gold only while the strip names the **active**
   * tool — a hover or focus preview of some other tool reads in plain ink,
   * because hover is not intent.
   */
  readonly gold: boolean;
}

/**
 * What the caption strip shows, as a pure function of the three things that
 * can claim it: the tool under the pointer, the tool with keyboard focus, and
 * the tool actually held. A preview wins over the active tool — you are asking
 * what that button is — and with nothing to show the strip is empty rather
 * than absent, so the rail never changes height under the pointer.
 */
export function railCaption(hovered: string | null, focused: string | null, active: string | null): RailCaption | null {
  const preview = hovered ?? focused;
  if (preview !== null) return { tool: preview, gold: preview === active };
  if (active !== null) return { tool: active, gold: true };
  return null;
}

/** How the inspector names where a slot worker is. */
const WORKER_LABEL: Record<"none" | "walking" | "inside" | "eating", string> = {
  none: "none",
  walking: "on the way",
  inside: "inside",
  eating: "eating",
};

const ICONS: Record<string, string> = {
  // Axe, crate, mill — flat line marks in currentColor, so the rail's gold
  // pressed state carries through without a second asset.
  chop: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 15 L12 6"/><path d="M11 2 L19 6 L14 11 L9 5 Z"/></svg>`,
  stockpile: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="7" width="7" height="7"/><rect x="12" y="7" width="7" height="7"/><path d="M3 5 h16"/></svg>`,
  sawmill: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 8 L11 3 L19 8"/><rect x="5" y="8" width="12" height="7"/><path d="M9 15 v-4 h4 v4"/></svg>`,
  // Palisade: stakes under two rails. Gate: the same run with the middle open
  // under a lintel. Raze: a stake coming apart.
  wall: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 15 V5"/><path d="M8 15 V4"/><path d="M12 15 V5"/><path d="M16 15 V4"/><path d="M3 8 h16"/><path d="M3 12 h16"/></svg>`,
  gate: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 15 V6"/><path d="M17 15 V6"/><path d="M3 5 h16"/><path d="M9 15 v-4"/><path d="M13 15 v-4"/></svg>`,
  raze: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 15 V7 L3 4"/><path d="M16 15 V8 L19 4"/><path d="M9 11 l4 -3"/><path d="M11 4 v3"/></svg>`,
  // Mine: a pick swung at an outcrop. Terraform: ground stepping down to a
  // level line. Mason: a block on a bench under a chisel.
  mine: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 15 L11 7"/><path d="M7 3 q5 1 8 5"/><path d="M15 8 l-4 -5"/><path d="M13 15 h6 l-2 -4 h-3 Z"/></svg>`,
  terraform: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 14 h5 v-4 h5 v-4 h6"/><path d="M3 6 h6"/><path d="M6 4 v4"/></svg>`,
  // House: a gabled box with a door — beds, and nothing that looks like work.
  house: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 9 L11 3 L19 9"/><rect x="5" y="9" width="12" height="6"/><path d="M9 15 v-4 h4 v4"/></svg>`,
  // Farm: furrows under a fence line. Mill: a hopper over a millstone.
  // Oven: a domed stone oven with its mouth and a wisp above it.
  farm: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 5 h16"/><path d="M3 15 l3 -7"/><path d="M9 15 l3 -7"/><path d="M15 15 l3 -7"/><path d="M6 3 v4"/><path d="M16 3 v4"/></svg>`,
  mill: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 3 h10 l-2 5 h-6 Z"/><rect x="5" y="10" width="12" height="4"/><path d="M11 8 v2"/><path d="M4 15 h14"/></svg>`,
  oven: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 15 V9 q7 -6 14 0 v6 Z"/><path d="M9 15 v-3 h4 v3"/><path d="M16 6 q2 -2 0 -4"/></svg>`,
  mason: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="9" width="14" height="6"/><path d="M11 9 v6"/><path d="M8 6 h6"/><path d="M11 3 v3"/></svg>`,
  // Stone wall: coursed blocks. Stone gate: the same arch, squared.
  stonewall: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="6" width="16" height="4"/><rect x="3" y="10" width="16" height="4"/><path d="M8 6 v4"/><path d="M14 6 v4"/><path d="M5 10 v4"/><path d="M11 10 v4"/><path d="M17 10 v4"/></svg>`,
  stonegate: `<svg viewBox="0 0 22 18" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="4" width="16" height="3"/><path d="M5 15 V7 h3 v8"/><path d="M17 15 V7 h-3 v8"/></svg>`,
};

export class Hud {
  private readonly root: HTMLElement;
  private readonly res: Record<string, HTMLElement> = {};
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly toolButtons = new Map<string, HTMLButtonElement>();
  private readonly toolCaptions = new Map<string, { name: string; cost: string }>();
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
  private readonly marquee: HTMLElement;
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
   * What the inspector is showing. Two shapes now — a building, or a monster —
   * because a den's inhabitant is a thing worth watching and nothing else in
   * the game is inspectable.
   */
  private selected: { kind: "building" | "monster"; id: number } | null = null;
  /** Last rendered inspector signature, so the panel only rebuilds on change. */
  private lastPanel = "";
  /**
   * The monster the threat meter is currently watching.
   *
   * The pick **holds** until that monster goes back to sleep, so the bar cannot
   * flicker between two clocks mid-siege — and the memory lives *here* rather
   * than in the store, because which monster a particular meter is watching is
   * a property of the meter and not of the world. `sim/know` owns the policy
   * and is handed last frame's answer; it reads the store and never writes it.
   */
  private watching = -1;
  private readonly threatBars: HTMLElement;
  private readonly threatCaption: HTMLElement;

  constructor(
    private readonly sim: Sim,
    private readonly ports: HudPorts,
  ) {
    this.threatBars = el("div", { class: "bars", role: "img" });
    this.threatCaption = el("u", {}, "wilds quiet");
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

    this.marquee = el("div", { class: "marquee" });
    this.marquee.hidden = true;
    this.root.append(this.marquee);

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
      this.hideMarquee();
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
    this.hideMarquee();
  }

  /**
   * Show the drag-box at a screen rectangle. It exists only while the drag is
   * held (docs/STYLEGUIDE.md), so there is no state to reconcile — the caller
   * shows it on every move and hides it on release or cancel.
   */
  showMarquee(rect: { left: number; top: number; right: number; bottom: number }): void {
    const s = this.marquee.style;
    s.left = `${rect.left}px`;
    s.top = `${rect.top}px`;
    s.width = `${rect.right - rect.left}px`;
    s.height = `${rect.bottom - rect.top}px`;
    this.marquee.hidden = false;
  }

  hideMarquee(): void {
    this.marquee.hidden = true;
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
   * The threat meter. `sim/know` picks the monster and works out how much of
   * its clock is left; the HUD only hands back which one it was showing, so
   * the pick holds while that monster is out.
   */
  private updateThreat(): void {
    const t = threat(this.sim, this.watching);
    this.watching = t.monster;
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

    // And the one thing on the ribbon that is not a count: how long until the
    // wilds matter. Five rust segments and a quiet caption — the whole of the
    // game's alarm vocabulary (docs/STYLEGUIDE.md).
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
      for (const good of goods) stores.append(this.storeRow(good));
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
   * The rail, in three labelled sections — **Orders** (tell people to do
   * something to what is already there), **Build** (put a building down),
   * **Walls** (draw a line). Eleven tools in one unbroken column stopped being
   * readable — fifteen since the bread chain — and the styleguide's rail
   * anatomy already allowed section heads, so this is that allowance spent.
   *
   * Each section is a **two-column grid of icon-only buttons**, which is what
   * fits all fifteen on a 768px-tall window without a scrollbar. The words the
   * buttons gave up live in their accessible names and in the caption strip at
   * the foot of the rail.
   *
   * The sections go in a scroller **inside** the rail rather than in the rail
   * itself, so the one thing that gives on a short window is the tool grid and
   * never the caption strip: at 1280x720 the column is ~20px short, and with
   * the strip inside the scrolled box that shortfall landed squarely on the
   * cost line — the rail clipping the very words its buttons gave up.
   */
  private buildRail(): HTMLElement {
    const rail = el("nav", { class: "panel rail", "aria-label": "Build tools" });
    const sections = el("div", { class: "rail-scroll" });

    sections.append(el("span", { class: "rail-label" }, "Orders"));
    sections.append(
      this.railGrid([
        this.toolButton("Chop", { kind: "chop" }, ""),
        this.toolButton("Mine", { kind: "mine" }, ""),
        this.toolButton("Level", { kind: "terraform" }, "labour"),
        this.toolButton("Raze", { kind: "raze" }, ""),
      ]),
    );

    sections.append(el("span", { class: "rail-label" }, "Build"));
    sections.append(
      this.railGrid(
        ([
          BuildingKind.Stockpile,
          BuildingKind.Sawmill,
          BuildingKind.Mason,
          BuildingKind.House,
          BuildingKind.Farm,
          BuildingKind.Mill,
          BuildingKind.Oven,
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
    sections.append(el("span", { class: "rail-label" }, "Walls"));
    const walls: HTMLButtonElement[] = [];
    for (const material of ["timber", "stone"] as WallMaterial[]) {
      const cost = wallCost(material);
      const stone = material === "stone";
      walls.push(this.toolButton(stone ? "Stone wall" : "Wall", { kind: "wall", material }, cost));
      walls.push(this.toolButton(stone ? "Stone gate" : "Gate", { kind: "gate", material }, cost));
    }
    sections.append(this.railGrid(walls));

    // The caption strip: always rendered, fixed height, empty when there is
    // nothing to name. Reserved space rather than a strip that appears — the
    // rail may never change height under the pointer.
    this.caption.append(this.captionName, this.captionCost);
    rail.append(sections, this.caption);
    return rail;
  }

  /** One section's tools, two to a row. An odd count leaves the last cell
   *  empty — Build's seven sit in four rows. */
  private railGrid(tools: readonly HTMLElement[]): HTMLElement {
    const grid = el("div", { class: "rail-grid" });
    grid.append(...tools);
    return grid;
  }

  /**
   * One rail button: the icon, and nothing else drawn on it.
   *
   * The name and cost the button used to print live in its `aria-label` and
   * `title` as "Stone wall — 1 block", so the tooltip serves the pointer and
   * the accessible name serves the screen reader, and in the caption strip,
   * which is what serves the eye — including a keyboard user tabbing fifteen
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
    b.innerHTML = ICONS[key] ?? "";
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
    this.renderCaption();
  }

  /** Put the caption strip's pick on the page — the one gold element the rail
   *  is allowed, spent on the active tool and on nothing else. */
  private renderCaption(): void {
    const active = this.tool_.kind === "none" ? null : toolKey(this.tool_);
    const pick = railCaption(this.hovered, this.focused, active);
    const named = pick ? this.toolCaptions.get(pick.tool) : undefined;
    this.captionName.textContent = named?.name ?? "";
    this.captionCost.textContent = named?.cost ?? "";
    this.caption.classList.toggle("on", pick?.gold === true);
  }

  private setTool(tool: Tool): void {
    this.tool_ = tool;
    if (tool.kind !== "none") this.selected = null;
    const active = tool.kind === "none" ? "" : toolKey(tool);
    for (const [key, b] of this.toolButtons) {
      b.setAttribute("aria-pressed", String(key === active));
    }
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
      ...b.stored.map((s) => `${s.count}${s.accepted ? "+" : "-"}`),
      Math.round(b.progress * 40),
      Math.round(b.milling * 50),
      b.stall,
      b.worker,
      b.limit,
      b.colonyCount,
      b.tableShort,
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
   * One monster's panel: what kind it is, whether it is up, and how far through
   * its hours it is — the same coarse five-bucket bar the ribbon uses, because
   * they are the same claim at different scopes.
   *
   * **No action button.** There is nothing a player may do to a monster; an
   * inspector with no button is the honest way to say so, and adding one would
   * be the first crack in avoidance-only.
   */
  private updateMonsterPanel(id: number): void {
    const seen = monsters(this.sim).find((m) => m.id === id);
    const r = seen ? rhythm(this.sim, id) : null;
    if (!seen || !r) {
      this.hideInspector();
      return;
    }
    this.inspector.hidden = false;

    const signature = `m${id}|${seen.stance}|${r.phase}|${r.bucket}`;
    if (signature === this.lastPanel) return;
    this.lastPanel = signature;

    const name = monsterName(seen.kind);
    const head = el("div", { class: "insp-head" });
    head.append(el("h3", {}, name));
    head.append(el("span", { class: "tag threat" }, name));
    this.inspector.replaceChildren(
      head,
      rows([["Stance", seen.stance === "dormant" ? "resting" : "out"]]),
      // `bucket + 1`, not `bucket`: the buckets are 0-based, so passing the raw
      // value left the bar unable to reach full however far through its hours a
      // monster got.
      //
      // This bar and the ribbon's meter deliberately measure **different
      // things**, and the difference is worth stating because they sit on one
      // screen: this one is *phase progress* — how far through whatever it is
      // doing — so it fills as the phase runs out whichever phase that is. The
      // ribbon's is *danger remaining*, so it fills toward a waking and drains
      // toward a leaving. A monster walking home therefore reads full here (its
      // rounds are over) and empty there (it can no longer hurt you). Do not
      // "reconcile" them.
      bars(r.bucket + 1, r.buckets, RHYTHM_LABEL[r.phase]),
      // The house voice, and the whole of what the base game will tell you:
      // watch it long enough and you learn its hours. Watchtowers narrow this.
      note("its hours are read off the map, never exactly"),
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
      nodes.push(this.actionButton("Cancel", () => this.ports.send({ kind: "cancelBlueprint", building: b.id })));
      return nodes;
    }

    if (b.state === BuildingState.Building) {
      nodes.push(rows([["Materials", `${b.cost} / ${b.cost}`]]));
      nodes.push(meter(b.progress));
      nodes.push(note("under construction"));
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
      // And when the *bread* gate is what holds arrivals, this is where the
      // colony says so. Load-bearing rather than polish: the gate is silent,
      // player-caused, and can stand for game-days.
      if (b.tableShort) nodes.push(note("no one will come while the table is short"));
      return nodes;
    }

    if (b.kind === BuildingKind.Stockpile) {
      // A row per good — its count here and its accept toggle — walked from the
      // goods table, so a new good gets a row by existing. The toggle writes
      // the filter the pile has carried since step 2; nothing about the panel
      // knows which goods exist.
      const box = rows([["Stored", `${b.storedTotal} / ${b.capacity}`]]);
      for (const s of b.stored) {
        box.append(
          this.filterRow(GOODS[s.type as ItemTypeValue], s.count, s.accepted, () =>
            this.ports.send({ kind: "toggleFilter", building: b.id, type: s.type }),
          ),
        );
      }
      nodes.push(box);
      // The one sentence that keeps the two halves of production control apart:
      // filters route, ceilings brake. A player who wants a hoard the mill
      // cannot touch is looking for the workshop panel, and this says so.
      nodes.push(note(FILTER_NOTE));
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
      ["Output", `${b.outputCount} / ${b.outputCap}`],
    ]);
    // The ceiling, directly under the per-building output count and worded
    // "in colony" so the two plank numbers on this panel cannot be mistaken
    // for each other: this one is every plank anywhere, against the ceiling
    // the whole colony shares. Editing it edits the global number — a second
    // sawmill's panel shows the same row.
    if (b.outputType >= 0) box.append(this.limitRow(b));
    nodes.push(box);
    if (b.milling >= 0) nodes.push(meter(b.milling));
    nodes.push(note(millNote(b)));
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
   * One good's row on a stockpile: its name, how many the pile holds, and the
   * accept toggle. The toggle is the styleguide's secondary recipe with its
   * state carried by ink weight and fill — never gold, which is intent, and
   * never sage or rust, which mean other things. `on`/`off` in caps is the
   * whole of its vocabulary.
   */
  private filterRow(good: GoodDef, count: number, accepted: boolean, onToggle: () => void): HTMLElement {
    const row = el("div", { class: "row filter" });
    const ctl = el("span", { class: "ctl" });
    const toggle = el(
      "button",
      {
        class: "toggle",
        type: "button",
        "aria-pressed": String(accepted),
        "aria-label": `accept ${good.label}`,
        title: accepted ? `accepting ${good.label} — click to refuse` : `refusing ${good.label} — click to accept`,
      },
      accepted ? "on" : "off",
    ) as HTMLButtonElement;
    toggle.addEventListener("click", onToggle);
    ctl.append(el("b", {}, String(count)), toggle);
    row.append(el("span", {}, good.name), ctl);
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
function millNote(b: NonNullable<ReturnType<typeof inspect>>): string {
  if (!b.staffed) return "no one is working here";
  // A worker away at a meal, said plainly: the row above already says `eating`,
  // and a note claiming "working" while nobody is in there would be the panel
  // lying about the one thing it exists to explain.
  if (b.worker === "eating") return "gone to eat — back shortly";
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
 * The stockpile panel's one sentence. Filters and ceilings are the two halves
 * of production control and are easy to mistake for each other, so the panel
 * that carries one names the other: a filter chooses what a pile takes in and
 * never stops a good being made — the mill pulls from any pile regardless.
 */
const FILTER_NOTE = "filters choose what this pile accepts — to stop a good being made, set its limit on the workshop";

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
  for (const [label, value] of pairs) {
    const row = el("div", { class: "row" });
    row.append(el("span", {}, label), el("b", {}, value));
    box.append(row);
  }
  return box;
}

function note(message: string): HTMLElement {
  return el("div", { class: "row note" }, message);
}

/** What a monster's rhythm bar is measuring, in the house voice. */
const RHYTHM_LABEL: Record<"resting" | "prowling" | "homeward", string> = {
  resting: "toward waking",
  prowling: "through its rounds",
  homeward: "heading home",
};

/**
 * The five-segment rust bar, shared by the ribbon's threat meter and a
 * monster's rhythm (docs/STYLEGUIDE.md). Unlit segments are the trough, never
 * a dimmer rust: a bar that is never fully off reads as a standing alarm.
 */
function bars(lit: number, total: number, label: string): HTMLElement {
  const box = el("div", { class: "rows" });
  const bar = el("div", { class: "bars", role: "img", "aria-label": label });
  for (let i = 0; i < total; i++) bar.append(el("i", i < lit ? { class: "on" } : {}));
  const row = el("div", { class: "row" });
  row.append(el("span", {}, label));
  box.append(row, bar);
  return box;
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
