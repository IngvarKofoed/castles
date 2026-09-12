import { defineConfig } from "vitest/config";

export default defineConfig({
  /**
   * The dev and preview ports are pinned, and `strictPort` makes a collision
   * fail loudly rather than sliding to the next free port — a silent slide
   * serves the page you meant to test from an address nobody is looking at,
   * behind whatever stale server already held the default.
   *
   * 8790 / 8791 / 8792 is the project's one contiguous block: 8791 is the
   * mockups' static server (README), so preview takes 8792 rather than
   * treading on it.
   */
  server: { port: 8790, strictPort: true },
  preview: { port: 8792, strictPort: true },
  test: {
    environment: "node",
    /**
     * Vitest's 5 s default is a browser-test number, and this suite is not that
     * shape: several tests drive the sim for well over a thousand ticks against
     * a 256² world, which is honest work rather than a hang. The recorded cost
     * is two full-grid scans per tick (docs/changelog/2026-09-02-stone-and-terraform.md),
     * and the threat tier added a third grid read plus two dozen monsters on
     * top — enough to put a scripted double-run past the default.
     *
     * Raised rather than worked around: shortening the scripted runs would cost
     * the determinism pin its coverage, which is the opposite trade.
     *
     * 120 s, arrived at by being wrong twice. The slowest test is the scripted
     * encounter — 16 s of honest work on an idle machine — and ceilings of 30 s
     * and then 60 s both failed it on a loaded one, where the whole suite ran
     * 4–20× slower than its idle time. No fixed ceiling survives arbitrary
     * contention, so the real fix went into the test (its tick-by-tick trace
     * now rides the run it already makes instead of a second one); this is the
     * margin around what is left. Still a hang detector — nothing here should
     * take two minutes of its own work — and if it fires again, look for a
     * genuine hang or another duplicated scripted run rather than raising it.
     */
    testTimeout: 120_000,
  },
});
