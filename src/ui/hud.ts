import type { Command } from "../sim/commands";
import {
  BUILDING_DEFS,
  BuildingKind,
  BuildingState,
  WALL_LOG_COST,
  inspect,
  readout,
  type BuildingKindValue,
  type Sim,
} from "../sim/know";
import "./hud.css";

/**
 * The HUD: top ribbon, left build rail, right inspector, and a labour panel
 * pinned to the bottom-right.
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
  | { kind: "build"; building: BuildingKindValue }
  | { kind: "wall" }
  | { kind: "gate" }
  | { kind: "raze" };

/** The three tools that put walls on the map, and the ones the enclosure wash
 *  appears for. Nothing tints the world permanently. */
export function isWallTool(tool: Tool): boolean {
  return tool.kind === "wall" || tool.kind === "gate" || tool.kind === "raze";
}

/** The tools whose left-drag is a selection marquee rather than a run. */
export function isMarqueeTool(tool: Tool): boolean {
  return tool.kind === "chop" || tool.kind === "raze";
}

/**
 * Which rail button a tool belongs to. One place, because the pressed state,
 * the click handler and the tool itself all have to agree on it.
 */
function toolKey(tool: Tool): string {
  if (tool.kind === "build") return BUILDING_DEFS[tool.building].name.toLowerCase();
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

/** How the inspector names where a slot worker is. */
const WORKER_LABEL: Record<"none" | "walking" | "inside", string> = {
  none: "none",
  walking: "on the way",
  inside: "inside",
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
};

export class Hud {
  private readonly root: HTMLElement;
  private readonly res: Record<string, HTMLElement> = {};
  private readonly speedButtons: HTMLButtonElement[] = [];
  private readonly toolButtons = new Map<string, HTMLButtonElement>();
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
  private selected = -1;
  /** Last rendered inspector signature, so the panel only rebuilds on change. */
  private lastPanel = "";

  constructor(
    private readonly sim: Sim,
    private readonly ports: HudPorts,
  ) {
    this.root = el("div", { id: "hud" });
    this.root.append(this.buildRibbon(), this.buildRail());
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
    if (this.selected >= 0) {
      this.selected = -1;
      return;
    }
    this.ports.toggleMenu();
  }

  /** Clear the active tool and any selection — a right-click. */
  clear(): void {
    this.setTool({ kind: "none" });
    this.selected = -1;
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

  select(buildingId: number): void {
    this.selected = buildingId;
  }

  /** Refresh the readouts. Called every frame; rebuilds only what changed. */
  update(): void {
    const r = readout(this.sim);
    this.res.logs.textContent = String(r.logs);
    this.res.planks.textContent = String(r.planks);
    this.res.folk.textContent = String(r.folk);
    this.res.idle.textContent = String(r.idle);
    this.res.enclosed.textContent = String(r.enclosed);
    this.res.day.textContent = `Day ${r.day}`;

    const speed = this.ports.getSpeed();
    for (const b of this.speedButtons) {
      b.setAttribute("aria-pressed", String(Number(b.dataset.speed) === speed));
    }
    this.menuButton.setAttribute("aria-pressed", String(this.ports.menuOpen()));

    this.updateLabour(r.folk, r.pool);
    this.updateInspector();
  }

  // ---------------------------------------------------------------- ribbon

  private buildRibbon(): HTMLElement {
    const ribbon = el("div", { class: "panel ribbon" });
    ribbon.append(el("span", { class: "brand" }, "Castles"));
    ribbon.append(this.resource("logs", "var(--timber)", "logs"));
    ribbon.append(this.resource("planks", "var(--plank)", "planks"));
    ribbon.append(el("span", { class: "divider" }));
    ribbon.append(this.count("folk", "folk"));
    ribbon.append(this.count("idle", "idle"));
    ribbon.append(el("span", { class: "divider" }));
    // The game's progress bar: buildable ground the wall has actually claimed.
    ribbon.append(this.count("enclosed", "enclosed"));

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

  private resource(key: string, color: string, label: string): HTMLElement {
    const span = el("span", { class: "res" });
    const icon = el("i");
    icon.style.background = color;
    const value = el("b", {}, "0");
    this.res[key] = value;
    span.append(icon, value, el("u", {}, label));
    return span;
  }

  private count(key: string, label: string): HTMLElement {
    const span = el("span", { class: "res" });
    const value = el("b", {}, "0");
    this.res[key] = value;
    span.append(value, el("u", {}, label));
    return span;
  }

  // ------------------------------------------------------------------ rail

  private buildRail(): HTMLElement {
    const rail = el("nav", { class: "panel rail", "aria-label": "Build tools" });
    rail.append(el("span", { class: "rail-label" }, "Build"));
    rail.append(this.toolButton("Chop", { kind: "chop" }, ""));
    for (const kind of [BuildingKind.Stockpile, BuildingKind.Sawmill] as BuildingKindValue[]) {
      const def = BUILDING_DEFS[kind];
      rail.append(this.toolButton(def.name, { kind: "build", building: kind }, `${def.cost} logs`));
    }
    // The wall family, below the three that were here first. Wall and gate
    // cost the same materials and differ in labour, so both read "1 log".
    const logs = `${WALL_LOG_COST} log${WALL_LOG_COST === 1 ? "" : "s"}`;
    rail.append(this.toolButton("Wall", { kind: "wall" }, logs));
    rail.append(this.toolButton("Gate", { kind: "gate" }, logs));
    rail.append(this.toolButton("Raze", { kind: "raze" }, ""));
    return rail;
  }

  private toolButton(label: string, tool: Tool, cost: string): HTMLButtonElement {
    const key = toolKey(tool);
    const b = el("button", { class: "tool", type: "button", "aria-pressed": "false" }) as HTMLButtonElement;
    b.innerHTML = ICONS[key] ?? "";
    b.append(el("span", {}, label));
    if (cost) b.append(el("span", { class: "cost" }, cost));
    b.addEventListener("click", () => {
      this.setTool(sameTool(this.tool_, tool) ? { kind: "none" } : tool);
    });
    this.toolButtons.set(key, b);
    return b;
  }

  private setTool(tool: Tool): void {
    this.tool_ = tool;
    if (tool.kind !== "none") this.selected = -1;
    const active = tool.kind === "none" ? "" : toolKey(tool);
    for (const [key, b] of this.toolButtons) {
      b.setAttribute("aria-pressed", String(key === active));
    }
  }

  // ------------------------------------------------------------- inspector

  private updateInspector(): void {
    if (this.selected < 0) {
      this.inspector.hidden = true;
      this.lastPanel = "";
      return;
    }
    const b = inspect(this.sim, this.selected);
    if (!b) {
      this.selected = -1;
      this.inspector.hidden = true;
      this.lastPanel = "";
      return;
    }
    this.inspector.hidden = false;

    const signature = [
      b.id,
      b.state,
      b.staffed,
      b.delivered,
      b.storedLogs,
      b.storedPlanks,
      Math.round(b.progress * 40),
      Math.round(b.milling * 50),
      b.stall,
      b.worker,
    ].join("|");
    if (signature === this.lastPanel) return;
    this.lastPanel = signature;

    this.inspector.replaceChildren(...this.panelFor(b));
  }

  private panelFor(b: NonNullable<ReturnType<typeof inspect>>): Node[] {
    const nodes: Node[] = [];
    const head = el("div", { class: "insp-head" });
    head.append(el("h3", {}, b.name));
    head.append(el("span", { class: `tag ${tagClass(b)}` }, tagLabel(b)));
    nodes.push(head);

    if (b.state === BuildingState.Blueprint) {
      nodes.push(rows([["Logs delivered", `${b.delivered} / ${b.cost}`]]));
      // The house voice: quiet text in the panel, no alert and no colour
      // change anywhere else (docs/STYLEGUIDE.md, Tone).
      nodes.push(note(`waiting for logs (${b.delivered} / ${b.cost})`));
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

    if (b.kind === BuildingKind.Stockpile) {
      nodes.push(
        rows([
          ["Stored", `${b.storedLogs + b.storedPlanks} / ${b.capacity}`],
          ["Logs", String(b.storedLogs)],
          ["Planks", String(b.storedPlanks)],
        ]),
      );
      nodes.push(note("accepts logs and planks"));
      return nodes;
    }

    nodes.push(chain("Log", "Plank"));
    nodes.push(
      rows([
        // The worker row is load-bearing once someone is inside: the renderer
        // stops drawing them, so this is where the player reads that the slot
        // is filled.
        ["Worker", WORKER_LABEL[b.worker]],
        ["Input", `${b.storedLogs} / ${b.inputCap}`],
        ["Output", `${b.storedPlanks} / ${b.outputCap}`],
      ]),
    );
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

function sameTool(a: Tool, b: Tool): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "build" && b.kind === "build") return a.building === b.building;
  return true;
}

/**
 * What a sawmill is doing, in the house voice. A stalled mill has to name the
 * reason it stalled — "waiting for logs" while the input buffer is full is the
 * panel lying, and the panel is the only diagnosis the player gets.
 */
function millNote(b: NonNullable<ReturnType<typeof inspect>>): string {
  if (!b.staffed) return "no one is working here";
  if (b.stall === "output-full") return "output full — nowhere to put the planks";
  if (b.stall === "no-logs") return "waiting for logs";
  return "cutting";
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

function meter(fraction: number): HTMLElement {
  const bar = el("div", { class: "meter" });
  const fill = el("span");
  fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
  bar.append(fill);
  return bar;
}

function chain(from: string, to: string): HTMLElement {
  const box = el("div", { class: "chain" });
  box.append(el("span", { class: "chip" }, from), el("span", { class: "arrow" }, "→"), el("span", { class: "chip" }, to));
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
