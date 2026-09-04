# The repo has an origin, and every commit is authored from one address

`origin` is `git@github.com:IngvarKofoed/castles.git`, so pushing is possible
for the first time — and still only when asked. Author, committer and the
`v0.1.0` tagger on all six pre-existing commits were rewritten to
`ingvar@netaben.dk`, which is now also this repo's local git identity, so it
cannot drift with the global one.

## Detail
- **Every commit hash before this entry changed.** The rewrite predates any
  push, so nothing was published under the old hashes and nobody has a clone
  to reconcile — but a hash written down anywhere outside git is now wrong.
  Nothing in `docs/` or `src/` cited one (checked); changelog entries cite
  each other by *slug*, which is exactly why that convention exists.
- Content is provably untouched: the tip tree hash is `c2848603` before and
  after, six commits before and after.
- **The address that was replaced is deliberately not written down here, or
  anywhere else in the repo.** Rewriting authorship and then naming the old
  address in a tracked file publishes exactly what the rewrite was for — and
  a changelog entry is as public as a commit trailer. The *fact* of the
  rewrite is durable project memory; the string is not.
- `git filter-branch --env-filter` did it, not `git-filter-repo` — the latter
  is not installed here, and at six commits the deprecated tool is the shorter
  path. Its `refs/original/*` backup of the pre-rewrite history was deleted
  once the new history was pushed and verified: it held the only remaining
  copies of the old identity, the trees were identical to the rewritten ones,
  and a later `push --all` or `--mirror` would have sent them up.
- **The tag needed a second pass.** `--tag-name-filter cat` re-points an
  annotated tag at the rewritten commit but keeps the original tag object, so
  `v0.1.0`'s tagger survived the first pass. It was re-created with its own
  message and `GIT_COMMITTER_DATE` set to its original
  `2026-09-01T12:31:05+02:00`, so `git describe` still anchors the app version
  exactly as before.
- `CLAUDE.md`'s git section said "No remote is configured yet"; that sentence
  is now false and was replaced by the remote's name. The push-only-when-asked
  rule is unchanged and is the half that still binds.
