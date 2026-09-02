import "./hud.css";

/**
 * A single blocking message, in the panel language, with no game behind it.
 *
 * There is exactly one caller: a second tab that could not take the colony
 * lock. Two tabs sharing one autosave ring would overwrite each other's slots
 * with divergent colonies and neither would look wrong until a load, so the
 * second tab says so plainly instead of silently racing.
 */
export function showBlockingNotice(title: string, body: string): void {
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  const panel = document.createElement("div");
  panel.className = "notice";
  const heading = document.createElement("h3");
  heading.textContent = title;
  const text = document.createElement("p");
  text.textContent = body;
  panel.append(heading, text);
  scrim.append(panel);
  document.body.append(scrim);
}
