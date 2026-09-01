# Camera input survives second fingers and line-mode wheels

The orbit drag is now bound to one pointer id: a second finger is ignored
until the first lifts, instead of stealing the drag anchor while both
pointers keep feeding it deltas. Wheel zoom normalises `deltaMode`, so a
notch zooms the same amount on browsers that report lines or pages as on
those reporting pixels. Neither the pan model nor the tilt range is touched.

## Detail
- The multi-touch defect was reachable, not theoretical: `#stage` sets
  `touch-action: none`, so on any touch or pen device both pointers dispatch
  `pointermove` and the shared `drag` anchor made the camera spin. Ported
  straight from the mockup, which was mouse-only and never saw it.
- `pointerup`/`pointercancel` now ask `hasPointerCapture` before releasing:
  the browser releases capture implicitly, and releasing an already-released
  pointer throws `InvalidPointerId`.
- Line-mode wheels are converted at 16px/line, 400px/page — approximations,
  not measured. Firefox on Windows/Linux reports ~3 lines per notch, which
  the raw `deltaY` read turned into a ~30× weaker zoom. Untested on a real
  line-mode browser; the fix is by construction.
- WASD key matching moved from `in` to `Object.hasOwn`: `in` walks
  `Object.prototype`, so a key code like `constructor` would have entered the
  held set and driven the focus to NaN permanently. Unreachable with real key
  codes — hardening, not a fix for anything observed.
- Also here, too small for their own entries: the water material's shader
  injection got the anchor guard `cozify` already had (a three upgrade
  renaming either anchor would otherwise stop the wave silently), the
  renderer re-reads `devicePixelRatio` on resize so moving the window between
  displays of different DPI no longer leaves it rendering at the old ratio,
  and `.playwright-mcp/` is gitignored.
- Known and deliberately not changed: the sun's shadow box is a fixed ±24
  units around the focus while the zoom-out clamp shows ~120 units of ground,
  so shadows stop partway to the screen edge at wide zoom. Scaling the box
  with the frustum would trade that for zoom-dependent shadow sharpness,
  which `src/render/scene.ts` explicitly chose against.
- Verified: 24 Vitest tests, lint, `tsc --noEmit`, and a Playwright load at
  `?seed=42` — renders, pans, console clean.
