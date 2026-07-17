# CLAUDE.md

Real-time multiplayer card game (Golf / Cabo / Classic). Socket.IO TypeScript server + React/Vite client, no database, state in memory.

- **Architecture, data flow, design decisions** → [PROJECT.md](PROJECT.md)
- **Known weaknesses, ranked, with scoped fixes** → [GAPS.md](GAPS.md)
- **Golf rules (matches server scoring exactly)** → [CARDS/GOLF_RULES.md](CARDS/GOLF_RULES.md)

## Commands

All from the listed directory. Windows dev box; scripts assume Git Bash for `&&`.

```sh
# server (CARDS/server/)
npm run dev            # ts-node watch on :3001
npm run build          # npm install + tsc → dist/   (yes, install is part of build — deploy hosts run it)
npm start              # node dist/index.js

# client (CARDS/client/)
npm run dev            # vite on :5173
npm run build          # tsc -b && vite build → dist/

# tests (CARDS/server/) — ALL need a server already running on :3001 (or SERVER_URL=...)
# Start it with the full test env so every suite passes:
#   TEST_HOOKS=1 GAME_TTL_MS=1500 REAP_INTERVAL_MS=700 npm run dev
npm run test:dealing && npm run test:dealing:golf
npm run test:reaper && npm run test:validation    # reaper needs the short-TTL envs
npm run e2e && npm run e2e:golf && npm run e2e:cabo
npm run e2e:cabo:specials   # needs TEST_HOOKS=1 on the server or this times out
```

CI: `.github/workflows/test.yml` runs all suites + both builds on every push/PR.

No lint config. No test framework — tests are plain scripts that `process.exit(0|1)`.

Deploy: server → Fly (`CARDS/server/fly.toml`, walkthrough in `CARDS/README.md`) or Render (`render.yaml` at root, no card needed); client → Vercel with env `VITE_SERVER_URL=<server url>` (baked at build — redeploy after changing it).

## The two files that matter

- `CARDS/server/src/index.ts` — entire server: types, state Maps, rules, scoring, every socket handler. Sectioned with `// ----` banners.
- `CARDS/client/src/ui/App.tsx` — entire client: theme tokens, components, both game tables, socket plumbing.

Keep it that way. Don't split files or add dependencies without being asked.

## Conventions

- **Socket protocol**: client `emit(event, payload, ack)`; server acks `{ ok: true, ... }` or `{ error: string }`. Event names are `mode:action` (`golf:draw`, `cabo:snap`); shared ones are bare (`createGame`, `startGame`).
- **Every server mutation ends with `broadcastSnapshot(io, state)`**. Private data (own cards, pending draws) goes through `emitToPlayer(...)` per-player events (`golf:hand`, `cabo:hand`, `hand:update`) — never through the snapshot.
- **Handler shape**: get state → validate (game exists, mode, phase, turn) → mutate → private emits → `caboEndTurn`/`advanceTurn` if turn-consuming → broadcast → ack. Copy an adjacent handler when adding one.
- **Client state**: plain `useState` in `App.tsx`, socket listeners registered once in the mount `useEffect`. No state library — don't add one.
- **Styling**: inline styles from the `theme` token object ("midnight card room": felt-green `dark` ramp, gold `primary`, slate `secondary` reserved for Cabo powers, sage success, ember warning, clay error). Animations/focus rules live in the `globalStyles` string. Fraunces = display headings, DM Sans = UI (loaded in `index.html`). Use `notify(msg)` toasts for errors, never `window.alert`.
- **Commits**: conventional prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`), body explains why.

## Gotchas

- **Tests fail with connect timeouts, not messages, when the server isn't running.** Start the server first. `e2e:cabo:specials` needs the *server* started with `TEST_HOOKS=1`, not the test process.
- **New server test file? Add it to `CARDS/server/tsconfig.json` `exclude`** or the production build compiles it and can break.
- **`typescript` and `@types/*` are in server `dependencies` on purpose** (build runs on prod hosts). Don't move them to devDependencies.
- **Wire types live in `CARDS/server/src/shared-types.ts`**, imported type-only by both sides. New snapshot field = edit that one file (+ the snapshot builder). Keep the import type-only or the client bundles server code.
- **Wrong-snap is signaled by `code: 'WRONG_SNAP'`** in the cabo:snap ack; the client matches the code. Add `code` fields for any new expected-failure acks instead of string-matching.
- **Cabo follow-up actions are turn-gated implicitly**: place/discard/power handlers rely on "only the turn player can hold a caboPendingDraw" (commented in the handlers). Golf accept/reject check the turn explicitly (kick can advance past a pendingDraw holder). Don't create any other way to acquire a pendingDraw.
- **`currentTurnIndex` starts at 1**, not 0 — the second player acts first, per the rules. Not a bug.
- **`cardsPerPlayer` is mode-dependent**: golf ∈ {4,6,8}, cabo = always 4, classic 1–13.
- **`config.numberOfDecks` from the client is ignored** — recomputed by `decksNeeded()` at deal time. Preserve that invariant in any dealer change.
- **Cabo own cards are face-down during play (client-enforced).** The server still sends your full hand via `cabo:hand`; the client hides it except the transient 7/8 peek-own reveal. Don't "simplify" by rendering `privateCard` face-up — that undoes GAPS.md #2.
- **Classic mode is hidden from the create screen** (half-finished; GAPS.md #1). Server handlers remain for rejoin safety.

## Rules

- **Never expose cards through `publicGameSnapshot()`** beyond what it already reveals (golf: `revealed && locked && !peekOnly` only; cabo: slotIds only). That function is the privacy boundary.
- **Server is authoritative.** No game rules, scoring, or shuffling on the client, ever.
- **Never trust client input**: new payload fields go through the sanitize/clamp helpers (`sanitizeName`, `clampInt`, `sanitizeConfig` pattern).
- **Don't remove the `TEST_HOOKS` gate** and never set `TEST_HOOKS=1` in a deploy config — it enables a deck-stacking cheat endpoint.
- **Scoring functions (`calculateGolfScore`, `caboCardValue`, `finalizeCaboRound`) must match `CARDS/GOLF_RULES.md`**; run the e2e suites after touching them.
- **No database, no Redis, no state library, no CSS framework** — in-memory friends-scale is a stated design decision.
- **`dist/` is generated** (both packages) — never edit.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses default triage label strings (needs-triage, needs-info, ready-for-agent, ready-for-human, wontfix). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at root. See `docs/agents/domain.md`. (Neither exists yet — created lazily by `/grill-with-docs`; proceed silently if absent.)
