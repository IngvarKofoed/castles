# Castles

A low-stress voxel colony builder: short production chains, a wall ring you push
outward for more room, and a telegraphed threat from the woods that gives the
wall a reason to exist.

## Run

```sh
npm install
npm run dev        # a generated 256×256 island: drag to orbit, WASD to pan, scroll to zoom
npm test           # sim + mesher tests
npm run lint       # includes the src/sim purity boundary
```

Seeds are shareable: `?seed=42` always generates the same world.

## Mockups

Two visual mockups in [`mockups/`](mockups/), both single self-contained HTML
files with no build step. Open one in a browser, or serve the folder:

```sh
python3 -m http.server 8791    # then open http://localhost:8791/mockups/mockup3d.html
```

| File | What it is |
| --- | --- |
| `mockups/mockup3d.html` | three.js: lit, shadowed, orbitable, animals and smoke. The current look. |
| `mockups/mockup.html` | the earlier painted 2D canvas version. Zero dependencies, one fixed camera. |

Both mockups: click a building to inspect it, pick a tool and click the ground to
place, preview Ring II or III and raise it. The 3D one adds drag-to-orbit,
scroll-to-zoom and a sun slider.

## Docs

- [`docs/CONCEPT.md`](docs/CONCEPT.md) — the game: pillars, the pool-vs-slot
  labour model, what Kubifaktorium actually does, and which design decisions are
  still open.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — how the mockups are built:
  world generation and the octagon-ring maths, both renderers, the shader
  injections, the animal system, and a list of gotchas that each cost real time.
- [`docs/changelog/`](docs/changelog/) — one entry per piece of work.

## Published

- 3D mockup — https://claude.ai/code/artifact/474ecf6d-4e55-4b31-a9b1-98bbfc3683e9
- 2D mockup — https://claude.ai/code/artifact/46d93789-1290-4929-bb67-d9857cc5214b

Neither mockup is a game: there is no tick, no resource flow, no task queue.
They exist to pin down the look, the HUD and the wall-ring mechanic.
