# PROJECT.md — GOLF card game

## What this is

A real-time multiplayer card game website for playing with friends. A host creates a game, gets a 4-digit code, shares it, up to 8 people join from their browsers, and they play. No accounts, no database, no persistence — sessions are held in server memory and identified by tokens in the browser's localStorage.

Three game modes:

- **Golf** — the flagship. Players get a grid of face-down cards (4/6/8), peek at their bottom row once, then take turns swapping/drawing to minimize their score. Full rules in [CARDS/GOLF_RULES.md](CARDS/GOLF_RULES.md), including the King bonuses (-5/-10/-20) and pair/three/four-of-a-kind combination scoring.
- **Cabo** — a memory game. 4 cards each, peek at bottom 2, draw/swap/snap, special powers on 7/8 (peek own), 9/10 (spy opponent), J/Q (blind swap), black K (see then optionally swap). Anyone can "call Cabo" to trigger final turns. Round scores accumulate; game ends when someone passes 100; lowest total wins. Caller pays +5 penalty unless they had the lowest hand.
- **Classic** — a bare "play cards to a center pile" sandbox. Half-finished (no turn order, no win condition); see GAPS.md.

Audience: friends-scale casual play. Every design decision follows from that — see "Design decisions" below.

## Tech stack

| Piece | What | Why (inferred) |
| --- | --- | --- |
| Node 18+ / TypeScript | Server language | Types across a 1,800-line state machine; ts-node for dev, tsc for prod build |
| Express 4 | HTTP shell | Only serves `/health`; exists mainly to host the Socket.IO server |
| Socket.IO 4 | All game traffic | Rooms per game, acknowledgment callbacks for request/response semantics, automatic reconnect on the client |
| nanoid | IDs | 4-digit join codes, 12-char player IDs, 32-char rejoin tokens |
| React 18 + Vite 5 | Client | Single-page app, fast dev server, static build for CDN hosting |
| Inline styles + injected `<style>` | Client styling | No CSS framework. A `theme` token object ("midnight card room" design system: felt green, ivory, brass gold) + one global stylesheet string for keyframes/focus rules |
| Fly.io / Render + Vercel | Deploy | Server needs a persistent process (in-memory state, websockets); client is static. Two backend configs exist: `CARDS/server/fly.toml` (documented in CARDS/README.md) and `render.yaml` at repo root (no-credit-card alternative; reads `rootDir: CARDS/server`) |

No database. No Redis. No test framework — tests are plain TS scripts that `process.exit(0|1)`.

## Repository layout

```
GOLF/
├── CLAUDE.md                  # agent operating instructions (read every session)
├── PROJECT.md                 # this file
├── GAPS.md                    # honest audit of known weaknesses
├── render.yaml                # Render deploy blueprint for the server
├── .scratch/                  # local markdown issue tracker (see docs/agents/issue-tracker.md)
├── docs/agents/               # conventions for AI agents (issue tracker, triage labels, domain docs)
└── CARDS/
    ├── README.md              # getting started + Fly/Vercel deploy walkthrough
    ├── GOLF_RULES.md          # canonical Golf rules (matches calculateGolfScore)
    ├── GOLF-RULES             # (dead duplicate of the above, no extension)
    ├── server/
    │   ├── fly.toml
    │   ├── package.json       # scripts: dev/build/start + all test/e2e scripts
    │   ├── tsconfig.json      # excludes every test/e2e file from the prod build
    │   └── src/
    │       ├── index.ts       # THE server. All types, state, rules, socket handlers (~1,830 lines)
    │       ├── e2e.ts / e2e-golf.ts / e2e-cabo.ts        # full-flow tests per mode
    │       ├── test-dealing.ts / test-dealing-golf.ts    # deck-sizing math
    │       ├── test-reaper.ts                            # abandoned-game TTL sweep
    │       ├── test-validation.ts                        # input sanitizing + rate limits
    │       └── test-cabo-specials.ts                     # deterministic special powers (needs TEST_HOOKS=1)
    └── client/
        ├── index.html         # fonts (Fraunces + DM Sans), theme-color, title
        └── src/
            ├── main.tsx       # ReactDOM bootstrap only
            └── ui/App.tsx     # THE client. All components, styles, socket logic (~1,700 lines)
```

Two load-bearing files: `CARDS/server/src/index.ts` and `CARDS/client/src/ui/App.tsx`. Everything else is config, docs, or tests.

## Architecture and data flow

```
Browser (React SPA, Vercel)                Server (Node, Fly/Render)
┌─────────────────────────┐               ┌──────────────────────────────┐
│ App.tsx                 │   socket.io   │ index.ts                     │
│  view: landing/create/  │◄─────────────►│  games:       Map<gameId>    │
│        join/lobby/table │               │  codeToGameId: Map<code>     │
│  localStorage:          │               │  tokenIndex:  Map<token>     │
│   golf_playerToken ─────┼── rejoinGame ─┼─► reattach player to socket  │
│                         │               │  globalLeaderboard: []       │
│ emit(event, payload, cb)│               │  reaper: setInterval sweep   │
└─────────────────────────┘               └──────────────────────────────┘
```

**Request/response**: every client action is `socket.emit(event, payload, ack)` — the server validates and replies via the ack callback (`{ ok: true, ... }` or `{ error: string }`). There are no REST endpoints besides `GET /health`.

**State fan-out**: after every mutation the server calls `broadcastSnapshot(io, state)`, which sends each player a personalized `game:update` built by `publicGameSnapshot()`. This snapshot is the privacy boundary:

- Golf: opponent cards appear only when `revealed && locked && !peekOnly`.
- Cabo: the public snapshot contains **only slotIds**, never cards. Your own cards arrive on a private per-socket `cabo:hand` event. Same for `golf:hand` and classic `hand:update`.

**Session persistence**: `createGame`/`joinGame` return `{ playerId, playerToken }`; the client stores them in localStorage. On socket connect, the client silently tries `rejoinGame { playerToken }` — this is how refresh/reconnect works. Tokens map through `tokenIndex` to (gameId, playerId), and the player record's `currentSocketId` is repointed. There is no other auth.

**Turn enforcement**: turn-gated events check `turnOrder[currentTurnIndex] === currentPlayerId`. Follow-up actions (accept/reject a drawn card, use a special power) are instead guarded implicitly by the presence of a `pendingDraw` entry for that player — only the turn player could have drawn. It works, but it's a convention you must preserve (see GAPS.md #7).

**Lifecycle sync**: phases that need everyone's confirmation (peek done, next round, rematch) use ack-sets (`peekAckByPlayer`, `betweenRoundAckByPlayer`, `rematchAckByPlayer`). Disconnected players are auto-acked (`autoAckDisconnected`) so one closed tab never blocks the room. The disconnect handler also auto-acks and, in Cabo's final-turns phase, skips the disconnected player's turn.

**Cleanup**: `reapStaleGames()` runs every 5 min (`unref()`'d interval) and deletes games where every player has been disconnected for over an hour (`GAME_TTL_MS`), freeing all three maps. `leaveGame` (lobby/rematch only) deletes eagerly and transfers host.

## Key design decisions

1. **In-memory everything, deliberately.** README: "State is in-memory; a machine restart drops all active games. Acceptable for friends-scale." Don't add a database without being asked.
2. **Server is authoritative; client is a dumb renderer.** All rules, scoring, and shuffling are server-side. The client never computes game outcomes. Keep it that way.
3. **The server trusts nothing.** `sanitizeConfig` rebuilds the game config from a whitelist (client's `numberOfDecks`/`totalCardsPerDeck` are ignored; deck count is recomputed from table size by `decksNeeded()` at deal time). `sanitizeName` strips control chars and caps at 24. `createGame`/`joinGame` are rate-limited per socket (5/10s and 30/10s sliding windows) to stop code brute-forcing.
4. **Deterministic testing via env-gated deck injection.** `TEST_HOOKS=1` enables a `__test:stackDeck` socket event that queues an exact unshuffled deck for the next deal. This is how card-dependent paths (Cabo special powers, snaps) are tested. The gate means the hook does not exist on a normal server.
5. **Per-mode namespacing inside one GameState.** Golf fields (`golfHands`, `turnOrder`…) and Cabo fields (`caboHands`, `caboTurnOrder`…) coexist as optionals on one struct rather than separate state machines. Verbose but flat and greppable.
6. **One file per side.** No premature modularization. If you split these files, do it because a real need arrived, not for aesthetics.

## Critical paths (touch with care)

- **`publicGameSnapshot()`** — the privacy boundary. A careless change here leaks opponents' cards to every client. Any new per-player secret must go through a private `emitToPlayer` event, never the snapshot.
- **`decksNeeded()` + the three dealers** (`dealCards`, `dealGolfRound`, `dealCaboRound`) — deck sizing was the project's worst historical bug (large tables dealt `undefined` cards). All three set `state.config.numberOfDecks = decksNeeded(...)` before `dealDeck(state)`. Keep that invariant.
- **`calculateGolfScore` / `caboCardValue` / `finalizeCaboRound`** — scoring. Golf combos: pairs/triples score 0, 4-of-a-kind is −20, Kings are 0/−5/−10/−20 by count. Cabo: A=0, red K=−1, black K=10, lowest hand scores 0 for the round, caller +5 unless lowest. Tests assert these; run them after any change.
- **`caboEndTurn` + `cabo:callCabo`** — final-turns countdown with disconnected-player skipping. The trickiest control flow in the file; both duplicate a "skip disconnected, maybe finalize" loop.
- **Reconnect flow** (`rejoinGame`, disconnect handler, `tokenIndex`) — breaks are invisible in happy-path testing but destroy real games on phone lock/tab switch.
- **Safe to change casually**: all client styling (the `theme` object and inline styles), copy text, the score modal layouts, GOLF_RULES.md wording, test scripts.

## Things that will trip you up

1. **Tests need a running server.** Every `test-*`/`e2e*` script connects to `http://localhost:3001` (override with `SERVER_URL`). Start `npm run dev` in `CARDS/server` first. `test-cabo-specials.ts` additionally needs the **server** started with `TEST_HOOKS=1`.
2. **Server `package.json` puts TypeScript and `@types/*` in `dependencies`, not devDependencies** — because `npm run build` is `npm install && tsc` and deploy hosts (Fly/Render) run it in production mode. Don't "fix" this.
3. **New server test files must be added to `tsconfig.json` `exclude`**, or `tsc` will compile them into `dist/` and the production build may break on the socket.io-client devDependency.
4. **The client special-cases an exact error string**: `cabo:snap`'s wrong-snap ack error `'Wrong rank — 2 penalty cards drawn'` is matched verbatim in App.tsx to suppress the alert-toast. Change one side and you change behavior.
5. **`cardsPerPlayer` means different things per mode**: golf allows only {4,6,8} (enforced in three places), cabo forces 4, classic clamps 1–13.
6. **Client types are hand-copied from the server** (`CardT`, `GameSnapshot` in App.tsx vs `Card`, `GameState` in index.ts). There is no shared package. If you add a snapshot field, update both.
7. **Turn index starts at 1** (`currentTurnIndex = 1 % numPlayers`): the second player to join acts first (rules: "player to the right of the dealer"). Not a bug.
8. **Windows dev machine**: line endings are LF-in-repo/CRLF-on-checkout (expect git warnings), and shell scripts in docs assume Git Bash.
9. **Own-hand visibility in Cabo is intentionally weird**: the server always sends your full hand face-up via `cabo:hand`, so the client shows all 4 of your cards all round — real Cabo hides them after the peek. Known divergence, see GAPS.md #2 before "fixing".
