/**
 * The one Node API anything in this repo reaches for: reading the committed
 * `.castles` save fixture off disk in a Vitest run.
 *
 * Declared by hand rather than by installing `@types/node`, which would put
 * `process`, `Buffer`, `require` and the rest in scope across *every* file —
 * including `src/sim/`, the subtree whose whole point is that it has no host
 * to reach for. A four-line shim keeps that boundary honest at the type level.
 */
declare module "node:fs" {
  export function readFileSync(path: URL | string): Uint8Array;
}
