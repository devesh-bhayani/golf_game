# GAPS.md — honest audit

Ordered by severity. Each entry: what, where, why it matters, and a fix scoped to a single small task.

---

## 1. Classic mode is half-finished and exposed in the UI — HIGH — **FIXED**

> **Status: fixed.** The `classic` option is removed from the create-screen `<select>`; server handlers and the classic table view are kept for rejoin safety.

**What**: `playCard`/`drawCard` have no turn order, no phase check, no round/game end, no scoring, and `drawCard` never reshuffles. Any player can play any card at any time, forever.
**Where**: `CARDS/server/src/index.ts` (`socket.on('playCard'…)`, `socket.on('drawCard'…)`, marked `// ---- Classic mode (preserved) ----`); mode selectable in the create screen of `CARDS/client/src/ui/App.tsx`.
**Why**: A user picking "Classic" gets something that looks broken. It also drags vestigial state (`hands`, `centerPile`) through every snapshot.
**Fix (small)**: Remove `classic` from the client's mode `<select>` so it can't be created from the UI. Leave the server handlers (they're rejoin-safe and harmless). One-line client change + delete one `<option>`.

## 2. Cabo shows your own hand face-up all round — HIGH (gameplay correctness) — **FIXED**

> **Status: fixed (client-side).** Own slots render face-down during play; only a 7/8 peek-own result flips that one slot for ~4s (`peekedHere` in `CaboTable`). The server still sends the full hand via `cabo:hand` (needed for the peek phase and slot identity).

**What**: The server sends the owner their full hand via `cabo:hand` on every deal/mutation, and the client renders `showFaceUp={!!privateCard}` — so you always see all 4 of your cards. Real Cabo is a memory game: after the initial 2-card peek, your own cards are face-down too.
**Where**: server: every `emitToPlayer(io, state, pid, 'cabo:hand', …)` in `index.ts`; client: `CaboSlotView` usage inside `CaboTable` in `App.tsx`.
**Why**: Removes the entire memory element of Cabo; spy/peek-own powers are pointless when you can already see everything.
**Fix (small, client-only)**: In `CaboTable`, render own slots face-down when `!peekActive`, except transient reveals (peek result). The server keeps sending the data (needed for the peek phase and slot identity); the client just stops showing it. If it turns out to be a deliberate easy-mode choice, document it in GOLF_RULES.md instead.

## 3. All state is in-memory; restart drops every live game — HIGH (accepted)

**What**: `games`, `codeToGameId`, `tokenIndex`, `globalLeaderboard` are process-local Maps. Deploy, crash, or Fly/Render machine restart = every session gone; clients' `rejoinGame` fails and they get bounced to the landing page.
**Where**: `CARDS/server/src/index.ts` top-level Maps.
**Why**: Known and documented as acceptable for friends-scale (`CARDS/README.md`). Listed so nobody re-discovers it as a surprise.
**Fix**: None needed now. If it ever matters: serialize `games` to a JSON file on SIGTERM and reload on boot (Maps/Sets need a custom replacer). Do not add Redis for this.

## 4. `globalLeaderboard` grows forever and is keyed by ephemeral IDs — MEDIUM — **PARTIALLY FIXED**

> **Status: growth capped at 100 entries** after the sort in both finalizers. Still keyed by ephemeral playerIds (semantic weirdness remains; acceptable for a decorative feature).

**What**: An unbounded array, appended every finished game, keyed by `playerId` — which is regenerated every join. The same human accumulates unrelated entries under different IDs; entries never expire; sorted with `.find()` linear scans.
**Where**: `index.ts` `globalLeaderboard`, `finalizeGame`, `finalizeCaboGame`, `getLeaderboard`.
**Why**: Slow memory leak plus a leaderboard that's semantically meaningless across sessions (also lost on restart per #3).
**Fix (small)**: Cap it — after the sort in both finalizers, `globalLeaderboard.length = Math.min(globalLeaderboard.length, 100)`. Or delete the feature (client button + handler + array); it's decorative.

## 5. No CI; tests are manual two-terminal scripts — MEDIUM — **FIXED**

> **Status: fixed.** `.github/workflows/test.yml` starts the server with `TEST_HOOKS=1 GAME_TTL_MS=1500 REAP_INTERVAL_MS=700`, waits on `/health`, runs all 8 suites, checks the prod `tsc` build, and builds the client. Local runs still need the same server envs (reaper needs the short TTL).

**What**: 7 test scripts exist and are genuinely good, but nothing runs them automatically. They require a separately-started server on :3001, one (`e2e:cabo:specials`) requires the server env `TEST_HOOKS=1`, and none of this is written down outside a PR description.
**Where**: `CARDS/server/src/test-*.ts`, `e2e*.ts`; scripts in `CARDS/server/package.json`.
**Why**: Regressions land silently; a new contributor won't know the server must already be running (the failure is a connect timeout, not a helpful error).
**Fix (small)**: Add `.github/workflows/test.yml`: install, start server with `TEST_HOOKS=1 &`, wait on `/health`, run the test scripts sequentially, exit nonzero on failure. Also add a "Running tests" section to `CARDS/README.md` (three lines).

## 6. Client/server types are duplicated by hand — MEDIUM — **FIXED**

> **Status: fixed.** Wire types (Card, GamePhase, GameConfig, GolfSlotT, CaboSlotPrivate, GameSnapshot) live in `CARDS/server/src/shared-types.ts`; both sides use type-only imports (erased at compile — no build or runtime changes). Server-internal types (GameState, non-null GolfSlot) stay in index.ts.

**What**: `Card`/`CardT`, `GameSnapshot`, phase unions, config shape all exist twice, maintained by eye. Socket payloads on the client are `any` almost everywhere.
**Where**: `CARDS/server/src/index.ts` (types at top) vs `CARDS/client/src/ui/App.tsx` (types at top).
**Why**: A renamed or added snapshot field compiles fine on both sides and fails at runtime.
**Fix (small)**: Create `CARDS/shared/types.ts` exporting the wire types (Card, GamePhase, GameConfig, snapshot shape); import from both tsconfigs via relative path. Move types only — no behavior. Verify both `tsc` builds after.

## 7. Turn checks on follow-up actions are implicit — MEDIUM (fragile convention) — **FIXED**

> **Status: fixed.** Golf accept/reject now check the turn explicitly (closes a real hole: `golf:kickPlayer` could advance the turn past a player holding a pendingDraw). Cabo handlers carry a comment documenting the implicit pendingDraw guard (kick doesn't exist there, so the invariant holds).

**What**: `golf:acceptDrawAndSwap`, `golf:rejectDrawAndReveal`, `cabo:placeDrawn`, `cabo:discardDrawn`, `cabo:useSpecialPower`, `cabo:blackKingDecide` never check whose turn it is. They're guarded only by "you have a pendingDraw entry", which only the turn player can acquire (draw is turn-checked).
**Where**: the listed handlers in `index.ts`.
**Why**: Correct today, but the invariant lives in nobody's head. Any future code path that grants a pendingDraw outside a turn (a new power, a refactor of snap penalties) silently breaks turn integrity.
**Fix (small)**: Add one comment at each handler's pendingDraw check: `// turn-gated implicitly: only the turn player can hold a pendingDraw`. Optionally add the explicit turn check to the two golf handlers (cheap, no behavior change in legal play).

## 8. Client matches a server error string verbatim — MEDIUM — **FIXED**

> **Status: fixed.** Wrong-snap ack now carries `code: 'WRONG_SNAP'`; the client matches the code, not the string. The human-readable message is free to change.

**What**: Wrong-snap is signaled as `ack({ ok: false, error: 'Wrong rank — 2 penalty cards drawn' })` and the client suppresses its error toast by comparing that exact string.
**Where**: `index.ts` `cabo:snap`; `App.tsx` `handleSnapSlot`.
**Why**: Reword the message on either side and wrong-snaps start toasting an "error" (or worse, a real error gets swallowed).
**Fix (small)**: Server: add a machine field `ack({ ok: false, code: 'WRONG_SNAP', error: … })`. Client: match `r.code === 'WRONG_SNAP'`. Two lines.

## 9. CORS defaults to `*` and render.yaml pins it there — MEDIUM (security, low sensitivity)

**What**: `ALLOWED_ORIGIN` defaults to `*`; `render.yaml` explicitly sets `"*"` (deliberately, for first smoke test). Nothing sensitive is exposed (no cookies, no credentials), but any site can open sockets to the server and burn rate-limit budget / create games.
**Where**: `index.ts` (`ALLOWED_ORIGIN`), `render.yaml` env block, README's "Tighten CORS" step.
**Why**: Griefing surface once deployed and shared.
**Fix (small)**: After the client URL exists, set `ALLOWED_ORIGIN` on the host (Render dashboard env var or `fly secrets set`). Update `render.yaml`'s comment to point at the real URL. Config-only change.

## 10. `App.tsx` is a 1,700-line monolith; `index.ts` an 1,830-line one — MEDIUM (debt, not urgent)

**What**: All client components, both game tables, modals, toasts, and socket plumbing in one file; all server modes in another.
**Where**: `CARDS/client/src/ui/App.tsx`, `CARDS/server/src/index.ts`.
**Why**: Every change forces reading/searching a huge file; merge conflicts guaranteed with parallel work. But both files are internally well-sectioned with `// ----` banners, and one-file-per-side is a stated design choice (PROJECT.md).
**Fix (small, only when friction is real)**: First split = extract `CaboTable`+`CaboSlotView` to `ui/CaboTable.tsx` and `GolfTable`+`SlotView` to `ui/GolfTable.tsx` (they're already prop-isolated). Server: extract pure helpers (scoring, dealing, sanitizing) to `logic.ts`; leave socket handlers in place. Do not do this speculatively.

## 11. Draw-pile exhaustion edge cases — LOW — **FIXED (client UX)**

> **Status: fixed.** Deck chip now reads "deck empty — reshuffles discard" (or "no cards left") at 0; both Draw buttons disable only in the truly-dead case (`extraDeckCount === 0 && !discardTop`). Server penalty-skip behavior unchanged (harmless).

**What**: (a) `reshuffleDrawPile` no-ops when the discard has ≤1 card, so with both piles empty `golf:draw`/`cabo:draw` ack `'No cards left'` — the player must know to swap-with-discard instead; nothing in the UI explains this. (b) Wrong-snap penalty draws (`cabo:snap`) silently skip penalty cards when the deck+discard are exhausted. (c) `.scratch/finish-implementation.md` already tracks "empty draw pile visual" as an open item.
**Where**: `index.ts` `reshuffleDrawPile`, `golf:draw`, `cabo:draw`, `cabo:snap` penalty loop.
**Why**: Near-impossible with correct deck sizing (`decksNeeded` guarantees 12-card headroom), reachable in long Cabo rounds with many snaps.
**Fix (small)**: In the client, when `extraDeckCount === 0`, disable the Draw button and show "deck empty — take the discard". Server behavior is fine.

## 12. Kick exists only for Golf — LOW (inconsistency) — **FIXED**

> **Status: fixed.** `cabo:kickPlayer` added (same host/grace checks): returns any pending draw to the discard, removes the hand (unscored) and the turn-order slot so play never stalls, decrements the final-turns countdown if it was their turn during cabo-called, auto-acks all phases. Client shows the same countdown + Kick button as Golf. Verified live: grace enforced, hand removed, turn passes, game unstalled. Kick also fixes a latent stall: normal-phase cabo turn advance never skipped disconnected players.

**What**: `golf:kickPlayer` lets the host remove a >30s-disconnected player; Cabo has no equivalent. A Cabo game with a permanently-gone player limps along on auto-ack/auto-skip but their hand still scores each round.
**Where**: `index.ts` `golf:kickPlayer`; nothing under Cabo actions.
**Why**: Asymmetric UX; hosts will look for the kick button in Cabo and not find it.
**Fix (small)**: Clone the handler as `cabo:kickPlayer`: same grace-period checks; on kick, delete the player's `caboHands` entry and their turn-order slot, auto-ack them everywhere, `caboEndTurn` if it was their turn. Wire the same host-side button in `CaboTable`.

## 13. `golf:leaveGame` and `cabo:leaveGame` are copy-paste identical — LOW — **FIXED**

> **Status: fixed.** One `handleLeaveGame` function; both event names alias it (wire compat with deployed clients).

**What**: Two verbatim handlers (lobby/rematch-only leave, host transfer, empty-game cleanup); the client picks by mode.
**Where**: `index.ts` both handlers; `App.tsx` `leaveGame()`.
**Why**: Divergence risk when one gets edited.
**Fix (small)**: Register one `leaveGame` handler; keep the two old event names as aliases pointing at the same function (back-compat with deployed clients). ~10-line diff.

## 14. Dead config fields and dead files — LOW — **FIXED**

> **Status: fixed.** Deleted `CARDS/GOLF-RULES`, stray `CARDS/package.json` + `CARDS/package-lock.json` (server tests use `CARDS/server`'s own socket.io-client — verified). Vestigial config fields stay for wire compat, annotated in `shared-types.ts`.

**What**:
- `GameConfig.totalCardsPerDeck` is never read; `numberOfDecks` is client-supplied but always overwritten by `decksNeeded()` at deal time (kept as a mutated field, which is confusing).
- `CARDS/GOLF-RULES` (no extension) is a stale plain-text duplicate of `GOLF_RULES.md`.
- `CARDS/package.json` is a stray file whose only content is a `socket.io-client` devDependency (plus an orphaned `CARDS/package-lock.json`), apparently left over from testing; nothing in `CARDS/` root is a package.
**Where**: as listed.
**Why**: Each one makes a newcomer ask "is this used?"
**Fix (small)**: Delete `CARDS/GOLF-RULES`, delete `CARDS/package.json` + `CARDS/package-lock.json` (verify nothing imports from `CARDS/node_modules` first — the e2e scripts use `CARDS/server`'s own devDependency). Leave the config fields (wire-format compat) but add `// vestigial, ignored` comments.

## 15. Issue tracker doesn't follow its own convention — LOW — **FIXED**

> **Status: fixed.** `finish-implementation.md` now carries a header note: predates the convention, left as-is, new work follows `docs/agents/issue-tracker.md`.

**What**: `docs/agents/issue-tracker.md` prescribes `.scratch/<feature-slug>/PRD.md` + `issues/NN-slug.md` with `Status:` lines. The only real file is a flat `.scratch/finish-implementation.md` checklist that predates the convention. Also `CLAUDE.md` references `CONTEXT.md` and `docs/adr/`, which don't exist (by design — created lazily by `/grill-with-docs` — but nothing says so where a newcomer will look).
**Where**: `.scratch/`, `CLAUDE.md`, `docs/agents/domain.md`.
**Why**: Agents following the docs will search for structure that isn't there.
**Fix (small)**: Either migrate `finish-implementation.md` into the prescribed layout, or add one line to it: "predates the tracker convention; leave as-is." (The missing CONTEXT.md is already explained in `docs/agents/domain.md` — "proceed silently".)

## 16. Local settings tracked in git; worktrees dir untracked noise — LOW (repo hygiene) — **FIXED**

> **Status: fixed.** `.claude/settings.local.json` untracked (`git rm --cached`) and both it and `.claude/worktrees/` added to `.gitignore`. `.claude/launch.json` stays tracked (shared preview config).

**What**: `.claude/settings.local.json` is tracked and shows as perpetually modified; `.claude/worktrees/` shows as untracked.
**Where**: `.gitignore` (missing entries), `.claude/`.
**Why**: Permanent git-status noise; local permission settings don't belong in history.
**Fix (small)**: Add `.claude/settings.local.json` and `.claude/worktrees/` to `.gitignore`; `git rm --cached .claude/settings.local.json`.

## 17. Minor client nits — LOW

**What**:
- `CountUp` (App.tsx) calls `setVal(target)` in its effect **cleanup** — a stray setState-on-unmount pattern; harmless with React 18 but sloppy.
- Shuffles use `Math.random()` (fine for casual play; not fair-shuffle grade — don't advertise fairness).
- If `TEST_HOOKS=1` were ever set on a production host, `__test:stackDeck` becomes a public cheat endpoint. It's off by default everywhere; just never add it to a deploy config.
- Host can't change cards-per-player in the lobby — only at create time and between rematches (`golf:updateConfig` is rematch-pending-only).
**Where**: as listed.
**Fix**: Each is a one-liner if it ever matters; none block anything today.

---

## Test coverage map

| Area | Covered by | Gaps |
| --- | --- | --- |
| Deck sizing (all modes, up to 8×13) | test-dealing.ts, test-dealing-golf.ts | — |
| Input sanitizing + rate limits | test-validation.ts | rejoinGame not rate-limited (token space makes brute force infeasible; fine) |
| Abandoned-game reaper | test-reaper.ts | — |
| Classic happy path | e2e.ts | everything else about classic (see #1) |
| Golf full flow | e2e-golf.ts | kick flow, reconnect mid-round, multi-deck combo scoring (5+ of a kind) |
| Cabo standard flow + scoring + wrong snap | e2e-cabo.ts | — |
| Cabo specials (all 4 powers) + correct snap | test-cabo-specials.ts (needs TEST_HOOKS=1) | snap-slide accept path, black-king pass path (decide swap:false), discard-pile reshuffle mid-round |
| **Untested critical paths** | | `rejoinGame` (reconnect), disconnect auto-ack/auto-skip, `golf:kickPlayer`, host transfer on leave, snapshot privacy (nothing asserts opponents' cards are absent) |

Highest-value new test: a **snapshot-privacy test** — join two players, start golf and cabo games, assert the second player's `game:update` never contains the first player's unrevealed cards. It guards the single worst possible regression class and is ~40 lines in the existing script style.
