import type { SaveMeta } from "../app/storage";
import "./hud.css";

/**
 * The menu: save, load, export, import, delete, new colony.
 *
 * A **centre modal panel** — the one sanctioned exception to the styleguide's
 * "panels hug the edges, the centre belongs to the game" rule, allowed because
 * the game is paused behind it and there is no world in the way. Same moss-
 * glass anatomy as the edge panels, one size wider (docs/STYLEGUIDE.md,
 * "Centre modal").
 *
 * It deliberately lives **outside** the per-sim session that `app/main.ts`
 * builds and tears down: loading a save disposes that session, and a panel
 * that disposed itself from inside its own click handler would be a bug
 * waiting to happen. The menu owns no sim state — every action goes out
 * through `MenuPorts` and comes back as a list refresh or a note row.
 *
 * The house voice throughout: errors are the panel's italic faint note, never
 * a toast, an alert or a colour change anywhere else.
 */

export interface MenuPorts {
  /** Saves, in whatever order the menu should show them (newest first). */
  list(): Promise<SaveMeta[]>;
  save(name: string): Promise<void>;
  load(key: string): Promise<void>;
  exportSave(key: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** Opens the picker, decodes, loads and keeps a local copy. */
  importSave(): Promise<void>;
  newColony(): void;
  /** null when saving works; a sentence when it is off entirely, which also
   *  disables the save controls. */
  unavailable(): string | null;
  /** What the note row should say when the menu opens — a refused write, say.
   *  Separate from `unavailable` because a failed write is worth reading but
   *  must not disable the retry. */
  note(): string | null;
  /** Fired on every open and close — the app forces pause and restores speed. */
  onOpenChange(open: boolean): void;
}

export class Menu {
  private readonly scrim: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly savesList: HTMLElement;
  private readonly noteRow: HTMLElement;
  private readonly importButton: HTMLButtonElement;
  private readonly newButton: HTMLButtonElement;

  private open_ = false;
  /** True while an action is in flight; every button reads it, so a slow
   *  IndexedDB write cannot be double-submitted into two saves. */
  private busy = false;
  /** The one button currently awaiting its confirming second click. */
  private armed: HTMLButtonElement | null = null;
  private armedTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly ports: MenuPorts) {
    this.scrim = el("div", { class: "scrim", role: "dialog", "aria-modal": "true", "aria-label": "Menu" });
    this.scrim.hidden = true;
    this.panel = el("div", { class: "menu" });
    this.scrim.append(this.panel);

    this.panel.append(el("h3", {}, "Menu"));

    this.panel.append(el("h4", {}, "Save this colony"));
    const field = el("div", { class: "field" });
    this.nameInput = el("input", { type: "text", placeholder: "name this save", "aria-label": "Save name" }) as HTMLInputElement;
    this.nameInput.maxLength = 48;
    this.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.doSave();
    });
    this.saveButton = button("action", "Save", () => this.doSave());
    this.saveButton.style.width = "auto";
    field.append(this.nameInput, this.saveButton);
    this.panel.append(field);

    this.panel.append(el("h4", {}, "Saved colonies"));
    this.savesList = el("div", { class: "saves" });
    this.panel.append(this.savesList);

    this.noteRow = el("div", { class: "row note" });
    this.noteRow.hidden = true;
    this.panel.append(this.noteRow);

    const tail = el("div", { class: "tail" });
    this.importButton = button("mini", "Import file", () => this.run(() => this.ports.importSave()));
    this.newButton = button("mini", "New colony", () => {
      // Guarded by a second click rather than a dialog: a modal on top of a
      // modal is not this game's voice.
      if (this.confirm(this.newButton, "Really — click again")) return;
      this.ports.newColony();
    });
    tail.append(this.importButton, this.newButton);
    this.panel.append(tail);

    // A click on the scrim itself (never on the panel) closes the menu.
    this.scrim.addEventListener("pointerdown", (e) => {
      if (e.target === this.scrim) this.close();
    });

    // While the menu has focus its keys are its own: the camera rig binds WASD
    // on `window`, so without this, typing a save name pans the map behind the
    // panel. Escape is the exception — it belongs to the app's one ladder.
    for (const type of ["keydown", "keyup"] as const) {
      this.scrim.addEventListener(type, (e) => {
        if (e.key !== "Escape") e.stopPropagation();
      });
    }

    document.body.append(this.scrim);
  }

  get isOpen(): boolean {
    return this.open_;
  }

  toggle(): void {
    if (this.open_) this.close();
    else this.open();
  }

  open(): void {
    if (this.open_) return;
    this.open_ = true;
    this.scrim.hidden = false;
    this.note(this.ports.note());
    this.disarm();
    void this.refresh();
    this.ports.onOpenChange(true);
    this.nameInput.focus();
  }

  close(): void {
    if (!this.open_) return;
    this.open_ = false;
    this.scrim.hidden = true;
    this.disarm();
    this.ports.onOpenChange(false);
  }

  /** Say something in the note row — the only place the menu reports anything. */
  note(message: string | null): void {
    this.noteRow.textContent = message ?? "";
    this.noteRow.hidden = !message;
  }

  /** Re-read the saves list. Called on open and after every action. */
  async refresh(): Promise<void> {
    let saves: SaveMeta[] = [];
    const unavailable = this.ports.unavailable();
    try {
      saves = await this.ports.list();
    } catch {
      // With no store at all the listing always fails, and the *reason* is the
      // sentence worth reading — a generic "could not be read" here would
      // overwrite it every time the panel opens.
      this.note(unavailable ?? "the save store could not be read");
    }
    const disabled = unavailable !== null;
    this.nameInput.disabled = disabled;
    this.saveButton.disabled = disabled || this.busy;
    this.importButton.disabled = this.busy;
    this.newButton.disabled = this.busy;

    if (!saves.length) {
      this.savesList.replaceChildren(el("div", { class: "row note" }, "no saved colonies yet"));
      return;
    }
    this.savesList.replaceChildren(...saves.map((s) => this.rowFor(s)));
  }

  private rowFor(save: SaveMeta): HTMLElement {
    const row = el("div", { class: "save" });
    const head = el("div", { class: "save-head" });
    head.append(el("b", {}, save.name), el("span", {}, `Day ${save.day}`));
    row.append(head);
    row.append(el("div", { class: "save-sub" }, `${save.population} folk · ${stamp(save.savedAt)}`));

    const acts = el("div", { class: "save-acts" });
    const load = button("mini", "Load", () => this.run(() => this.ports.load(save.key)));
    const exp = button("mini", "Export", () => this.run(() => this.ports.exportSave(save.key)));
    const del = button("mini", "Delete", () => {
      if (this.confirm(del, "Sure?")) return;
      void this.run(() => this.ports.remove(save.key));
    });
    for (const b of [load, exp, del]) b.disabled = this.busy;
    acts.append(load, exp, del);
    row.append(acts);
    return row;
  }

  private doSave(): void {
    const name = this.nameInput.value.trim();
    if (!name) {
      this.note("give the save a name first");
      return;
    }
    void this.run(async () => {
      await this.ports.save(name);
      this.note(`saved as “${name}”`);
    });
  }

  /**
   * Run one action, with the panel locked while it is in flight and any
   * failure landing in the note row. Nothing here throws at the caller: a
   * refused write is something the player reads, not something the console
   * swallows.
   */
  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.disarm();
    this.note(null);
    await this.refresh();
    try {
      await action();
    } catch (error) {
      this.note(messageOf(error));
    } finally {
      this.busy = false;
      if (this.open_) await this.refresh();
    }
  }

  /**
   * Arm a destructive button, or fire it. Returns true while the button is
   * only *armed*, so the caller does nothing on the first click. Ten seconds
   * later it goes back to its own label, because a button left saying
   * "Really?" across a whole session is a trap.
   */
  private confirm(target: HTMLButtonElement, prompt: string): boolean {
    if (this.armed === target) {
      this.disarm();
      return false;
    }
    this.disarm();
    this.armed = target;
    target.dataset.label = target.textContent ?? "";
    target.textContent = prompt;
    target.classList.add("armed");
    this.armedTimer = setTimeout(() => this.disarm(), 10_000);
    return true;
  }

  private disarm(): void {
    clearTimeout(this.armedTimer);
    const target = this.armed;
    this.armed = null;
    if (!target) return;
    target.textContent = target.dataset.label ?? "";
    target.classList.remove("armed");
  }
}

/** A save's timestamp, short: the list is scanned, not read. */
function stamp(savedAt: number): string {
  return new Date(savedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "that didn't work";
}

function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", { class: className, type: "button" }, label) as HTMLButtonElement;
  b.addEventListener("click", onClick);
  return b;
}

function el(tag: string, attrs: Record<string, string> = {}, content?: string): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (content !== undefined) node.textContent = content;
  return node;
}
