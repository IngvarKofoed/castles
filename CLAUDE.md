# Castles

A low-stress voxel colony builder where the wall is absolute, risk is chosen
rather than imposed, and people are the only scarce currency.

## Always read first

Before doing any work in this repo, **always read all** of these:

- @docs/CONCEPT.md — what the game is: the three pillars (absolute wall, expansion-as-risk, chains pull outward), the pool/slot labour model, the orc/troll threat model, and the promise that risk is never imposed, only chosen
- @docs/ARCHITECTURE.md — how it's built: TypeScript + three.js + Vite, the pure `src/sim/` boundary (fixed tick, determinism, plain-data state), truth vs knowledge, repo layout, persistence, build order — plus the record of the two mockups

Then the changelog, as **actions** rather than loads — no `@`-reference can express "the files of a folder", so this part is yours to fetch. There is no summary file to load in its place: `docs/changelog/` is the entire record, and these steps are the only way into it.

1. `ls docs/changelog` — the index, **in full, not a tail**, so that every entry the project has ever written is named once: recent work at the bottom, everything older above it. Each entry is its own file, `YYYY-MM-DD-<slug>.md`. This is not free — it costs roughly a dozen tokens per entry and grows for the life of the repo — but a name is the cheapest possible handle on an entry, and being able to see that something exists is what makes step 4 findable rather than guesswork. Past **~1000 entries** the balance tips: hand the full listing to step 3's subagent instead and read a generous tail here. An absent folder just means no entries yet.
2. Read the **newest 10** in full, or **everything from the last seven days**, whichever is more. Ten is a **floor, not a measure**: at four changes a day it is two days of memory, and in a heavy week barely one. Step 1 already gave you the dates, so you can see which of those two the floor lands on before you start — and if the work you are about to do reaches back further than either, keep reading back until it doesn't.
3. **Delegate a digest of everything behind the window** to a cheap, fast subagent (Haiku or equivalent) — never the main session, since the whole point is that the reading cost lands somewhere other than this context. **Skip this step** when delegating to a subagent isn't available here, or when step 1 showed little behind the window — with thirty entries the window already covers the repo and there is nothing to summarize. Give the subagent `ls -r docs/changelog | tail -n +11` (every entry older than the ten you just read, newest first; written this way because a negative `head -n` count is GNU-only and errors out on macOS) and this brief: read each **lead**, open a `## Detail` only when the lead signals a decision, and return **at most 20 lines** of what a session must not re-litigate — a decision with a rejected alternative, something tried and removed, a constraint that still binds, an entry that reversed an earlier one. Not a recap of what changed; the entries are already that. Leads are 1–5 lines by rule, so this stays affordable across the whole history rather than a recent band. **Never write its output to a file.** Regenerating it per session is what makes it unable to rot, and what keeps anything in git from contending for it.
4. **Before you touch an area, grep the folder for it** — `grep -rli <term> docs/changelog/`, using the words you would pick to describe what you are about to change. This is the only path to a decision made months ago, and the index in step 1 is what tells you which terms are worth trying.

**The grep is not optional and it is not a fallback**, with or without the delegated digest. Nothing here will *show* you a decision from six months back on its own — the index names it, the grep opens it, and skipping both means re-litigating it with nothing signalling that anything is missing. The digest helps but does not replace it: 20 lines distilled from hundreds of leads is necessarily lossy, and it reads leads rather than detail, so the thing you need may be in a `## Detail` it never opened. So before you write a changelog entry, confirm you did both: *did I list `docs/changelog/` this session, and grep it for what I touched?*

`CONCEPT.md` and `ARCHITECTURE.md` are the source of truth for *what* we're building, what we've built, and *how* it's structured. If something in the code contradicts them, either the code or the doc is wrong — flag it rather than guessing.

## Changelog discipline

Every change you make to this repository must be recorded in `docs/changelog/` as **its own file**, named `YYYY-MM-DD-<slug>.md` — the date you write it, then a 2–4 word kebab-case slug. Same shape as `docs/specs/`. There is no single changelog file and there are no entry numbers: one file per change is what makes two parallel changes unable to collide, because no two can reach for the same path.

- **The file has two tiers, bounded differently.** A `#` heading, then a **lead** of **1–5 lines, ~20 words per line at most** — never one packed run-on line, since a 40-word run-on isn't a short entry, it just hides the bulk on a single line. Below it, a **`## Detail`** section — **owed whenever one of these exists, omitted only when none does**: an alternative you rejected (so nobody re-introduces it), a constraint that still binds, a known limit or deferred follow-up, a gap a future session would otherwise assume your verification covered. Write it now or not at all: these live in the context of the session that made the change and are gone when it ends, which is why the section is owed here rather than merely allowed. **It never restates the lead** — padding, not omission, is what goes wrong with a section nothing bounds by length. The lead is bounded because it is what a session reads to orient; the detail is bounded by *purpose*, because nothing else bounds it now that entries no longer share a file. Past ~40 lines of detail the change wanted a spec — write one and link it.
- **Write the lead as durable project memory, not a recap of the diff**: what is now *true that wasn't before* — new behavior, state, or rule — plus, in a clause and only when it isn't obvious, the *why*. Skip filenames, mechanical edits, and refactors with no behavior change; the diff and commit already hold those. Self-check: *if a future agent reads this before the code, does it learn what changed, why it matters, or what's now safe to assume?* If not, it's noise.
- **A landed entry file is never renamed, moved, or deleted.** Its path is its address — other docs, specs and code comments cite it by slug — and this is the one thing here that can break silently. Two changes claiming the same path is a merge conflict, which git blocks; a rename produces no conflict and breaks every citation to that entry with nothing noticing. **Cite in the other direction too:** when your change revisits, narrows or reverses a decision an earlier entry recorded, name that entry's slug in yours. That makes the chain greppable instead of something a future session has to reconstruct — and with no digest carrying it, this is *the* mechanism by which rationale reaches back past the recent window, without any entry growing.
- Write the entry as part of the same change. One file per change: don't batch several changes into one file, and don't skip entries. If a change is genuinely several, give each its own file.
- **Where `HEAD` is doesn't matter.** On `main`, on a branch, in a worktree — the entry file is written the same way in all of them, with nothing staged or moved at any point, because the file you write is the file that lands.
- **Write so the index and a grep can find it, because nothing else will.** There is no digest and no curated decision list — deliberately, since any such file is one every change appends to and every compaction rewrites, which is the collision the folder exists to remove. Your entry file is the only copy, reachable exactly two ways: by its slug in `ls docs/changelog`, and by grep over the folder. So the **slug names the thing, not the activity** — `expired-refresh-tokens`, not `auth-fixes` — because the slug is the only part of your entry every future session sees. And when the change carries a decision that must not be re-litigated, say it in the words someone would search for: name the alternative you rejected, the constraint that still binds, the thing you tried and removed. Don't allude to it. An entry nobody can find is an entry nobody wrote.

Same change, bad vs. good entry — `docs/changelog/2026-03-14-expired-refresh-tokens.md`:

- **Bad** (short, but just recaps the diff — zero orientation value):
  ```
  # Auth changes

  Updated auth files, reworked middleware, added tests, renamed AuthHelper.
  ```
- **Good** (states what's now true, with the why in a clause, and puts the rejected alternative where it can't rot):
  ```
  # Expired refresh tokens rejected before session lookup

  Auth now rejects expired refresh tokens before session lookup; stale sessions can
  no longer silently renew. Validated at the middleware boundary, so handlers can
  assume every request they see is current.

  ## Detail
  - Rejected checking this in the session store: the store can't tell "expired" from
    "never existed", so the error the client got would have been wrong.
  ```

## Nested guidance

Each `src/` subtree has its own `CLAUDE.md` with scoped tool/skill rules:

- `src/sim/CLAUDE.md` — the pure simulation: the hard import boundary, determinism rules, plain-data state, testing
- `src/render/CLAUDE.md` — the three.js renderer: knowledge-only reads, chunked instancing, visual verification
- `src/ui/CLAUDE.md` — HUD and menus: plain DOM rules, browser-driven verification

## Reviewing changes

**This repo has exactly one review point: the commit.** Do not review after every edit, and do not run an unrequested review pass mid-session. A pass per prompt costs more than it catches — it only ever sees its own turn's edits, and the next follow-up re-opens what it just looked at.

What does *not* wait for the commit is verifying your own work: run the tests, the build, and whatever the subtree's `CLAUDE.md` mandates, per change, as always. Deferred here is the *review*, not the checking. Never report a change complete on the grounds that its review comes later.

The commit is the right moment because it's when the diff is sealed into history, and because it's the first point where the accumulated diff can be read as **one change** — which is what a review needs. Reviewed edit-by-edit, from inside the context that just wrote each one, a review sees the least and repeats its own blind spots.

**So when the user asks you to commit (or commit and push) and the working tree holds non-trivial changes, ask before committing** — `AskUserQuestion`, three options in this order:

1. **`/code-review high --fix`** — the deep pass: broad coverage, correctness plus reuse / simplification / efficiency, repairs applied to the working tree.
2. **`/fix-code --fix`** — the tight pass: every finding rated by consequence and independently verified, only the serious and unambiguous ones repaired.
3. **Commit now** — skip the review and go straight to the commit.

The first two are both real reviews; they differ in breadth and cost, not in whether the change gets looked at. **Option 1 leads because it catches the most** — recommend it for the diff this gate usually sees (accumulated over several rounds, or landed by a fan-out), and option 2 when the diff is small, contained, and already well understood.

**Label each option with the path that will actually run**, so the choice is concrete rather than abstract. `/code-review` ships with the harness, so option 1 is always available exactly as written — keep the explicit `high`, because without a level the command silently reuses whatever level was typed last. `/fix-code` is an installed skill: when it isn't present, option 2 becomes **"Review inline"** and you run that review yourself. Don't hide which of these the user is about to get behind a generic label — they differ in cost and in calibration.

**You** run the pass; the user is only choosing whether it happens and how deep it goes. This is the one place the review flow stops to ask — there is no end-of-turn nudge to go run a review elsewhere.

- Ask **once per commit request**, not per round or per file. If the user picks a review, run it, report, then continue to the commit without asking again.
- **Skip the question** when the diff is trivial — a typo, a version bump, a changelog line — or when a full review pass has already covered this working diff since the last edit. Asking there is noise.
- **Any** commit request goes through the gate, including a delegated one (`/git commit`, `/git commitandpush`) — check it before handing off, not after. A skill or subagent that does the committing never sees this rule.
- If the user picks *Commit now*, that's the answer — commit as asked, and don't re-offer or hedge about it afterwards.

### Running the review pass

**Option 1 — `/code-review high --fix`.** It reviews the current diff at high effort: broader coverage than the lower levels, including findings it isn't fully certain of, which is what you want at a gate that fires once per commit. Its brief is wider than option 2's — correctness bugs *and* reuse / simplification / efficiency cleanups in the same pass — and `--fix` applies what it finds to the working tree after the review. Its own report stands; don't restate it. Being the broader path, it will also repair things option 2 would have deliberately left alone, so read the resulting diff before committing rather than assuming every edit was a blocker.

**Option 2 — `/fix-code --fix`, whenever that skill is installed.** It resolves the diff scope itself, rates every finding 1–5 by consequence, has an independent verifier refute each one before repairing, takes a restore point first, and applies the repairs that are both serious and unambiguous — reversible via `/fix-code --undo`. Its own report stands; don't restate it. Two things it deliberately does *not* do: it leaves severity-1 and -2 findings unrepaired, and it treats style / naming / reuse as `/simplify`'s job and deep security work as `/security-review`'s. Run those separately if the change warrants them.

**When `fix-code` isn't installed, option 2 is that same review run by you, inline over the working diff.** A missing skill doesn't remove the review — it only changes who performs it. Scale it to the diff:

- **Small, contained diff** — read it yourself in one careful pass.
- **Substantial or complex diff** (what an accumulated multi-round working tree usually is) — fan the review out across **subagents via the Agent tool** (individual agents; this needs no ultracode opt-in — that gate is only for the Workflow tool), **one per dimension that's actually at risk in this diff (typically 2–4)**, then **verify each finding before acting on it**. Review finders run on the strong model; verification can drop a tier (the same tiering as *Multi-agent workflows* below). If the Agent tool isn't available, do the same review yourself in one thorough pass.

Check, across the diff: **correctness, security & data-integrity, edge cases & tests, reuse / duplication, clarity, performance, and conformance to this repo's own conventions** (the CLAUDE.md rules and established patterns). Then **apply every fix to the working tree automatically** and report:

1. **Group the applied fixes by severity** — blockers (correctness bugs, data loss, security), should-fix (clear improvements, missed reuse), nits (style, naming, minor clarity).
2. **Summarize each bucket in one line** so the user can see what was fixed without expanding every finding.
3. Do not stop to ask which to fix — all findings are fixed by default. The user can read the diff and revert anything they disagree with.

Every path closes the same way: say plainly what the review couldn't settle — you guessed at intent, left a known gap, or nothing covers it — so the user knows where their own judgement is still needed. State it as a fact about the change, not as a recommendation to run anything.

## Multi-agent workflows

When you fan a task out across subagents — the Workflow tool ("ultracode") — tier each agent's model and reasoning effort to the work, so cost tracks value instead of every agent defaulting to the strongest (most expensive) model:

- **Strongest model** (the session model) — contracts, correctness-critical implementation, adversarial review (finding unknown problems), and any verification or synthesis that needs design judgment or where a wrong call silently drops a real defect (security, data-integrity, correctness blockers). Never downgrade these; they are where quality is won or lost.
- **Mid model** — build/test runners, straightforward mechanical implementation, verifying concrete already-stated findings (the review did the catching), and applying already-decided fixes.
- **Cheapest model + low effort** — i18n, styling, and other boilerplate.

The guardrail: the stage that *catches* an unknown problem (review) stays strong; a stage that only *checks* or *applies* an already-identified one drops a tier by default — escalate a verifier back to the strong model only for subtle or security-/data-integrity-critical findings. For a small finding set, fold verification into the fix-apply agent (verify-and-fix in one pass) rather than one strong agent per finding. Set this per `agent()` call (`model` / `effort`); an agent that omits `model` inherits the session model, which is why an untiered fan-out silently runs everything on the most expensive tier.

**Invoking a named workflow is not authoring one.** The tiers above are yours to set only when *you* write the `agent()` calls. A built-in or named workflow carries no model overrides of its own, so every stage inherits the session model and a wide fan-out bills every agent at the top tier. Size the run before launching it — how many agents the fan-out implies, given the work it's spread over — rather than planning to retier afterwards; editing the `scriptPath` a run reports is a per-run patch, and resuming re-runs every stage from the edited `agent()` call onward, so the untiered agents get billed twice.

**A workflow's aggregate diff is what the review gate is for.** A fan-out edits files across several subagents — often in separate worktrees — so no single agent ever saw the whole combined change, and any review stage *inside* the workflow checked its own findings, not the landed diff. This doesn't earn an extra pass on return; the commit is still the review point. But when the gate asks, say the diff came out of a fan-out — it's where the deep pass earns its cost most clearly, so recommend option 1 there, and if the review falls to the inline path it gets the substantial-diff treatment above even when every agent's own slice looked small.

This section is inert unless you actually run a multi-agent workflow.

## Git workflow

### Where commits land

**Direct to `main`** — when you commit, commit straight to `main`; don't open branches or PRs unless asked. No remote is configured yet; once one exists, push only when asked — a bare "commit" is not a push.

**This setting only chooses *where* commits go — not *when* to make them.** Commit only when the user asks; finishing a change is not a cue to commit it. When you do commit, each commit is one complete change including its changelog entry file — never leave the tree half-committed.

A commit request first passes through the review gate in *Reviewing changes* above — check it before staging anything, wherever the commit is being made: a commit inside a worktree is still a commit.

### Working in a worktree

**Where you are is a fact to check, not a setting to remember.** The same repo gets worked both ways — most sessions in the main checkout, some in a worktree — so before you commit, determine which. `git rev-parse --path-format=absolute --git-dir --git-common-dir` prints two paths: identical in the main checkout, different in a linked worktree. The `--path-format=absolute` is required, not decorative — without it `--git-dir` comes back absolute while `--git-common-dir` comes back relative whenever you are in a subdirectory, so a naive comparison calls every subdirectory of the main checkout a worktree. The first line of `git worktree list` is always the main worktree (documented ordering), and its first whitespace-separated field is the path the landing commands below need; if that line is marked `(bare)` there is no main checkout to drive and the landing steps don't apply as written. In the main checkout, the mode above is the whole story and nothing here applies.

Parallel features each get their own **git worktree**, on a short-lived local branch that exists only to back it — `wt/<slug>`, never pushed, and deleted along with its worktree once you're finished with it. But landing is not finishing: after a landing, continuing to commit on that branch is normal. Drift is a landed branch nobody is working in any more. Starting parallel work means creating a worktree — never run two sessions against the same checkout. Worktrees live in `.claude/worktrees/<slug>` (where `EnterWorktree` puts them; the path is gitignored). Local setup that doesn't carry into a fresh worktree: `node_modules/` — run the install step there once the build exists.

**The changelog works here exactly as it does anywhere else.** Write the entry file into `docs/changelog/` with its change, per *Changelog discipline* above — nothing is staged here and nothing happens to it at landing. What *is* worth knowing is that what you read is the **base copy**: `docs/changelog/` as it stood when the worktree was created, missing anything landed since — which makes the index itself a base index, so a grep that finds nothing here is not proof that nothing exists. Orient from it, but don't conclude from it that something hasn't been done.

**What counts as a landing.** "Push" can only mean `main`, so **"commit and push" means land it** — the words sound smaller than the action, so say which you're doing. A bare "commit" does not: that's a checkpoint on `wt/<slug>`, which still passes the review gate and then stops there.

**Landing.** The commits on `wt/<slug>` are the review point — each passes the gate as it's made. Landing itself adds nothing to review, with one exception: a merge that conflicts, whose resolution is authored work (step 1). Everything else here is mechanical and gets no second pass. You **cannot** update `main` from inside the worktree — both `git push . HEAD:main` and `git branch -f main HEAD` are refused while `main` is checked out elsewhere — so drive the main checkout with `git -C` instead. The session never has to move:

1. **In the worktree:** `git merge main`, resolve any conflicts, commit. Merging `main` in first is what makes step 2 a fast-forward. Two cases, and the difference decides whether the review gate fires: a **clean** merge commits itself, and that merge commit carries no authored content, so it needs no review — this is the normal case, since no two changes here write the same file. A **conflicted** merge leaves the resolution uncommitted, and a resolution *is* authored work, so it goes through *Reviewing changes* before you commit it. Git stopping there is what keeps a hand-resolved merge inside a reviewed commit — you don't have to arrange it.
2. **Land it:** `git -C <main-checkout> merge --ff-only wt/<slug>`, then push per the policy above. **A refusal has two causes, and they need opposite responses — read the error before reacting:**
   - **`main` moved** (rejected as not a fast-forward) — re-run `git merge main` in the worktree, resolve anything it conflicts on, commit, then retry the fast-forward. Your changelog entry needs nothing done to it: it is its own file at its own path, so a landing race can't reach it.
   - **The main checkout is dirty** (`Your local changes would be overwritten by merge`) — `main` has not moved; the obstacle is uncommitted work over there, not the branch. This is what a session working directly in the main checkout looks like from here. Commit or stash there, then retry.
3. **Tear down — if the worktree isn't being kept (see below), and from the main checkout:** `git worktree remove <worktree-path>`, then `git branch -d wt/<slug>` — in that order, since the branch can't be deleted while its worktree exists. Two traps: `git worktree remove` run from *inside* the worktree succeeds by deleting your own working directory out from under you, and every command after it fails; and `rm -rf` on the directory leaves the worktree registered and the branch undeletable until `git worktree prune`.

**A landing asks two things — in one `AskUserQuestion`, not two stops.** The gate's one-ask-per-commit-request rule still holds; the second question rides along in the same prompt: the review question from *Reviewing changes*, and what happens to the worktree once the work has landed.

- **Keep working here** — nothing is torn down. The branch stays and keeps taking commits. Do **not** call `ExitWorktree`: its `keep` returns the session to the original directory, which is the opposite of staying.
- **Remove the worktree** — run step 3. The session leaves the worktree and the next prompt runs in the main checkout; put that in the option label, because this relocates the session rather than just tidying up.

**Keep is the default** — removal costs rebuilding whatever local setup doesn't carry into a fresh worktree; keeping only costs disk. **Skip the question** when the user already said which they want. **Don't offer removal at all** while anything in the worktree isn't landed — uncommitted changes, untracked files, or commits not reachable from `main`: keep it and say why. If the review reported something it couldn't settle, keep regardless and say so.

**If the session entered the worktree with `EnterWorktree`** — and this subsection is the project instruction that authorizes using it — note that it branches from `origin/<default-branch>` unless `worktree.baseRef` is `head`, so local unpushed `main` commits aren't in there. **Land before exiting:** `ExitWorktree` with `remove` refuses while the branch holds commits that aren't on the original branch, and the only way through that refusal is `discard_changes`, which destroys the work. Land first, then `remove` — and only when that's the answer to the question above; if the answer was to keep working, don't call it at all. Its `keep` action is for stepping out of a worktree you intend to return to in a later session.

The worktrees a multi-agent fan-out creates are **not** this: they're ephemeral, they don't commit, and their edits land in the parent tree to pass a single gate there. A fan-out running in the main checkout is also the most likely reason a landing hits the dirty-checkout refusal in step 2.

## App versioning

The version is `git describe --tags --long --always --dirty` (e.g. `v0.1.0-32-g98af7ae`), anchored at the annotated `v0.1.0` tag. New releases are new annotated tags — never a hand-bumped number in a file.

Not wired into a build yet, because there is no build. When build-order step 1 lands (Vite): add `scripts/gen-version.mjs` that resolves `git describe` **once at build time** and writes a generated `src/version.ts` the app imports — the running app never shells out to git. If CI ever builds this, the checkout needs full history and tags (`fetch-depth: 0` on GitHub Actions), or the version silently degrades to a bare hash.
