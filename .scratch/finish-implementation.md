# Plan: Finish GOLF implementation

## Bugs fixed (done)
- [x] Disconnect during between-rounds → advance → no snapshot rebroadcast (server stuck)
- [x] Round header showed "Round 0 Complete" instead of "Round 1 Complete"
- [x] Peek "Got it" button stayed enabled after clicking; now disables + shows "Waiting for others…"

---

## Remaining work (priority order)

### P1 — Broken / blocking gameplay

- [x] **Kick countdown in UI**
  GolfTable now runs a 1s tick when disconnected players exist. Shows "kick in Xs" while grace period runs, then Kick button appears.

- [x] **Rematch config visible to non-host**
  Non-host players now see a read-only card-count display (synced live from `game.config.cardsPerPlayer`) next to the host's editable selector.

- [ ] **Empty draw pile visual**
  When `game.extraDeckCount === 0`, the deck shows "0" but nothing signals a reshuffle happened. Add a brief indicator ("Reshuffling…") or just keep the count — low priority but avoids confusion.

### P2 — UX / polish

- [ ] **Slot selection requires face-down card**
  Currently `selectable={!!(isMe && isMyTurn && !s.locked)}`. A slot that was already locked (revealed+locked) from a previous action should not be selectable — this is correct. But a revealed-not-locked slot shouldn't exist in normal flow (every reveal also locks). Verify there's no edge case where a slot can be revealed but unlocked during play.

- [ ] **"Your card" value hint during swap decisions**
  When a player draws a card, they see the drawn card but not their own face-down cards. During `pendingDraw`, show a small tooltip or hint that they can select any face-down slot to swap. The current text "Click one of your face-down cards to select a slot" is there — verify it's visible and clear.

- [ ] **Score table: show current round column during play**
  The score table in `RoundScoreModal` shows completed rounds. Consider showing a live partial-round score summary (locked cards only) during the play phase, so players can strategize.

- [x] **Peek ready badge**
  Server now includes `peekAcks` in the golf snapshot block. Peek panel shows "X/N ready" live.

- [x] **Turn highlight**
  Active player's card grid now gets a glowing border (blue for self, grey for opponent). Transitions smoothly as turn changes.

### P3 — Robustness / edge cases

- [x] **Golf e2e test** (`src/e2e-golf.ts`, `npm run e2e:golf`)
  Covers: create+join, 4-card golf mode, peek privacy, ackPeek, full 8-turn round, between-rounds, round 2 start, pending-draw rejoin restore. All 9 assertions pass.

- [x] **Client reconnect: restore pending draw**
  Server emits `golf:pendingDraw` event on rejoin if `pendingDrawByPlayer` has a card for that player. Client handles `golf:pendingDraw` → `setPendingDraw`. Verified in e2e test.

- [ ] **Max players enforcement on rejoin**
  `rejoinGame` doesn't check `maxPlayers` — but it's the same player rejoining so that's correct. Verify new joins during `active` game are properly rejected (they are: `if (state.status !== 'waiting') return ack({ error: 'Game in progress' })`).

### P4 — Mobile / layout

- [x] **Responsive card grid**
  `useWindowWidth` hook drives `cardSize` ('sm' at <480px, 'md' wider). `SlotView` accepts `cardSize` and passes to `CardView`/`CardBack`. Card grids wrapped in `overflowX: 'auto'`. Outer padding shrinks on mobile. Background gradient changed to `position: fixed` so the outer container no longer needs `overflow: hidden` — page scrolls naturally on mobile.

- [x] **Scrollable table view**
  Player grid capped at `calc(100vh - 260px)` with `overflowY: auto` on desktop, natural scroll on mobile. Handles 6-8 players without layout overflow.

---

## Implementation order

1. Kick countdown (P1) — small, targeted
2. Rematch config display for non-host (P1) — small
3. Pending draw on rejoin (P3) — server + client, medium
4. Peek ready badge (P2) — client-only, small
5. Golf e2e test (P3) — test file, medium
6. Responsive layout (P4) — CSS, medium
7. Score hint during play (P2) — optional
