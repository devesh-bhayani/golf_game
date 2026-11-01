import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import type { Socket } from 'socket.io';
import { customAlphabet } from 'nanoid';

// Wire types live in shared-types.ts (single source of truth with the client).
// Type-only import: erased at compile time, so dist/ has no runtime dependency.
import type { Suit, Rank, Card, GameMode, GamePhase, GameConfig, GameSnapshot, PrivateGameState, LastAction, TpOptions, TpResult, TpShownHand, TpSnapshot } from './shared-types';
// Runtime import of a local module: the explicit .js extension is required by
// Node's ESM loader in production (dist/), and resolves to the .ts in dev/tests.
import { compareTp, tpBetAmount, tpNextStake, tpShowCost, tpStakeInfo, tpHandName, tpStrength } from './teenpatti.js';

type Player = {
  playerId: string;
  playerToken: string;
  currentSocketId: string;
  displayName: string;
  connected: boolean;
  disconnectedAt?: number;
  isBot?: boolean; // seat driven by a server-side BotSocket (see "bots" below)
};

type GolfSlot = {
  slotId: string;
  card: Card;
  revealed: boolean;
  locked: boolean;
  peekOnly?: boolean;
};

type CaboSlot = {
  slotId: string;
  card: Card;
};

type GameState = {
  gameId: string;
  code: string;
  hostId: string;
  status: 'waiting' | 'active' | 'ended';
  phase: GamePhase;
  config: GameConfig;
  players: Map<string, Player>;
  hands: Map<string, Card[]>;
  centerPile: Card[];
  extraDeck: Card[];
  // golf
  discardPile?: Card[];
  golfHands?: Map<string, GolfSlot[]>;
  turnOrder?: string[];
  currentTurnIndex?: number;
  matchNumber?: number;
  notice?: string;
  currentRound: number;
  targetRounds: number;
  roundScores: Map<string, number[]>;
  scores?: Map<string, number>;
  leaderboard?: Array<{ playerId: string; displayName: string; score: number; rank: number }>;
  peekAckByPlayer?: Set<string>;
  peekPhaseActive?: boolean;
  betweenRoundAckByPlayer: Set<string>;
  rematchAckByPlayer: Set<string>;
  pendingDrawByPlayer: Map<string, Card>;
  // cabo
  caboHands?: Map<string, CaboSlot[]>;
  caboTurnOrder?: string[];
  caboCurrentTurnIndex?: number;
  caboPeekAckByPlayer?: Set<string>;
  caboPeekPhaseActive?: boolean;
  caboCallerId?: string;
  caboFinalTurnsLeft?: number;
  caboFinalQueue?: string[];
  caboRoundScores?: Map<string, number[]>;
  caboCumulativeScores?: Map<string, number>;
  caboPendingDraw?: Map<string, Card>;
  caboBlackKingPending?: Map<string, { targetPlayerId: string; targetSlotId: string }>;
  caboSnapGapPending?: Map<string, string>; // snapperId -> opponentId
  caboLeaderboard?: Array<{ playerId: string; displayName: string; score: number; rank: number }>;
  // public move log (latest only)
  lastAction?: LastAction;
  actionSeq?: number;
  // teen patti (play coins; see the Teen Patti section)
  tpCoins?: Map<string, number>;
  tpRefills?: Map<string, number>;
  tpGranted?: Map<string, number>;    // coins handed out to the seat: starting stack + refill top-ups
  tpStartCoins?: Map<string, number>; // coins when the hand began (for per-hand deltas)
  tpCards?: Map<string, Card[]>;
  tpInHand?: string[];                // dealt players in seat order; departed players stay as packed
  tpSeen?: Set<string>;
  tpPacked?: Set<string>;
  tpBets?: Map<string, number>;       // coins put in this hand
  tpBlindTurns?: Map<string, number>;
  tpPot?: number;
  tpStake?: number;
  tpDealerId?: string | null;
  tpTurn?: string | null;
  tpSideShow?: { from: string; to: string } | null;
  tpKnown?: Map<string, TpShownHand[]>; // hands each player saw in an accepted side show
  tpResult?: TpResult | null;
  tpHandNumber?: number;
  tpLeaderboard?: TpSnapshot['leaderboard'];
};

const nano4 = customAlphabet('0123456789', 4);
const nanoToken = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 32);
const nanoPlayerId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

const codeToGameId = new Map<string, string>();
const games = new Map<string, GameState>();
const tokenIndex = new Map<string, { gameId: string; playerId: string }>();
const globalLeaderboard: Array<{ playerId: string; displayName: string; totalScore: number; gamesPlayed: number }> = [];

// ---------- abandoned-game reaper ----------
// State lives only in memory, so games where everyone has disconnected (closed
// the tab) would otherwise leak forever. Sweep them periodically once every
// player has been gone longer than GAME_TTL_MS.
const GAME_TTL_MS = Number(process.env.GAME_TTL_MS) || 1000 * 60 * 60; // 1h
const REAP_INTERVAL_MS = Number(process.env.REAP_INTERVAL_MS) || 1000 * 60 * 5; // 5m

function removeGame(state: GameState): void {
  codeToGameId.delete(state.code);
  games.delete(state.gameId);
  for (const p of state.players.values()) {
    tokenIndex.delete(p.playerToken);
    if (p.isBot) disposeBot(p.currentSocketId);
  }
}

// Bots never disconnect, so every "is anyone still here?" question is asked
// about humans only — otherwise a room of bots would live (and play) forever.
function humanPlayers(state: GameState): Player[] {
  return Array.from(state.players.values()).filter((p) => !p.isBot);
}

// Returns the number of games removed. Pure w.r.t. `now` so it can be tested
// without waiting on wall-clock time.
function reapStaleGames(now: number = Date.now()): number {
  let removed = 0;
  for (const state of Array.from(games.values())) {
    const players = humanPlayers(state);
    const allGone = players.length === 0 || players.every((p) => !p.connected);
    if (!allGone) continue;
    // Most recent moment any player was still connected.
    const lastSeen = players.reduce((max, p) => Math.max(max, p.disconnectedAt ?? 0), 0);
    if (now - lastSeen >= GAME_TTL_MS) {
      removeGame(state);
      removed++;
    }
  }
  return removed;
}

// ---------- input validation ----------
// The server trusts nothing from clients. Names are bounded/stripped and the
// game config is rebuilt from a whitelist so a hostile payload can't, e.g.,
// drive a huge cardsPerPlayer into the deck allocator.
const MAX_NAME_LEN = 24;
const VALID_MODES: GameMode[] = ['classic', 'golf', 'cabo', 'teenpatti'];

function sanitizeName(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  let cleaned = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue; // skip ASCII control chars
    cleaned += ch;
  }
  cleaned = cleaned.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LEN);
  return cleaned.length > 0 ? cleaned : fallback;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeConfig(raw: any): GameConfig {
  const gameMode: GameMode = VALID_MODES.includes(raw?.gameMode) ? raw.gameMode : 'classic';
  let cardsPerPlayer: number;
  if (gameMode === 'cabo') {
    cardsPerPlayer = 4; // fixed by the rules
  } else if (gameMode === 'teenpatti') {
    cardsPerPlayer = 3; // fixed by the rules
  } else if (gameMode === 'golf') {
    cardsPerPlayer = [4, 6, 8].includes(raw?.cardsPerPlayer) ? raw.cardsPerPlayer : 4;
  } else {
    cardsPerPlayer = clampInt(raw?.cardsPerPlayer, 1, 13, 5);
  }
  const config: GameConfig = {
    maxPlayers: clampInt(raw?.maxPlayers, 2, 8, 8),
    totalCardsPerDeck: 52,
    numberOfDecks: 1, // recomputed from table size at deal time
    cardsPerPlayer,
    gameMode,
  };
  if (gameMode === 'teenpatti') {
    config.tpStakes = ['low', 'medium', 'high'].includes(raw?.tpStakes) ? raw.tpStakes : 'medium';
    config.tpHands = [0, 10, 20].includes(raw?.tpHands) ? raw.tpHands : 10;
    config.tpSideShow = raw?.tpSideShow !== false;
    config.tpBlindLimit = [0, 3, 4].includes(raw?.tpBlindLimit) ? raw.tpBlindLimit : 0;
  }
  return config;
}

// ---------- rate limiting ----------
// Per-socket sliding window on the abuse-prone connection events (game
// creation spam, join-code brute forcing). State lives in the connection
// closure so it is freed when the socket disconnects.
const RATE_LIMITS: Record<string, { windowMs: number; max: number }> = {
  createGame: { windowMs: 10_000, max: 5 },
  joinGame: { windowMs: 10_000, max: 30 },
};

// ---------- helpers ----------

function createStandardDeck(deckIndex: number, gameId: string): Card[] {
  const suits: Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];
  const ranks: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const cards: Card[] = [];
  for (const suit of suits) {
    const color = (suit === 'hearts' || suit === 'diamonds') ? 'red' : 'black';
    for (let i = 0; i < ranks.length; i++) {
      const rank = ranks[i];
      let value: number;
      if (rank === 'A') value = 1;
      else if (rank === 'J') value = 11;
      else if (rank === 'Q') value = 12;
      else if (rank === 'K') value = 13;
      else value = parseInt(rank);
      cards.push({
        cardId: `${gameId}:${deckIndex}:${suit}:${rank}:${Math.random().toString(36).slice(2, 6)}`,
        suit,
        rank,
        color,
        value,
      });
    }
  }
  return cards;
}

function createDecks(numberOfDecks: number, gameId: string): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < numberOfDecks; d++) cards.push(...createStandardDeck(d, gameId));
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

// ---------- test-only deterministic deck injection ----------
// Strictly gated behind TEST_HOOKS=1. When enabled, a test can pre-stack an
// exact, unshuffled deck so card-dependent paths (Cabo special powers, snaps)
// can be exercised deterministically. With the gate off, none of this code is
// reachable and dealing behaves exactly as before.
const TEST_HOOKS = process.env.TEST_HOOKS === '1' && process.env.NODE_ENV !== 'production';
const DISCONNECT_GRACE_MS = TEST_HOOKS ? Number(process.env.DISCONNECT_GRACE_MS) || 30_000 : 30_000;
const injectedDecks: Card[][] = [];

function buildCard(rank: Rank, suit: Suit, gameId: string, idx: number): Card {
  const color: 'red' | 'black' = suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black';
  let value: number;
  if (rank === 'A') value = 1;
  else if (rank === 'J') value = 11;
  else if (rank === 'Q') value = 12;
  else if (rank === 'K') value = 13;
  else value = parseInt(rank);
  return { cardId: `${gameId}:inj:${suit}:${rank}:${idx}`, suit, rank, color, value };
}

// Returns a pre-stacked deck if one is queued (test mode only), else null.
function takeInjectedDeck(): Card[] | null {
  if (!TEST_HOOKS) return null;
  return injectedDecks.shift() ?? null;
}

function dealDeck(state: GameState): Card[] {
  return takeInjectedDeck() ?? createDecks(state.config.numberOfDecks, state.gameId);
}

const CARDS_PER_DECK = 52;
// Extra cards beyond what's dealt, so there's a usable draw pile (+1 discard start)
// before any reshuffle is needed.
const DRAW_PILE_HEADROOM = 12;

// Compute how many standard decks are needed so every player can be dealt their
// cards AND a sensible draw/discard pile remains. The client's numberOfDecks is
// never trusted for this — table size drives it.
function decksNeeded(numPlayers: number, cardsPerPlayer: number): number {
  const cardsRequired = numPlayers * cardsPerPlayer + DRAW_PILE_HEADROOM;
  return Math.max(1, Math.ceil(cardsRequired / CARDS_PER_DECK));
}

function dealCards(state: GameState): void {
  const playerIds = Array.from(state.players.keys());
  const numPlayers = playerIds.length;
  const cardsPerPlayer = state.config.cardsPerPlayer;
  state.hands = new Map<string, Card[]>(playerIds.map((p) => [p, []]));
  state.config.numberOfDecks = decksNeeded(numPlayers, cardsPerPlayer);
  const fullDeck = dealDeck(state);
  for (let i = 0; i < cardsPerPlayer * numPlayers && i < fullDeck.length; i++) {
    const playerIndex = i % numPlayers;
    state.hands.get(playerIds[playerIndex])!.push(fullDeck[i]);
  }
  state.extraDeck = fullDeck.slice(cardsPerPlayer * numPlayers);
}

function dealGolfRound(state: GameState): void {
  const playerIds = Array.from(state.players.keys());
  const numPlayers = playerIds.length;
  const cardsPerPlayer = state.config.cardsPerPlayer;

  state.config.numberOfDecks = decksNeeded(numPlayers, cardsPerPlayer);
  const fullDeck = dealDeck(state);

  state.golfHands = new Map<string, GolfSlot[]>();
  state.turnOrder = playerIds;
  state.currentTurnIndex = 1 % numPlayers;
  state.peekAckByPlayer = new Set<string>();
  state.peekPhaseActive = true;
  state.phase = 'peek';
  state.pendingDrawByPlayer = new Map<string, Card>();
  state.lastAction = undefined;

  let dealIndex = 0;
  for (const pid of playerIds) {
    const slots: GolfSlot[] = [];
    for (let s = 0; s < cardsPerPlayer; s++) {
      const card = fullDeck[dealIndex++];
      slots.push({
        slotId: `${pid}:r${state.currentRound}:s${s}`,
        card,
        revealed: false,
        locked: false,
      });
    }
    state.golfHands.set(pid, slots);
  }

  state.extraDeck = fullDeck.slice(dealIndex);
  state.discardPile = [];
  const top = state.extraDeck.pop();
  if (top) state.discardPile.push(top);

  for (const pid of playerIds) {
    const slots = state.golfHands.get(pid)!;
    const perRow = cardsPerPlayer / 2;
    for (let i = perRow; i < cardsPerPlayer; i++) {
      slots[i].revealed = true;
      slots[i].peekOnly = true;
    }
  }
}

function startGolf(state: GameState): void {
  state.matchNumber = (state.matchNumber ?? 0) + 1;
  state.notice = undefined;
  state.currentRound = 1;
  state.targetRounds = state.config.cardsPerPlayer;
  state.roundScores = new Map(Array.from(state.players.keys()).map((pid) => [pid, []]));
  state.betweenRoundAckByPlayer = new Set();
  state.rematchAckByPlayer = new Set();
  dealGolfRound(state);
}

function reshuffleDrawPile(state: GameState): void {
  if (!state.discardPile || state.discardPile.length === 0) return;
  const top = state.discardPile.pop()!;
  const rest = state.discardPile;
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  state.extraDeck = rest;
  state.discardPile = [top];
}

function rankPointValue(rank: Rank): number {
  if (rank === 'A') return 1;
  if (rank === 'K') return 0;
  if (['10', 'J', 'Q'].includes(rank)) return 10;
  return parseInt(rank);
}

function golfScoreDetails(slots: GolfSlot[]): Array<{ label: string; points: number }> {
  const counts = new Map<Rank, number>();
  for (const { card } of slots) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  return Array.from(counts, ([rank, count]) => {
    const groups = Math.floor(count / 4);
    const rest = count % 4;
    const points = groups * -20 + (rank === 'K'
      ? [0, 0, -5, -10][rest]
      : rest === 1 ? rankPointValue(rank) : 0);
    return { label: `${count} × ${rank}${groups ? ' · four-card bonus' : count > 1 ? ' · matching ranks' : ''}`, points };
  });
}

function calculateGolfScore(slots: GolfSlot[]): number {
  return golfScoreDetails(slots).reduce((sum, item) => sum + item.points, 0);
}

// ---------- Cabo helpers ----------

function caboCardValue(card: Card): number {
  if (card.rank === 'A') return 0;
  if (card.rank === 'K') return card.color === 'red' ? -1 : 10;
  if (['J', 'Q'].includes(card.rank)) return 10;
  return parseInt(card.rank);
}

function getCaboSpecialAction(card: Card): string | null {
  if (['7', '8'].includes(card.rank)) return 'peek-own';
  if (['9', '10'].includes(card.rank)) return 'spy';
  if (['J', 'Q'].includes(card.rank)) return 'blind-swap';
  if (card.rank === 'K' && card.color === 'black') return 'black-king-see';
  return null;
}

function dealCaboRound(state: GameState): void {
  const playerIds = Array.from(state.players.keys());
  const numPlayers = playerIds.length;
  const CARDS_PER_PLAYER = 4;

  state.config.numberOfDecks = decksNeeded(numPlayers, CARDS_PER_PLAYER);
  const fullDeck = dealDeck(state);

  state.caboHands = new Map<string, CaboSlot[]>();
  state.caboTurnOrder = playerIds;
  state.caboCurrentTurnIndex = 1 % numPlayers;
  state.caboPeekAckByPlayer = new Set<string>();
  state.caboPeekPhaseActive = true;
  state.phase = 'peek';
  state.caboPendingDraw = new Map<string, Card>();
  state.caboBlackKingPending = new Map();
  state.caboSnapGapPending = new Map();
  state.caboCallerId = undefined;
  state.caboFinalTurnsLeft = undefined;
  state.caboFinalQueue = undefined;
  state.lastAction = undefined;

  let dealIndex = 0;
  for (const pid of playerIds) {
    const slots: CaboSlot[] = [];
    for (let s = 0; s < CARDS_PER_PLAYER; s++) {
      const card = fullDeck[dealIndex++];
      slots.push({ slotId: `${pid}:r${state.currentRound}:s${s}`, card });
    }
    state.caboHands.set(pid, slots);
  }

  state.extraDeck = fullDeck.slice(dealIndex);
  state.discardPile = [];
  const top = state.extraDeck.pop();
  if (top) state.discardPile.push(top);
}

function startCabo(state: GameState): void {
  state.config.cardsPerPlayer = 4;
  state.matchNumber = (state.matchNumber ?? 0) + 1;
  state.notice = undefined;
  state.currentRound = 1;
  state.targetRounds = 0;
  state.caboRoundScores = new Map(Array.from(state.players.keys()).map((pid) => [pid, []]));
  state.caboCumulativeScores = new Map(Array.from(state.players.keys()).map((pid) => [pid, 0]));
  state.betweenRoundAckByPlayer = new Set();
  state.rematchAckByPlayer = new Set();
  dealCaboRound(state);
}

function calculateCaboHandScore(slots: CaboSlot[]): number {
  return slots.reduce((sum, s) => sum + caboCardValue(s.card), 0);
}

function caboEnsureDrawPile(state: GameState): void {
  if (state.extraDeck.length === 0) reshuffleDrawPile(state);
}

function advanceCaboFinal(io: Server, state: GameState): void {
  const queue = state.caboFinalQueue ?? [];
  state.caboFinalQueue = queue.filter(pid => state.players.has(pid));
  state.caboFinalTurnsLeft = state.caboFinalQueue.length;
  if (!state.caboFinalQueue.length) { finalizeCaboRound(io, state); return; }
  state.caboCurrentTurnIndex = state.caboTurnOrder!.indexOf(state.caboFinalQueue[0]);
}

function caboEndTurn(io: Server, state: GameState): void {
  if (!state.caboTurnOrder?.length) return;
  if (state.phase === 'cabo-called') {
    state.caboFinalQueue?.shift();
    advanceCaboFinal(io, state);
  } else {
    state.caboCurrentTurnIndex = ((state.caboCurrentTurnIndex ?? 0) + 1) % state.caboTurnOrder.length;
  }
}

function finalizeCaboRound(io: Server, state: GameState): void {
  if (!state.caboHands || !state.caboRoundScores || !state.caboCumulativeScores) return;

  state.caboPendingDraw?.clear();
  state.caboBlackKingPending?.clear();
  state.caboSnapGapPending?.clear();
  const rawScores = new Map<string, number>();
  for (const [pid, slots] of state.caboHands) {
    rawScores.set(pid, calculateCaboHandScore(slots));
  }

  const minScore = Math.min(...Array.from(rawScores.values()));
  const lowestPlayers = Array.from(rawScores.entries())
    .filter(([, s]) => s === minScore)
    .map(([pid]) => pid);

  const callerId = state.caboCallerId;

  for (const [pid, raw] of rawScores) {
    let roundScore: number;
    if (lowestPlayers.includes(pid)) {
      roundScore = 0;
    } else {
      roundScore = raw + (pid === callerId ? 5 : 0);
    }
    const arr = state.caboRoundScores.get(pid) ?? [];
    arr.push(roundScore);
    state.caboRoundScores.set(pid, arr);
    const prev = state.caboCumulativeScores.get(pid) ?? 0;
    state.caboCumulativeScores.set(pid, prev + roundScore);
  }

  const gameOver = Array.from(state.caboCumulativeScores.values()).some((s) => s > 100);

  if (gameOver) {
    finalizeCaboGame(state);
  } else {
    state.phase = 'between-rounds';
    state.betweenRoundAckByPlayer = new Set();
    autoAckDisconnected(state, state.betweenRoundAckByPlayer);
    maybeCaboAdvanceRound(io, state);
  }
}

function finalizeCaboGame(state: GameState): void {
  if (!state.caboCumulativeScores) return;
  state.status = 'ended';
  state.phase = 'rematch-pending';

  const gameResults = Array.from(state.caboCumulativeScores.entries())
    .map(([pid, score]) => ({
      playerId: pid,
      displayName: state.players.get(pid)?.displayName || 'Unknown',
      score,
    }))
    .sort((a, b) => a.score - b.score);

  state.caboLeaderboard = [];
  let prevScore: number | null = null;
  let prevRank = 0;
  gameResults.forEach((r, idx) => {
    let rank: number;
    if (prevScore !== null && r.score === prevScore) {
      rank = prevRank;
    } else {
      rank = idx + 1;
      prevRank = rank;
      prevScore = r.score;
    }
    state.caboLeaderboard!.push({ ...r, rank });
  });

  for (const r of gameResults) {
    const existing = globalLeaderboard.find((p) => p.playerId === r.playerId);
    if (existing) {
      existing.totalScore += r.score;
      existing.gamesPlayed += 1;
    } else {
      globalLeaderboard.push({ playerId: r.playerId, displayName: r.displayName, totalScore: r.score, gamesPlayed: 1 });
    }
  }
  globalLeaderboard.sort((a, b) => a.totalScore - b.totalScore);
  // Unbounded growth guard: entries are keyed by ephemeral playerIds, so this
  // is decorative session history, not durable data. Keep the best 100.
  if (globalLeaderboard.length > 100) globalLeaderboard.length = 100;

  state.rematchAckByPlayer = new Set();
  autoAckDisconnected(state, state.rematchAckByPlayer);
}

function maybeCaboAdvanceRound(io: Server, state: GameState): void {
  if (state.phase !== 'between-rounds') return;
  const required = Array.from(state.players.values()).filter((p) => p.connected).map((p) => p.playerId);
  if (required.length < 2) return;
  if (!required.every((pid) => state.betweenRoundAckByPlayer.has(pid))) return;

  // Winner of last round goes first
  let winnerIndex = 1 % (state.caboTurnOrder?.length ?? 1);
  if (state.caboRoundScores && state.caboTurnOrder) {
    const lastRoundIdx = state.currentRound - 1;
    let minScore = Infinity;
    let winnerId: string | undefined;
    for (const [pid, scores] of state.caboRoundScores) {
      const s = scores[lastRoundIdx];
      if (s !== undefined && s < minScore) { minScore = s; winnerId = pid; }
    }
    if (winnerId) {
      const idx = state.caboTurnOrder.indexOf(winnerId);
      if (idx !== -1) winnerIndex = idx;
    }
  }

  state.currentRound += 1;
  dealCaboRound(state);
  if (state.caboTurnOrder) {
    state.caboCurrentTurnIndex = winnerIndex % state.caboTurnOrder.length;
  }

  for (const pid of state.players.keys()) {
    emitToPlayer(io, state, pid, 'cabo:hand', state.caboHands!.get(pid) ?? []);
  }
}

function resetCaboForRematch(state: GameState): void {
  state.status = 'active';
  state.caboLeaderboard = undefined;
  state.matchNumber = (state.matchNumber ?? 0) + 1;
  state.notice = undefined;
  state.currentRound = 1;
  state.caboRoundScores = new Map(Array.from(state.players.keys()).map((pid) => [pid, []]));
  state.caboCumulativeScores = new Map(Array.from(state.players.keys()).map((pid) => [pid, 0]));
  state.betweenRoundAckByPlayer = new Set();
  state.rematchAckByPlayer = new Set();
  dealCaboRound(state);
}

// ---------- Teen Patti ----------
// Betting game with play coins. Pure rules (ranking, bet sizes, stakes) live
// in teenpatti.ts; this section owns the hand lifecycle on GameState.
// Invariant: sum of tpCoins + tpPot = coins issued (start stacks + refills),
// minus whatever departed players took with them.

function tpInfo(state: GameState) {
  return tpStakeInfo(state.config.tpStakes ?? 'medium');
}

function tpSeats(state: GameState): string[] {
  return Array.from(state.players.keys());
}

// Players still in the current hand, in seat order.
function tpActive(state: GameState): string[] {
  return (state.tpInHand ?? []).filter((pid) => !state.tpPacked?.has(pid));
}

// Next / previous player still in the hand, going around the dealt order.
function tpNextActive(state: GameState, fromPid: string): string | null {
  const order = state.tpInHand ?? [];
  const i = order.indexOf(fromPid);
  for (let k = 1; k <= order.length; k++) {
    const pid = order[(i + k + order.length) % order.length];
    if (!state.tpPacked?.has(pid)) return pid;
  }
  return null;
}

function tpPrevActive(state: GameState, fromPid: string): string | null {
  const order = state.tpInHand ?? [];
  const i = order.indexOf(fromPid);
  for (let k = 1; k < order.length; k++) {
    const pid = order[(i - k + order.length) % order.length];
    if (!state.tpPacked?.has(pid)) return pid;
  }
  return null;
}

function tpCoinsOf(state: GameState, pid: string): number {
  return state.tpCoins?.get(pid) ?? 0;
}

// Winnings so far: coins held minus every coin the room handed this seat.
function tpNet(state: GameState, pid: string): number {
  return tpCoinsOf(state, pid) - (state.tpGranted?.get(pid) ?? tpInfo(state).start);
}

function tpPay(state: GameState, pid: string, amount: number): void {
  state.tpCoins!.set(pid, tpCoinsOf(state, pid) - amount);
  state.tpBets!.set(pid, (state.tpBets!.get(pid) ?? 0) + amount);
  state.tpPot = (state.tpPot ?? 0) + amount;
}

function tpClear(state: GameState): void {
  state.tpCoins = undefined; state.tpRefills = undefined; state.tpGranted = undefined; state.tpStartCoins = undefined;
  state.tpCards = undefined; state.tpInHand = undefined; state.tpSeen = undefined; state.tpPacked = undefined;
  state.tpBets = undefined; state.tpBlindTurns = undefined; state.tpPot = undefined; state.tpStake = undefined;
  state.tpDealerId = undefined; state.tpTurn = undefined; state.tpSideShow = undefined; state.tpKnown = undefined;
  state.tpResult = undefined; state.tpHandNumber = undefined; state.tpLeaderboard = undefined;
}

function startTeenPatti(state: GameState): void {
  const { start } = tpInfo(state);
  state.status = 'active';
  state.matchNumber = (state.matchNumber ?? 0) + 1;
  state.notice = undefined;
  state.tpCoins = new Map(tpSeats(state).map((pid) => [pid, start]));
  state.tpRefills = new Map(tpSeats(state).map((pid) => [pid, 0]));
  state.tpGranted = new Map(tpSeats(state).map((pid) => [pid, start]));
  state.tpHandNumber = 0;
  state.tpDealerId = null;
  state.tpLeaderboard = undefined;
  state.targetRounds = state.config.tpHands ?? 0;
  state.betweenRoundAckByPlayer = new Set();
  state.rematchAckByPlayer = new Set();
  tpDealHand(state);
}

// Deals the next hand to every connected seat with at least the pot limit in
// coins (so nobody can run short mid-hand). Returns false if fewer than two
// players can be dealt in.
function tpDealHand(state: GameState): boolean {
  const { boot, potLimit } = tpInfo(state);
  const seats = tpSeats(state);
  const dealt = seats.filter((pid) => state.players.get(pid)?.connected && tpCoinsOf(state, pid) >= potLimit);
  if (dealt.length < 2) return false;

  // The dealer moves one seat clockwise (skipping anyone not dealt in).
  const prev = state.tpDealerId ? seats.indexOf(state.tpDealerId) : -1;
  let dealer = dealt[0];
  for (let k = 1; k <= seats.length; k++) {
    const pid = seats[(prev + k + seats.length) % seats.length];
    if (dealt.includes(pid)) { dealer = pid; break; }
  }
  state.tpDealerId = dealer;
  state.tpHandNumber = (state.tpHandNumber ?? 0) + 1;
  state.currentRound = state.tpHandNumber;

  state.config.numberOfDecks = decksNeeded(dealt.length, 3);
  const deck = dealDeck(state);
  state.tpCards = new Map();
  let next = 0;
  for (const pid of dealt) { state.tpCards.set(pid, deck.slice(next, next + 3)); next += 3; }
  state.extraDeck = deck.slice(next);

  state.tpInHand = dealt;
  state.tpSeen = new Set();
  state.tpPacked = new Set();
  state.tpBlindTurns = new Map();
  state.tpStartCoins = new Map(seats.map((pid) => [pid, tpCoinsOf(state, pid)]));
  state.tpBets = new Map();
  state.tpPot = 0;
  for (const pid of dealt) tpPay(state, pid, boot);
  state.tpStake = boot;
  state.tpSideShow = null;
  state.tpKnown = new Map();
  state.tpResult = null;
  state.tpTurn = tpNextActive(state, dealer);
  state.phase = 'play';
  state.status = 'active';
  state.notice = undefined;
  state.lastAction = undefined;
  return true;
}

// Everything this player may do right now, with exact costs. The client only
// renders these; it never works out a Teen Patti rule itself.
function tpOptionsFor(state: GameState, pid: string): TpOptions | null {
  if (state.config.gameMode !== 'teenpatti' || !state.tpCoins) return null;
  const { potLimit } = tpInfo(state);
  const playing = state.phase === 'play';
  const inHand = playing && !!state.tpInHand?.includes(pid) && !state.tpPacked?.has(pid);
  const options: TpOptions = {
    myTurn: false, canSee: false, mustSee: false, canPack: false, bets: [], show: null, sideShow: null,
    canRefill: tpCoinsOf(state, pid) < potLimit && !inHand && state.phase !== 'rematch-pending',
  };
  if (!inHand) return options;
  const seen = state.tpSeen!.has(pid);
  options.canSee = !seen;
  if (state.tpTurn !== pid || state.tpSideShow) return options;

  const stake = state.tpStake!;
  const room = potLimit - state.tpPot!; // a bet that reaches the pot limit is trimmed, then everyone shows
  const blindLimit = state.config.tpBlindLimit ?? 0;
  options.myTurn = true;
  options.canPack = true;
  options.mustSee = !seen && blindLimit > 0 && (state.tpBlindTurns!.get(pid) ?? 0) >= blindLimit;
  if (!options.mustSee) {
    const min = Math.min(tpBetAmount(seen, stake, false), room);
    const max = Math.min(tpBetAmount(seen, stake, true), room);
    options.bets.push({ double: false, amount: min, label: seen ? 'Chaal' : 'Blind' });
    if (max > min) options.bets.push({ double: true, amount: max, label: seen ? 'Raise' : 'Blind ×2' });
  }
  const active = tpActive(state);
  if (active.length === 2) {
    const other = active.find((p) => p !== pid)!;
    // A seen player may not force a show against a blind one.
    if (!seen || state.tpSeen!.has(other)) options.show = { cost: Math.min(tpShowCost(seen, stake), room) };
  }
  if (state.config.tpSideShow !== false && active.length >= 3 && seen && !options.mustSee) {
    const target = tpPrevActive(state, pid);
    const cost = tpBetAmount(true, stake, false);
    if (target && state.tpSeen!.has(target) && cost < room) options.sideShow = { cost, target };
  }
  return options;
}

function tpShown(state: GameState, pid: string): TpShownHand {
  const cards = state.tpCards!.get(pid)!;
  return { playerId: pid, cards, hand: tpHandName(cards) };
}

function tpFinishHand(state: GameState, how: TpResult['how'], show?: { winner: string; shown: string[] }): void {
  const active = tpActive(state);
  let winners: string[];
  let shownIds: string[] = [];
  if (how === 'show' && show) {
    winners = [show.winner];
    shownIds = show.shown;
  } else if (how === 'pot-limit') {
    // Everyone still in shows; the best hand wins, exact ties split the pot.
    shownIds = active;
    winners = [active[0]];
    for (const pid of active.slice(1)) {
      const c = compareTp(state.tpCards!.get(pid)!, state.tpCards!.get(winners[0])!);
      if (c > 0) winners = [pid]; else if (c === 0) winners.push(pid);
    }
  } else {
    winners = active.slice(0, 1);
  }

  // Equal shares; odd coins go to the first winners after the dealer.
  const order = state.tpInHand!;
  const after = order.indexOf(state.tpDealerId ?? '');
  winners.sort((a, b) => ((order.indexOf(a) - after + order.length) % order.length) - ((order.indexOf(b) - after + order.length) % order.length));
  const pot = state.tpPot!;
  const share = Math.floor(pot / winners.length);
  let odd = pot - share * winners.length;
  for (const w of winners) {
    state.tpCoins!.set(w, tpCoinsOf(state, w) + share + (odd > 0 ? 1 : 0));
    if (odd > 0) odd--;
  }

  const deltas: Record<string, number> = {};
  for (const pid of tpSeats(state)) deltas[pid] = tpCoinsOf(state, pid) - (state.tpStartCoins?.get(pid) ?? tpCoinsOf(state, pid));
  state.tpResult = { handNumber: state.tpHandNumber ?? 0, how, winners, pot, shown: shownIds.map((pid) => tpShown(state, pid)), deltas };
  state.tpPot = 0;
  state.tpTurn = null;
  state.tpSideShow = null;
  const names = winners.map((w) => nameOf(state, w)).join(' and ');
  const why = how === 'packed' ? 'everyone else packed' : how === 'show' ? `won the show with ${tpShown(state, winners[0]).hand.toLowerCase()}` : 'the pot limit was reached and every hand was shown';
  logAction(state, winners[0], 'tp:win', winners.length > 1 ? `and ${names.split(' and ').slice(1).join(' and ')} split ${pot} coins: ${why}` : `won ${pot} coins: ${why}`);

  const target = state.config.tpHands ?? 0;
  if (target > 0 && (state.tpHandNumber ?? 0) >= target) {
    tpFinalizeMatch(state);
  } else {
    state.phase = 'between-rounds';
    state.betweenRoundAckByPlayer = new Set();
    autoAckDisconnected(state, state.betweenRoundAckByPlayer);
  }
}

function tpFinalizeMatch(state: GameState): void {
  state.status = 'ended';
  state.phase = 'rematch-pending';
  const rows = tpSeats(state)
    .map((pid) => ({ playerId: pid, displayName: nameOf(state, pid), net: tpNet(state, pid), coins: tpCoinsOf(state, pid) }))
    .sort((a, b) => b.net - a.net);
  state.tpLeaderboard = rows.map((r, i) => ({ ...r, rank: rows.findIndex((x) => x.net === r.net) + 1 || i + 1 }));
  state.rematchAckByPlayer = new Set();
  autoAckDisconnected(state, state.rematchAckByPlayer);
}

// Between hands: deal the next one once every connected player is ready and
// at least two can be dealt in.
function maybeTpAdvance(state: GameState): void {
  if (state.phase !== 'between-rounds' || !state.tpCoins) return;
  const required = Array.from(state.players.values()).filter((p) => p.connected).map((p) => p.playerId);
  if (required.length < 2 || !required.every((pid) => state.betweenRoundAckByPlayer.has(pid))) return;
  if (!tpDealHand(state)) {
    state.notice = `Waiting for a refill: you need at least ${tpInfo(state).potLimit} coins to be dealt in.`;
  }
}

function tpResolveSideShow(state: GameState, accept: boolean): void {
  const { from, to } = state.tpSideShow!;
  state.tpSideShow = null;
  if (!accept) {
    logAction(state, to, 'tp:side-show-decline', `declined ${nameOf(state, from)}'s side show`);
    state.tpTurn = tpNextActive(state, from);
    return;
  }
  // Compared privately: only these two see each other's cards. Tie: the asker packs.
  const loser = compareTp(state.tpCards!.get(from)!, state.tpCards!.get(to)!) > 0 ? to : from;
  state.tpPacked!.add(loser);
  for (const [viewer, other] of [[from, to], [to, from]]) {
    state.tpKnown!.set(viewer, [...(state.tpKnown!.get(viewer) ?? []), tpShown(state, other)]);
  }
  logAction(state, to, 'tp:side-show-accept', `accepted ${nameOf(state, from)}'s side show, and ${nameOf(state, loser)} packed`);
  if (tpActive(state).length === 1) tpFinishHand(state, 'packed');
  else state.tpTurn = tpNextActive(state, from);
}

// A player leaving mid-hand forfeits what they bet; the hand carries on.
function tpOnLeave(state: GameState, pid: string): void {
  if (state.phase === 'play' && state.tpInHand?.includes(pid)) {
    const wasIn = !state.tpPacked!.has(pid);
    state.tpPacked!.add(pid);
    const pending = state.tpSideShow;
    if (pending && (pending.from === pid || pending.to === pid)) {
      state.tpSideShow = null;
      state.tpTurn = tpNextActive(state, pending.from);
    } else if (state.tpTurn === pid) {
      state.tpTurn = tpNextActive(state, pid);
    }
    if (wasIn && tpActive(state).length === 1) tpFinishHand(state, 'packed');
  }
  state.tpCoins?.delete(pid);
  state.tpRefills?.delete(pid);
  state.tpGranted?.delete(pid);
  state.tpStartCoins?.delete(pid);
}

function tpPublic(state: GameState): TpSnapshot {
  const { boot, potLimit, start } = tpInfo(state);
  const playing = state.phase === 'play';
  return {
    handNumber: state.tpHandNumber ?? 0,
    targetHands: state.config.tpHands ?? 0,
    boot, potLimit, start,
    pot: state.tpPot ?? 0,
    stake: state.tpStake ?? boot,
    dealerId: state.tpDealerId ?? null,
    turn: playing ? state.tpTurn ?? null : null,
    sideShowEnabled: state.config.tpSideShow !== false,
    blindLimit: state.config.tpBlindLimit ?? 0,
    seats: tpSeats(state).map((pid) => ({
      playerId: pid,
      coins: tpCoinsOf(state, pid),
      net: tpNet(state, pid),
      refills: state.tpRefills?.get(pid) ?? 0,
      inHand: !!state.tpInHand?.includes(pid),
      seen: !!state.tpSeen?.has(pid),
      packed: !!state.tpPacked?.has(pid),
      bet: state.tpBets?.get(pid) ?? 0,
    })),
    sideShow: state.tpSideShow ?? null,
    result: state.tpResult ?? null, // only hands that were shown to the table
    leaderboard: state.tpLeaderboard,
  };
}

// ---------- shared helpers ----------

function privatePlayerState(state: GameState, playerId: string) {
  const results = state.phase === 'between-rounds' || state.phase === 'rematch-pending';
  const golfSlots = (state.golfHands?.get(playerId) ?? []).map(slot => ({
    ...slot,
    card: (slot.locked || (state.phase === 'peek' && slot.peekOnly && !state.peekAckByPlayer?.has(playerId))) ? slot.card : null,
  }));
  const caboSlots = (state.caboHands?.get(playerId) ?? []).map((slot, i) => ({
    slotId: slot.slotId,
    card: (results || (state.phase === 'peek' && i >= 2 && !state.caboPeekAckByPlayer?.has(playerId))) ? slot.card : null,
  }));
  const king = state.caboBlackKingPending?.get(playerId);
  const target = king && state.caboHands?.get(king.targetPlayerId)?.find(slot => slot.slotId === king.targetSlotId);
  return {
    gameId: state.gameId, matchNumber: state.matchNumber ?? 0, round: state.currentRound,
    golfSlots, caboSlots,
    pendingDraw: state.pendingDrawByPlayer.get(playerId) ?? null,
    caboPendingDraw: state.caboPendingDraw?.get(playerId) ?? null,
    blackKing: king && target ? { targetPlayerId: king.targetPlayerId, slotId: target.slotId, card: target.card } : null,
    snapGap: state.caboSnapGapPending?.has(playerId) ? { opponentId: state.caboSnapGapPending.get(playerId)! } : null,
    scoreDetails: results && state.golfHands?.has(playerId) ? golfScoreDetails(state.golfHands.get(playerId)!) : [],
    // Raw Cabo hand value at round end (before the lowest-hand 0 / caller +5 adjustments).
    caboHandTotal: results && state.caboHands?.has(playerId) ? calculateCaboHandScore(state.caboHands.get(playerId)!) : null,
    // Teen Patti: a blind player's own cards are NOT sent until they press See,
    // so nobody can peek through the browser and still bet blind.
    tpCards: state.tpInHand?.includes(playerId) && (state.tpSeen?.has(playerId) || results) ? state.tpCards?.get(playerId) ?? null : null,
    tpOptions: tpOptionsFor(state, playerId),
    tpKnown: state.tpKnown?.get(playerId) ?? [],
    tpSideShowAsk: state.tpSideShow?.to === playerId ? { from: state.tpSideShow.from } : null,
  };
}

function emitToPlayer(io: Server, state: GameState, playerId: string, event: string, payload: any) {
  const p = state.players.get(playerId);
  if (!p?.currentSocketId) return;
  if (event === 'golf:hand') payload = privatePlayerState(state, playerId).golfSlots;
  if (event === 'cabo:hand') payload = privatePlayerState(state, playerId).caboSlots;
  // Bots receive exactly what a browser in that seat would receive.
  const bot = botSockets.get(p.currentSocketId);
  if (bot) { bot.receive(event, payload); return; }
  io.to(p.currentSocketId).emit(event, payload);
}

// ---------- public move log ----------
// One line describing the latest move, shown on every screen ("Ada took the
// 3♠ from the discard"). Only name cards that are face up for everyone — the
// discard pile, locked Golf cards, snapped cards — never a hidden card.
const SUIT_SYMBOL: Record<Suit, string> = { spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣' };
function cardName(card: Card): string {
  return `${card.rank}${SUIT_SYMBOL[card.suit]}`;
}
// "a 9♥", "an 8♣", "an A♠"
function aCard(card: Card): string {
  return `${card.rank === 'A' || card.rank === '8' ? 'an' : 'a'} ${cardName(card)}`;
}
// "a 7", "an 8", "a Jack", "a Queen", "a King"
function aRank(rank: Rank): string {
  const word = ({ J: 'Jack', Q: 'Queen', K: 'King', A: 'Ace' } as Record<string, string>)[rank] ?? rank;
  return `${rank === 'A' || rank === '8' ? 'an' : 'a'} ${word}`;
}
function logAction(state: GameState, actorId: string, kind: string, text: string, slotIds: string[] = []): void {
  const name = state.players.get(actorId)?.displayName ?? 'A player';
  state.actionSeq = (state.actionSeq ?? 0) + 1;
  state.lastAction = { seq: state.actionSeq, actorId, kind, text: `${name} ${text}`, slotIds };
}
function nameOf(state: GameState, playerId: string): string {
  return state.players.get(playerId)?.displayName ?? 'another player';
}

function broadcastSnapshot(io: Server, state: GameState) {
  for (const pid of state.players.keys()) {
    emitToPlayer(io, state, pid, 'game:update', publicGameSnapshot(state, pid));
    emitToPlayer(io, state, pid, 'game:private', privatePlayerState(state, pid));
  }
}

function settleReadiness(io: Server, state: GameState) {
  const connected = Array.from(state.players.values()).filter(p => p.connected);
  if (!connected.length) return;
  if (state.phase === 'peek') {
    const acks = state.config.gameMode === 'cabo' ? state.caboPeekAckByPlayer : state.peekAckByPlayer;
    if (connected.every(p => acks?.has(p.playerId))) {
      state.peekPhaseActive = false;
      state.caboPeekPhaseActive = false;
      for (const hand of state.golfHands?.values() ?? []) for (const slot of hand) {
        if (slot.peekOnly) { slot.peekOnly = false; slot.revealed = false; }
      }
      state.phase = 'play';
    }
  } else if (state.phase === 'between-rounds' && connected.length >= 2) {
    if (state.config.gameMode === 'cabo') maybeCaboAdvanceRound(io, state);
    else if (state.config.gameMode === 'teenpatti') maybeTpAdvance(state);
    else maybeAdvanceRound(io, state);
  } else if (state.phase === 'rematch-pending' && connected.length >= 2 && connected.every(p => state.rematchAckByPlayer.has(p.playerId))) {
    if (state.config.gameMode === 'cabo') resetCaboForRematch(state);
    else if (state.config.gameMode === 'teenpatti') startTeenPatti(state);
    else resetForRematch(state);
  }
}

function removePlayer(io: Server, state: GameState, playerId: string) {
  const player = state.players.get(playerId);
  if (!player) return;
  const oldGolfTurn = state.turnOrder?.[state.currentTurnIndex ?? 0];
  const oldCaboTurn = state.caboTurnOrder?.[state.caboCurrentTurnIndex ?? 0];
  const golfIdx = state.turnOrder?.indexOf(playerId) ?? -1;
  const caboIdx = state.caboTurnOrder?.indexOf(playerId) ?? -1;
  const returned = [
    ...(state.golfHands?.get(playerId) ?? []).map(s => s.card),
    ...(state.caboHands?.get(playerId) ?? []).map(s => s.card),
    ...[state.pendingDrawByPlayer.get(playerId), state.caboPendingDraw?.get(playerId)].filter((c): c is Card => !!c),
  ];
  state.extraDeck.unshift(...returned);
  state.players.delete(playerId);
  tokenIndex.delete(player.playerToken);
  if (player.isBot) disposeBot(player.currentSocketId);
  if (state.tpCoins) tpOnLeave(state, playerId);
  state.golfHands?.delete(playerId); state.caboHands?.delete(playerId); state.hands.delete(playerId);
  state.pendingDrawByPlayer.delete(playerId); state.caboPendingDraw?.delete(playerId);
  state.roundScores.delete(playerId); state.caboRoundScores?.delete(playerId); state.caboCumulativeScores?.delete(playerId);
  state.peekAckByPlayer?.delete(playerId); state.caboPeekAckByPlayer?.delete(playerId);
  state.betweenRoundAckByPlayer.delete(playerId); state.rematchAckByPlayer.delete(playerId);
  state.caboBlackKingPending?.delete(playerId); state.caboSnapGapPending?.delete(playerId);
  for (const [pid, pending] of state.caboBlackKingPending ?? []) if (pending.targetPlayerId === playerId) state.caboBlackKingPending!.delete(pid);
  for (const [pid, target] of state.caboSnapGapPending ?? []) if (target === playerId) state.caboSnapGapPending!.delete(pid);
  state.turnOrder = state.turnOrder?.filter(pid => pid !== playerId);
  state.caboTurnOrder = state.caboTurnOrder?.filter(pid => pid !== playerId);
  if (state.turnOrder?.length) state.currentTurnIndex = oldGolfTurn === playerId ? Math.max(0, golfIdx) % state.turnOrder.length : Math.max(0, state.turnOrder.indexOf(oldGolfTurn!));
  if (state.caboTurnOrder?.length) state.caboCurrentTurnIndex = oldCaboTurn === playerId ? Math.max(0, caboIdx) % state.caboTurnOrder.length : Math.max(0, state.caboTurnOrder.indexOf(oldCaboTurn!));
  state.caboFinalQueue = state.caboFinalQueue?.filter(pid => pid !== playerId);
  const humans = humanPlayers(state);
  if (!humans.length) { removeGame(state); return; }
  const host = state.players.get(state.hostId);
  if (!host?.connected || host.isBot) state.hostId = (humans.find(p => p.connected) ?? humans[0]).playerId;
  if (!player.isBot) state.notice = `${player.displayName} left the room.`;
  if (state.players.size < 2 && state.status !== 'waiting') {
    state.status = 'waiting'; state.phase = 'waiting'; state.currentRound = 0; state.targetRounds = 0;
    state.golfHands = undefined; state.caboHands = undefined; state.extraDeck = []; state.discardPile = [];
    state.roundScores.clear(); state.caboRoundScores?.clear(); state.caboCumulativeScores?.clear();
    state.pendingDrawByPlayer.clear(); state.caboPendingDraw?.clear(); state.caboBlackKingPending?.clear(); state.caboSnapGapPending?.clear();
    tpClear(state);
    state.notice = 'The match ended because fewer than two players remain. Invite a friend or add a bot to start a new match.';
  } else if (state.phase === 'cabo-called') advanceCaboFinal(io, state);
  else if (state.phase === 'play' && state.config.gameMode === 'golf') checkRoundEnd(io, state);
  settleReadiness(io, state);
  broadcastSnapshot(io, state);
}

function autoAckDisconnected(state: GameState, ackSet: Set<string>) {
  for (const [pid, p] of state.players) {
    if (!p.connected) ackSet.add(pid);
  }
}

function advanceTurn(state: GameState) {
  if (!state.turnOrder) return;
  state.currentTurnIndex = ((state.currentTurnIndex || 0) + 1) % state.turnOrder.length;
}

function checkRoundEnd(io: Server, state: GameState) {
  if (!state.golfHands) return;
  const allLocked = Array.from(state.golfHands.values()).every((slots) => slots.every((s) => s.locked));
  if (!allLocked) return;
  for (const [pid, slots] of state.golfHands) {
    const score = calculateGolfScore(slots);
    const arr = state.roundScores.get(pid) ?? [];
    arr.push(score);
    state.roundScores.set(pid, arr);
  }
  if (state.currentRound < state.targetRounds) {
    state.phase = 'between-rounds';
    state.betweenRoundAckByPlayer = new Set();
    autoAckDisconnected(state, state.betweenRoundAckByPlayer);
    maybeAdvanceRound(io, state);
  } else {
    const totals = Array.from(state.roundScores.values()).map(scores => scores.reduce((a, b) => a + b, 0));
    const lowest = Math.min(...totals);
    if (totals.filter(score => score === lowest).length > 1) {
      state.targetRounds += 1;
      state.notice = 'The lead is tied. One extra round will decide the winner.';
      state.phase = 'between-rounds';
      state.betweenRoundAckByPlayer = new Set();
      autoAckDisconnected(state, state.betweenRoundAckByPlayer);
    } else finalizeGame(state);
  }
}

function maybeAdvanceRound(io: Server, state: GameState) {
  if (state.phase !== 'between-rounds') return;
  const required = Array.from(state.players.values()).filter((p) => p.connected).map((p) => p.playerId);
  if (required.length < 2) return;
  if (!required.every((pid) => state.betweenRoundAckByPlayer.has(pid))) return;
  state.currentRound += 1;
  dealGolfRound(state);
  for (const pid of state.players.keys()) {
    emitToPlayer(io, state, pid, 'golf:hand', state.golfHands!.get(pid));
  }
}

function finalizeGame(state: GameState) {
  state.status = 'ended';
  state.phase = 'rematch-pending';
  state.scores = new Map();

  for (const [pid, scores] of state.roundScores) {
    const total = scores.reduce((a, b) => a + b, 0);
    state.scores.set(pid, total);
  }

  const gameResults = Array.from(state.scores.entries())
    .map(([pid, score]) => ({
      playerId: pid,
      displayName: state.players.get(pid)?.displayName || 'Unknown',
      score,
    }))
    .sort((a, b) => a.score - b.score);

  state.leaderboard = [];
  let prevScore: number | null = null;
  let prevRank = 0;
  gameResults.forEach((r, idx) => {
    let rank: number;
    if (prevScore !== null && r.score === prevScore) {
      rank = prevRank;
    } else {
      rank = idx + 1;
      prevRank = rank;
      prevScore = r.score;
    }
    state.leaderboard!.push({ ...r, rank });
  });

  for (const r of gameResults) {
    const existing = globalLeaderboard.find((p) => p.playerId === r.playerId);
    if (existing) {
      existing.totalScore += r.score;
      existing.gamesPlayed += 1;
    } else {
      globalLeaderboard.push({ playerId: r.playerId, displayName: r.displayName, totalScore: r.score, gamesPlayed: 1 });
    }
  }
  globalLeaderboard.sort((a, b) => a.totalScore - b.totalScore);
  // Unbounded growth guard: entries are keyed by ephemeral playerIds, so this
  // is decorative session history, not durable data. Keep the best 100.
  if (globalLeaderboard.length > 100) globalLeaderboard.length = 100;

  state.rematchAckByPlayer = new Set();
  autoAckDisconnected(state, state.rematchAckByPlayer);
}

function resetForRematch(state: GameState) {
  state.status = 'active';
  state.scores = undefined;
  state.leaderboard = undefined;
  state.matchNumber = (state.matchNumber ?? 0) + 1;
  state.notice = undefined;
  state.currentRound = 1;
  state.targetRounds = state.config.cardsPerPlayer;
  state.roundScores = new Map(Array.from(state.players.keys()).map((pid) => [pid, []]));
  state.betweenRoundAckByPlayer = new Set();
  state.rematchAckByPlayer = new Set();
  state.pendingDrawByPlayer = new Map();
  dealGolfRound(state);
}

function publicGameSnapshot(state: GameState, _viewingPlayerId?: string) {
  const snapshot: any = {
    gameId: state.gameId,
    code: state.code,
    hostId: state.hostId,
    status: state.status,
    phase: state.phase,
    config: state.config,
    players: Array.from(state.players.values()).map((p) => ({
      playerId: p.playerId,
      displayName: p.displayName,
      connected: p.connected,
      disconnectedAt: p.disconnectedAt,
      isBot: !!p.isBot,
    })),
    botsEnabled: true,
    lastAction: state.lastAction ?? null,
    centerPile: state.centerPile,
    extraDeckCount: state.extraDeck.length,
    matchNumber: state.matchNumber ?? 0,
    notice: state.notice,
    paused: state.status === 'active' && Array.from(state.players.values()).filter(p => p.connected).length < 2,
    currentRound: state.currentRound,
    targetRounds: state.targetRounds,
  };

  if (state.discardPile) {
    snapshot.discardTop = state.discardPile[state.discardPile.length - 1] || null;
  }

  if (state.golfHands) {
    const peekPhaseActive = state.peekPhaseActive ?? false;
    snapshot.golf = {
      hands: Array.from(state.golfHands.entries()).map(([pid, slots]) => ({
        playerId: pid,
        slots: slots.map((s) => ({
          slotId: s.slotId,
          revealed: s.revealed && !s.peekOnly,
          locked: s.locked,
          card: (s.revealed && s.locked && !s.peekOnly) ? s.card : null,
        })),
      })),
      turn: state.turnOrder ? state.turnOrder[state.currentTurnIndex || 0] : null,
      round: state.currentRound,
      peekPhaseActive,
      peekAcks: state.peekAckByPlayer ? Array.from(state.peekAckByPlayer) : [],
    };
  }

  if (state.roundScores && state.roundScores.size > 0) {
    snapshot.roundScores = Array.from(state.roundScores.entries()).map(([pid, scores]) => ({
      playerId: pid,
      scores,
    }));
    snapshot.runningTotals = Object.fromEntries(
      Array.from(state.roundScores.entries()).map(([pid, scores]) => [pid, scores.reduce((a, b) => a + b, 0)]),
    );
  }

  snapshot.betweenRoundAcks = Array.from(state.betweenRoundAckByPlayer);
  snapshot.rematchAcks = Array.from(state.rematchAckByPlayer);

  if (state.leaderboard) snapshot.leaderboard = state.leaderboard;

  // Cabo snapshot
  if (state.caboHands) {
    const pendingDrawPlayers: string[] = [];
    if (state.caboPendingDraw) {
      for (const [pid] of state.caboPendingDraw) pendingDrawPlayers.push(pid);
    }
    const blackKingPlayers: string[] = [];
    if (state.caboBlackKingPending) {
      for (const [pid] of state.caboBlackKingPending) blackKingPlayers.push(pid);
    }
    snapshot.cabo = {
      hands: Array.from(state.caboHands.entries()).map(([pid, slots]) => ({
        playerId: pid,
        slots: slots.map((s) => ({ slotId: s.slotId })),
      })),
      turn: state.caboTurnOrder ? state.caboTurnOrder[state.caboCurrentTurnIndex ?? 0] : null,
      round: state.currentRound,
      peekPhaseActive: state.caboPeekPhaseActive ?? false,
      peekAcks: state.caboPeekAckByPlayer ? Array.from(state.caboPeekAckByPlayer) : [],
      caboCallerId: state.caboCallerId ?? null,
      caboFinalTurnsLeft: state.caboFinalTurnsLeft ?? 0,
      pendingDrawPlayers,
      blackKingPlayers,
    };
  }

  if (state.caboRoundScores && state.caboRoundScores.size > 0) {
    snapshot.caboRoundScores = Array.from(state.caboRoundScores.entries()).map(([pid, scores]) => ({
      playerId: pid,
      scores,
    }));
  }

  if (state.caboCumulativeScores) {
    snapshot.caboCumulativeScores = Object.fromEntries(state.caboCumulativeScores);
  }

  if (state.caboLeaderboard) snapshot.caboLeaderboard = state.caboLeaderboard;

  if (state.tpCoins) snapshot.tp = tpPublic(state);

  return snapshot;
}

// ---------- server ----------

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: ALLOWED_ORIGIN } });

app.get('/health', (_req, res) => res.status(200).send('ok'));

io.on('connection', (socket) => attachSocketHandlers(socket));

// Every seat — a browser tab or a server-side bot — runs through this one
// function: same middleware, same validation, same handlers.
function attachSocketHandlers(socket: Socket) {
  let currentGameId: string | null = null;
  let currentPlayerId: string | null = null;

  function getState(): GameState | null {
    if (!currentGameId) return null;
    const state = games.get(currentGameId);
    return state?.players.get(currentPlayerId ?? '')?.currentSocketId === socket.id ? state : null;
  }

  socket.use((packet, next) => {
    const event = String(packet[0]);
    const ack = typeof packet[packet.length - 1] === 'function' ? packet[packet.length - 1] : () => {};
    if (typeof packet[packet.length - 1] !== 'function') packet.push(ack);
    if (packet.length < 3 || !packet[1] || typeof packet[1] !== 'object' || Array.isArray(packet[1])) {
      ack({ error: 'Invalid request' }); return;
    }
    if (['createGame', 'joinGame', 'rejoinGame', 'getLeaderboard', '__test:stackDeck'].includes(event)) { next(); return; }
    const state = getState();
    if (!state || !currentPlayerId) { ack({ error: 'Your session is no longer active. Rejoin the room.' }); return; }
    if ((event.startsWith('golf:') && state.config.gameMode !== 'golf') || (event.startsWith('cabo:') && state.config.gameMode !== 'cabo') || (event.startsWith('tp:') && state.config.gameMode !== 'teenpatti') || (['playCard', 'drawCard'].includes(event) && state.config.gameMode !== 'classic')) {
      ack({ error: 'Action is not available in this game mode' }); return;
    }
    const gameplay = /^(golf:(draw|swapWithDiscard|acceptDrawAndSwap|rejectDrawAndReveal)|cabo:(draw|placeDrawn|discardDrawn|useSpecialPower|blackKingDecide|takeDiscard|callCabo|snap|snapSlide|snapSlideDecline)|tp:(see|bet|pack|show|sideShow|sideShowAnswer)|playCard|drawCard)$/.test(event);
    if (gameplay) {
      if (!['play', 'cabo-called'].includes(state.phase)) { ack({ error: 'Cannot act in this phase' }); return; }
      if (Array.from(state.players.values()).filter(p => p.connected).length < 2) { ack({ error: 'Waiting for another player to reconnect' }); return; }
      if (event.startsWith('cabo:') && !event.startsWith('cabo:snap') && state.caboTurnOrder?.[state.caboCurrentTurnIndex ?? 0] !== currentPlayerId) {
        ack({ error: 'Not your turn' }); return;
      }
      if (state.caboBlackKingPending?.has(currentPlayerId) && event !== 'cabo:blackKingDecide') { ack({ error: 'Finish your Black King decision first' }); return; }
      if (event.startsWith('cabo:snap') && state.caboBlackKingPending?.size) { ack({ error: 'Wait for the Black King decision' }); return; }
    }
    next();
  });

  function releaseWaitingMembership(): boolean {
    const state = getState();
    if (!state || !currentPlayerId) return true;
    if (state.status === 'active') return false;
    removePlayer(io, state, currentPlayerId);
    socket.leave(state.gameId); currentGameId = null; currentPlayerId = null;
    return true;
  }

  // Per-socket sliding-window rate limiter. Returns true when the caller has
  // exceeded the budget for `event` and should be rejected.
  const rateHits = new Map<string, number[]>();
  function rateLimited(event: string): boolean {
    const cfg = RATE_LIMITS[event];
    if (!cfg) return false;
    const now = Date.now();
    const recent = (rateHits.get(event) ?? []).filter((t) => now - t < cfg.windowMs);
    if (recent.length >= cfg.max) {
      rateHits.set(event, recent);
      return true;
    }
    recent.push(now);
    rateHits.set(event, recent);
    return false;
  }

  // Test-only: pre-stack an exact deck for the next deal. Registered only when
  // TEST_HOOKS=1 so it never exists in a normal/production server.
  if (TEST_HOOKS) {
    socket.on('__test:stackDeck', (payload: { cards: Array<{ rank: Rank; suit: Suit }> }, ack: (res: any) => void) => {
      if (!Array.isArray(payload?.cards)) return ack({ error: 'cards[] required' });
      const deck = payload.cards.map((c, i) => buildCard(c.rank, c.suit, 'test', i));
      injectedDecks.push(deck);
      ack({ ok: true, size: deck.length });
    });
  }

  socket.on('createGame', (payload: { displayName?: string; config: GameConfig }, ack: (res: any) => void) => {
    if (rateLimited('createGame')) return ack({ error: 'Too many games created, slow down' });
    if (!releaseWaitingMembership()) return ack({ error: 'Leave your current match first' });
    if (codeToGameId.size >= 10_000) return ack({ error: 'All rooms are occupied. Try again later.' });
    const gameId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let code = nano4();
    while (codeToGameId.has(code)) code = nano4();
    const config = sanitizeConfig(payload?.config);

    const playerId = nanoPlayerId();
    const playerToken = nanoToken();

    const state: GameState = {
      gameId,
      code,
      hostId: playerId,
      status: 'waiting',
      phase: 'waiting',
      config,
      players: new Map(),
      hands: new Map(),
      centerPile: [],
      extraDeck: [],
      currentRound: 0,
      targetRounds: 0,
      roundScores: new Map(),
      betweenRoundAckByPlayer: new Set(),
      rematchAckByPlayer: new Set(),
      pendingDrawByPlayer: new Map(),
    };

    const player: Player = {
      playerId,
      playerToken,
      currentSocketId: socket.id,
      displayName: sanitizeName(payload?.displayName, 'Host'),
      connected: true,
    };
    state.players.set(playerId, player);
    codeToGameId.set(code, gameId);
    games.set(gameId, state);
    tokenIndex.set(playerToken, { gameId, playerId });

    currentGameId = gameId;
    currentPlayerId = playerId;
    socket.join(gameId);

    broadcastSnapshot(io, state);
    ack({ gameId, code, playerId, playerToken });
  });

  socket.on('joinGame', (payload: { code: string; displayName?: string }, ack: (res: any) => void) => {
    if (rateLimited('joinGame')) return ack({ error: 'Too many join attempts, slow down' });
    if (typeof payload?.code !== 'string') return ack({ error: 'Invalid code' });
    const gameId = codeToGameId.get(payload.code);
    if (!gameId) return ack({ error: 'Invalid code' });
    const state = games.get(gameId);
    if (!state) return ack({ error: 'Game not found' });
    if (state.status !== 'waiting') return ack({ error: 'Game in progress' });
    if (state.players.size >= state.config.maxPlayers) return ack({ error: 'Game full' });
    if (currentGameId === gameId) return ack({ error: 'You are already in this room' });
    if (!releaseWaitingMembership()) return ack({ error: 'Leave your current match first' });

    const playerId = nanoPlayerId();
    const playerToken = nanoToken();
    const player: Player = {
      playerId,
      playerToken,
      currentSocketId: socket.id,
      displayName: sanitizeName(payload?.displayName, `Player ${state.players.size + 1}`),
      connected: true,
    };
    state.players.set(playerId, player);
    tokenIndex.set(playerToken, { gameId, playerId });

    currentGameId = gameId;
    currentPlayerId = playerId;
    socket.join(gameId);

    broadcastSnapshot(io, state);
    ack({ gameId, code: state.code, playerId, playerToken });
  });

  socket.on('rejoinGame', (payload: { playerToken: string }, ack: (res: any) => void) => {
    const idx = tokenIndex.get(payload.playerToken);
    if (!idx) return ack({ error: 'Invalid token' });
    const state = games.get(idx.gameId);
    if (!state) return ack({ error: 'Game not found' });
    const player = state.players.get(idx.playerId);
    if (!player) return ack({ error: 'Player not in game' });

    if (currentGameId && (currentGameId !== state.gameId || currentPlayerId !== player.playerId)) {
      if (!releaseWaitingMembership()) return ack({ error: 'Leave your current match first' });
    }
    const prior = io.sockets.sockets.get(player.currentSocketId);
    if (prior && prior.id !== socket.id) {
      prior.emit('session:replaced');
      // Reassign before disconnect so the old connection cannot mark this player offline.
      player.currentSocketId = socket.id;
      prior.disconnect(true);
    }
    player.currentSocketId = socket.id;
    player.connected = true;
    player.disconnectedAt = undefined;

    currentGameId = state.gameId;
    currentPlayerId = player.playerId;
    socket.join(state.gameId);
    settleReadiness(io, state);

    broadcastSnapshot(io, state);
    if (state.config.gameMode === 'golf' && state.golfHands) {
      emitToPlayer(io, state, player.playerId, 'golf:hand', null);
      const pendingCard = state.pendingDrawByPlayer.get(player.playerId);
      if (pendingCard) io.to(socket.id).emit('golf:pendingDraw', pendingCard);
    } else if (state.config.gameMode === 'cabo' && state.caboHands) {
      emitToPlayer(io, state, player.playerId, 'cabo:hand', null);
      const pendingCard = state.caboPendingDraw?.get(player.playerId);
      if (pendingCard) io.to(socket.id).emit('cabo:pendingDraw', pendingCard);
    } else if (state.hands.has(player.playerId)) {
      io.to(socket.id).emit('hand:update', state.hands.get(player.playerId));
    }

    ack({
      gameId: state.gameId,
      code: state.code,
      playerId: player.playerId,
      playerToken: player.playerToken,
    });
  });

  socket.on('startGame', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.hostId !== currentPlayerId) return ack({ error: 'Only host can start' });
    if (state.phase !== 'waiting') return ack({ error: 'The match has already started' });
    if (Array.from(state.players.values()).filter(p => p.connected).length < 2) return ack({ error: 'Need at least 2 connected players' });
    if (Array.from(state.players.values()).some(p => !p.connected)) return ack({ error: 'Wait for disconnected players to return or leave the room' });
    state.status = 'active';
    state.centerPile = [];

    if (state.config.gameMode === 'golf') {
      if (![4, 6, 8].includes(state.config.cardsPerPlayer)) state.config.cardsPerPlayer = 4;
      startGolf(state);
      broadcastSnapshot(io, state);
      for (const pid of state.players.keys()) {
        emitToPlayer(io, state, pid, 'golf:hand', state.golfHands!.get(pid));
      }
    } else if (state.config.gameMode === 'cabo') {
      startCabo(state);
      broadcastSnapshot(io, state);
      for (const pid of state.players.keys()) {
        emitToPlayer(io, state, pid, 'cabo:hand', state.caboHands!.get(pid) ?? []);
      }
    } else if (state.config.gameMode === 'teenpatti') {
      startTeenPatti(state);
      broadcastSnapshot(io, state);
    } else {
      dealCards(state);
      state.phase = 'play';
      broadcastSnapshot(io, state);
      for (const pid of state.players.keys()) {
        emitToPlayer(io, state, pid, 'hand:update', state.hands.get(pid));
      }
    }

    ack({ ok: true });
  });

  // ---- Bots (host only, lobby only) ----

  socket.on('addBot', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.hostId !== currentPlayerId) return ack({ error: 'Only the host can add bots' });
    if (state.phase !== 'waiting') return ack({ error: 'Add bots before the match starts' });
    if (state.players.size >= state.config.maxPlayers) return ack({ error: 'Game full' });
    ack(addBotToGame(state));
  });

  socket.on('removeBot', (payload: { playerId: string }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.hostId !== currentPlayerId) return ack({ error: 'Only the host can remove bots' });
    if (state.phase !== 'waiting') return ack({ error: 'Bots can only be removed in the lobby' });
    const target = typeof payload.playerId === 'string' ? state.players.get(payload.playerId) : undefined;
    if (!target?.isBot) return ack({ error: 'That player is not a bot' });
    removePlayer(io, state, target.playerId);
    ack({ ok: true });
  });

  // ---- Golf actions ----

  socket.on('golf:ackPeek', (_: {}, ack: (res: any) => void) => {
    const state = getState()!;
    if (state.phase !== 'peek') return ack({ error: 'Not in peek phase' });
    state.peekAckByPlayer!.add(currentPlayerId!);
    for (const slot of state.golfHands?.get(currentPlayerId!) ?? []) {
      if (slot.peekOnly) { slot.peekOnly = false; slot.revealed = false; }
    }
    settleReadiness(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('golf:swapWithDiscard', (payload: { slotId: string }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (!state.golfHands || !state.discardPile) return ack({ error: 'Not a golf game' });
    if (state.phase !== 'play') return ack({ error: 'Cannot act in this phase' });
    if (state.turnOrder && state.turnOrder[state.currentTurnIndex || 0] !== currentPlayerId) {
      return ack({ error: 'Not your turn' });
    }
    if (state.pendingDrawByPlayer.has(currentPlayerId)) return ack({ error: 'Resolve your drawn card first' });
    const top = state.discardPile[state.discardPile.length - 1];
    if (!top) return ack({ error: 'No discard card' });
    const slots = state.golfHands.get(currentPlayerId)!;
    const slot = slots.find((s) => s.slotId === payload.slotId);
    if (!slot) return ack({ error: 'Slot not found' });
    if (slot.locked) return ack({ error: 'Slot locked' });

    const old = slot.card;
    slot.card = top;
    slot.revealed = true;
    slot.locked = true;
    state.discardPile[state.discardPile.length - 1] = old;
    logAction(state, currentPlayerId, 'golf:swap-discard', `took the ${cardName(top)} from the discard, replacing ${aCard(old)}`, [slot.slotId]);

    advanceTurn(state);
    checkRoundEnd(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('golf:draw', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (!state.golfHands) return ack({ error: 'Not a golf game' });
    if (state.phase !== 'play') return ack({ error: 'Cannot act in this phase' });
    if (state.turnOrder && state.turnOrder[state.currentTurnIndex || 0] !== currentPlayerId) {
      return ack({ error: 'Not your turn' });
    }
    if (state.pendingDrawByPlayer.has(currentPlayerId)) return ack({ error: 'Resolve your drawn card first' });
    if (state.extraDeck.length === 0) reshuffleDrawPile(state);
    const card = state.extraDeck.pop();
    if (!card) return ack({ error: 'No cards left' });
    state.pendingDrawByPlayer.set(currentPlayerId, card);
    logAction(state, currentPlayerId, 'golf:draw', 'drew from the deck');
    broadcastSnapshot(io, state);
    ack({ ok: true, card });
  });

  socket.on('golf:acceptDrawAndSwap', (payload: { slotId: string }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (!state.golfHands || !state.discardPile) return ack({ error: 'Not a golf game' });
    if (state.phase !== 'play') return ack({ error: 'Cannot act in this phase' });
    // Explicit turn check: a pendingDraw normally implies it's your turn, but
    // golf:kickPlayer can advance the turn past a player still holding one.
    if (state.turnOrder && state.turnOrder[state.currentTurnIndex || 0] !== currentPlayerId) {
      return ack({ error: 'Not your turn' });
    }
    const card = state.pendingDrawByPlayer.get(currentPlayerId);
    if (!card) return ack({ error: 'No pending card' });
    const slots = state.golfHands.get(currentPlayerId)!;
    const slot = slots.find((s) => s.slotId === payload.slotId);
    if (!slot || slot.locked) return ack({ error: 'Invalid slot' });

    const old = slot.card;
    slot.card = card;
    slot.revealed = true;
    slot.locked = true;
    state.discardPile.push(old);
    state.pendingDrawByPlayer.delete(currentPlayerId);
    logAction(state, currentPlayerId, 'golf:keep-draw', `kept the drawn ${cardName(card)}, replacing ${aCard(old)}`, [slot.slotId]);

    advanceTurn(state);
    checkRoundEnd(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('golf:rejectDrawAndReveal', (payload: { slotId: string }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (!state.golfHands || !state.discardPile) return ack({ error: 'Not a golf game' });
    if (state.phase !== 'play') return ack({ error: 'Cannot act in this phase' });
    // Explicit turn check: see golf:acceptDrawAndSwap.
    if (state.turnOrder && state.turnOrder[state.currentTurnIndex || 0] !== currentPlayerId) {
      return ack({ error: 'Not your turn' });
    }
    const card = state.pendingDrawByPlayer.get(currentPlayerId);
    if (!card) return ack({ error: 'No pending card' });

    const slots = state.golfHands.get(currentPlayerId)!;
    const slot = slots.find((s) => s.slotId === payload.slotId);
    if (!slot || slot.locked) return ack({ error: 'Invalid slot' });

    state.discardPile.push(card);
    slot.revealed = true;
    slot.locked = true;
    state.pendingDrawByPlayer.delete(currentPlayerId);
    logAction(state, currentPlayerId, 'golf:reject-draw', `discarded the drawn ${cardName(card)} and flipped ${aCard(slot.card)}`, [slot.slotId]);

    advanceTurn(state);
    checkRoundEnd(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('golf:ackNextRound', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.phase !== 'between-rounds') return ack({ error: 'Not between rounds' });
    state.betweenRoundAckByPlayer.add(currentPlayerId);
    autoAckDisconnected(state, state.betweenRoundAckByPlayer);
    maybeAdvanceRound(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  function kickPlayer(payload: { playerId: string }, ack: (res: any) => void) {
    const state = getState()!;
    if (state.hostId !== currentPlayerId) return ack({ error: 'Only host can remove a player' });
    const target = state.players.get(payload.playerId);
    if (!target || target.connected) return ack({ error: 'Player must be disconnected' });
    if (!target.disconnectedAt || Date.now() - target.disconnectedAt < DISCONNECT_GRACE_MS) return ack({ error: 'Grace period not elapsed' });
    removePlayer(io, state, target.playerId);
    ack({ ok: true });
  }
  socket.on('golf:kickPlayer', kickPlayer);

  socket.on('golf:ackRematch', (_: {}, ack: (res: any) => void) => {
    const state = getState()!;
    if (state.phase !== 'rematch-pending') return ack({ error: 'Not in rematch phase' });
    state.rematchAckByPlayer.add(currentPlayerId!);
    settleReadiness(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  // Shared by golf:leaveGame and cabo:leaveGame (identical semantics; two
  // event names kept for wire compat with deployed clients).
  function handleLeaveGame(ack: (res: any) => void) {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    removePlayer(io, state, currentPlayerId);
    socket.leave(state.gameId); currentGameId = null; currentPlayerId = null;
    ack({ ok: true });
  }

  socket.on('golf:leaveGame', (_: {}, ack: (res: any) => void) => handleLeaveGame(ack));

  socket.on('golf:updateConfig', (payload: { cardsPerPlayer: number }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.hostId !== currentPlayerId) return ack({ error: 'Host only' });
    if (state.phase !== 'rematch-pending') return ack({ error: 'Only allowed before rematch' });
    if (![4, 6, 8].includes(payload.cardsPerPlayer)) return ack({ error: 'Invalid cardsPerPlayer' });
    state.config.cardsPerPlayer = payload.cardsPerPlayer;
    state.rematchAckByPlayer.clear();
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  // ---- Cabo actions ----

  socket.on('cabo:ackPeek', (_: {}, ack: (res: any) => void) => {
    const state = getState()!;
    if (state.phase !== 'peek') return ack({ error: 'Not in peek phase' });
    state.caboPeekAckByPlayer!.add(currentPlayerId!);
    settleReadiness(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('cabo:draw', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.config.gameMode !== 'cabo' || !state.caboHands) return ack({ error: 'Not a Cabo game' });
    if (state.phase !== 'play' && state.phase !== 'cabo-called') return ack({ error: 'Cannot act in this phase' });
    if (state.caboTurnOrder && state.caboTurnOrder[state.caboCurrentTurnIndex ?? 0] !== currentPlayerId) {
      return ack({ error: 'Not your turn' });
    }
    if (state.caboPendingDraw?.has(currentPlayerId)) return ack({ error: 'Already drew' });

    caboEnsureDrawPile(state);
    const card = state.extraDeck.pop();
    if (!card) return ack({ error: 'No cards left' });

    if (!state.caboPendingDraw) state.caboPendingDraw = new Map();
    state.caboPendingDraw.set(currentPlayerId, card);
    logAction(state, currentPlayerId, 'cabo:draw', 'drew from the deck');

    broadcastSnapshot(io, state);
    ack({ ok: true, card });
  });

  socket.on('cabo:placeDrawn', (payload: { slotId: string }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.config.gameMode !== 'cabo' || !state.caboHands || !state.discardPile) return ack({ error: 'Not a Cabo game' });
    if (state.phase !== 'play' && state.phase !== 'cabo-called') return ack({ error: 'Cannot act in this phase' });

    // Turn-gated implicitly: only the turn player can hold a caboPendingDraw
    // (cabo:draw is turn-checked and the turn doesn't advance until resolved).
    // Never add another way to acquire a pendingDraw without revisiting this.
    const drawn = state.caboPendingDraw?.get(currentPlayerId);
    if (!drawn) return ack({ error: 'No pending draw' });

    const slots = state.caboHands.get(currentPlayerId);
    if (!slots) return ack({ error: 'No hand' });
    const slotIdx = slots.findIndex((s) => s.slotId === payload.slotId);
    if (slotIdx === -1) return ack({ error: 'Slot not found' });

    const old = slots[slotIdx].card;
    slots[slotIdx] = { slotId: slots[slotIdx].slotId, card: drawn };
    state.discardPile.push(old);
    state.caboPendingDraw!.delete(currentPlayerId);
    state.caboBlackKingPending?.delete(currentPlayerId);
    state.caboSnapGapPending?.delete(currentPlayerId);
    logAction(state, currentPlayerId, 'cabo:place', `kept the drawn card, discarding ${aCard(old)}`, [slots[slotIdx].slotId]);

    emitToPlayer(io, state, currentPlayerId, 'cabo:hand', slots);
    caboEndTurn(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('cabo:discardDrawn', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.config.gameMode !== 'cabo' || !state.caboHands || !state.discardPile) return ack({ error: 'Not a Cabo game' });
    if (state.phase !== 'play' && state.phase !== 'cabo-called') return ack({ error: 'Cannot act in this phase' });

    const drawn = state.caboPendingDraw?.get(currentPlayerId);
    if (!drawn) return ack({ error: 'No pending draw' });

    state.discardPile.push(drawn);
    state.caboPendingDraw!.delete(currentPlayerId);
    state.caboSnapGapPending?.delete(currentPlayerId);
    logAction(state, currentPlayerId, 'cabo:discard', `discarded the drawn ${cardName(drawn)}`);

    caboEndTurn(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('cabo:useSpecialPower', (payload: {
    action: 'peek-own' | 'spy' | 'blind-swap' | 'black-king-see';
    ownSlotId?: string;
    targetPlayerId?: string;
    targetSlotId?: string;
  }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.config.gameMode !== 'cabo' || !state.caboHands || !state.discardPile) return ack({ error: 'Not a Cabo game' });
    if (state.phase !== 'play' && state.phase !== 'cabo-called') return ack({ error: 'Cannot act in this phase' });

    // Turn-gated implicitly via pendingDraw — see cabo:placeDrawn.
    const drawn = state.caboPendingDraw?.get(currentPlayerId);
    if (!drawn) return ack({ error: 'No pending draw' });

    const expectedAction = getCaboSpecialAction(drawn);
    if (!expectedAction) return ack({ error: 'Card has no special action' });
    if (payload.action !== expectedAction) return ack({ error: 'Wrong action for this card' });

    const mySlots = state.caboHands.get(currentPlayerId);
    if (!mySlots) return ack({ error: 'No hand' });

    if (payload.action === 'peek-own') {
      if (!payload.ownSlotId) return ack({ error: 'ownSlotId required' });
      const slot = mySlots.find((s) => s.slotId === payload.ownSlotId);
      if (!slot) return ack({ error: 'Slot not found' });

      state.discardPile.push(drawn);
      state.caboPendingDraw!.delete(currentPlayerId);
      logAction(state, currentPlayerId, 'cabo:peek', `used ${aRank(drawn.rank)} to peek at one of their cards`, [slot.slotId]);

      emitToPlayer(io, state, currentPlayerId, 'cabo:peekResult', { slotId: slot.slotId, card: slot.card });
      caboEndTurn(io, state);
      broadcastSnapshot(io, state);
      return ack({ ok: true });
    }

    if (payload.action === 'spy') {
      if (!payload.targetPlayerId || !payload.targetSlotId) return ack({ error: 'targetPlayerId and targetSlotId required' });
      if (payload.targetPlayerId === currentPlayerId) return ack({ error: 'Cannot spy yourself' });
      const targetSlots = state.caboHands.get(payload.targetPlayerId);
      if (!targetSlots) return ack({ error: 'Target player not found' });
      const slot = targetSlots.find((s) => s.slotId === payload.targetSlotId);
      if (!slot) return ack({ error: 'Target slot not found' });

      state.discardPile.push(drawn);
      state.caboPendingDraw!.delete(currentPlayerId);
      logAction(state, currentPlayerId, 'cabo:spy', `used ${aRank(drawn.rank)} to spy on one of ${nameOf(state, payload.targetPlayerId)}'s cards`, [slot.slotId]);

      emitToPlayer(io, state, currentPlayerId, 'cabo:spyResult', {
        targetPlayerId: payload.targetPlayerId,
        slotId: slot.slotId,
        card: slot.card,
      });
      caboEndTurn(io, state);
      broadcastSnapshot(io, state);
      return ack({ ok: true });
    }

    if (payload.action === 'blind-swap') {
      if (!payload.ownSlotId || !payload.targetPlayerId || !payload.targetSlotId) {
        return ack({ error: 'ownSlotId, targetPlayerId, targetSlotId required' });
      }
      if (payload.targetPlayerId === currentPlayerId) return ack({ error: 'Cannot swap with yourself' });
      const ownSlot = mySlots.find((s) => s.slotId === payload.ownSlotId);
      if (!ownSlot) return ack({ error: 'Own slot not found' });
      const targetSlots = state.caboHands.get(payload.targetPlayerId);
      if (!targetSlots) return ack({ error: 'Target player not found' });
      const targetSlot = targetSlots.find((s) => s.slotId === payload.targetSlotId);
      if (!targetSlot) return ack({ error: 'Target slot not found' });

      const temp = ownSlot.card;
      ownSlot.card = targetSlot.card;
      targetSlot.card = temp;

      state.discardPile.push(drawn);
      state.caboPendingDraw!.delete(currentPlayerId);
      logAction(state, currentPlayerId, 'cabo:blind-swap', `used ${aRank(drawn.rank)} to swap one of their cards for one of ${nameOf(state, payload.targetPlayerId)}'s cards, sight unseen`, [ownSlot.slotId, targetSlot.slotId]);

      emitToPlayer(io, state, currentPlayerId, 'cabo:hand', mySlots);
      emitToPlayer(io, state, payload.targetPlayerId, 'cabo:hand', targetSlots);
      caboEndTurn(io, state);
      broadcastSnapshot(io, state);
      return ack({ ok: true });
    }

    if (payload.action === 'black-king-see') {
      if (!payload.targetPlayerId || !payload.targetSlotId) return ack({ error: 'targetPlayerId and targetSlotId required' });
      if (payload.targetPlayerId === currentPlayerId) return ack({ error: 'Cannot target yourself' });
      const targetSlots = state.caboHands.get(payload.targetPlayerId);
      if (!targetSlots) return ack({ error: 'Target player not found' });
      const slot = targetSlots.find((s) => s.slotId === payload.targetSlotId);
      if (!slot) return ack({ error: 'Target slot not found' });

      if (!state.caboBlackKingPending) state.caboBlackKingPending = new Map();
      state.caboBlackKingPending.set(currentPlayerId, {
        targetPlayerId: payload.targetPlayerId,
        targetSlotId: payload.targetSlotId,
      });
      logAction(state, currentPlayerId, 'cabo:king-look', `is using a Black King to look at one of ${nameOf(state, payload.targetPlayerId)}'s cards`, [slot.slotId]);

      emitToPlayer(io, state, currentPlayerId, 'cabo:blackKingSeeResult', {
        targetPlayerId: payload.targetPlayerId,
        slotId: slot.slotId,
        card: slot.card,
      });
      broadcastSnapshot(io, state);
      return ack({ ok: true });
    }

    ack({ error: 'Unknown action' });
  });

  socket.on('cabo:blackKingDecide', (payload: { swap: boolean; ownSlotId?: string }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.config.gameMode !== 'cabo' || !state.caboHands || !state.discardPile) return ack({ error: 'Not a Cabo game' });

    if (typeof payload.swap !== 'boolean') return ack({ error: 'swap must be true or false' });
    const pending = state.caboBlackKingPending?.get(currentPlayerId);
    if (!pending) return ack({ error: 'No black king pending' });

    const drawn = state.caboPendingDraw?.get(currentPlayerId);
    if (!drawn) return ack({ error: 'No pending draw' });

    const mySlots = state.caboHands.get(currentPlayerId);
    if (!mySlots) return ack({ error: 'No hand' });

    if (payload.swap) {
      if (!payload.ownSlotId) return ack({ error: 'ownSlotId required for swap' });
      const ownSlot = mySlots.find((s) => s.slotId === payload.ownSlotId);
      if (!ownSlot) return ack({ error: 'Own slot not found' });
      const targetSlots = state.caboHands.get(pending.targetPlayerId);
      if (!targetSlots) return ack({ error: 'Target no longer in game' });
      const targetSlot = targetSlots.find((s) => s.slotId === pending.targetSlotId);
      if (!targetSlot) return ack({ error: 'Target slot no longer exists' });

      const temp = ownSlot.card;
      ownSlot.card = targetSlot.card;
      targetSlot.card = temp;

      emitToPlayer(io, state, currentPlayerId, 'cabo:hand', mySlots);
      emitToPlayer(io, state, pending.targetPlayerId, 'cabo:hand', targetSlots);
      logAction(state, currentPlayerId, 'cabo:king-swap', `looked at one of ${nameOf(state, pending.targetPlayerId)}'s cards and swapped it for one of theirs`, [ownSlot.slotId, targetSlot.slotId]);
    } else {
      logAction(state, currentPlayerId, 'cabo:king-pass', `looked at one of ${nameOf(state, pending.targetPlayerId)}'s cards and left it there`, [pending.targetSlotId]);
    }

    state.discardPile.push(drawn);
    state.caboPendingDraw!.delete(currentPlayerId);
    state.caboBlackKingPending!.delete(currentPlayerId);

    caboEndTurn(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('cabo:takeDiscard', (payload: { slotId: string }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.config.gameMode !== 'cabo' || !state.caboHands || !state.discardPile) return ack({ error: 'Not a Cabo game' });
    if (state.phase !== 'play' && state.phase !== 'cabo-called') return ack({ error: 'Cannot act in this phase' });
    if (state.caboTurnOrder && state.caboTurnOrder[state.caboCurrentTurnIndex ?? 0] !== currentPlayerId) {
      return ack({ error: 'Not your turn' });
    }
    if (state.caboPendingDraw?.has(currentPlayerId)) return ack({ error: 'Already have a drawn card' });

    const top = state.discardPile[state.discardPile.length - 1];
    if (!top) return ack({ error: 'No discard card' });

    const slots = state.caboHands.get(currentPlayerId);
    if (!slots) return ack({ error: 'No hand' });
    const slotIdx = slots.findIndex((s) => s.slotId === payload.slotId);
    if (slotIdx === -1) return ack({ error: 'Slot not found' });

    const old = slots[slotIdx].card;
    slots[slotIdx] = { slotId: slots[slotIdx].slotId, card: top };
    state.discardPile[state.discardPile.length - 1] = old;
    state.caboSnapGapPending?.delete(currentPlayerId);
    logAction(state, currentPlayerId, 'cabo:take-discard', `took the ${cardName(top)} from the discard, discarding ${aCard(old)}`, [slots[slotIdx].slotId]);

    emitToPlayer(io, state, currentPlayerId, 'cabo:hand', slots);
    caboEndTurn(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('cabo:callCabo', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.config.gameMode !== 'cabo' || !state.caboHands) return ack({ error: 'Not a Cabo game' });
    if (state.phase !== 'play') return ack({ error: 'Cabo can only be called during play' });
    if (state.caboTurnOrder && state.caboTurnOrder[state.caboCurrentTurnIndex ?? 0] !== currentPlayerId) {
      return ack({ error: 'Not your turn' });
    }
    if (state.caboPendingDraw?.has(currentPlayerId)) return ack({ error: 'Resolve your drawn card first' });

    state.caboCallerId = currentPlayerId;
    state.phase = 'cabo-called';
    logAction(state, currentPlayerId, 'cabo:call', 'called Cabo! Everyone else gets one last turn.');
    const order = state.caboTurnOrder!;
    const index = order.indexOf(currentPlayerId);
    state.caboFinalQueue = [...order.slice(index + 1), ...order.slice(0, index)];
    advanceCaboFinal(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('cabo:snap', (payload: {
    targetType: 'own' | 'opponent';
    targetPlayerId?: string;
    targetSlotId: string;
  }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.config.gameMode !== 'cabo' || !state.caboHands || !state.discardPile) return ack({ error: 'Not a Cabo game' });
    if (state.phase === 'peek' || state.phase === 'between-rounds' || state.phase === 'rematch-pending' || state.phase === 'waiting') {
      return ack({ error: 'Cannot snap in this phase' });
    }

    if (state.caboSnapGapPending?.has(currentPlayerId)) return ack({ error: 'Resolve your snap slide first' });
    const discardTop = state.discardPile[state.discardPile.length - 1];
    if (!discardTop) return ack({ error: 'No discard card' });

    const targetPlayerId = payload.targetType === 'own' ? currentPlayerId : payload.targetPlayerId;
    if (!targetPlayerId) return ack({ error: 'targetPlayerId required for opponent snap' });
    if (payload.targetType === 'opponent' && targetPlayerId === currentPlayerId) {
      return ack({ error: 'Cannot snap your own card as opponent snap' });
    }

    const targetSlots = state.caboHands.get(targetPlayerId);
    if (!targetSlots) return ack({ error: 'Target player not found' });
    const slotIdx = targetSlots.findIndex((s) => s.slotId === payload.targetSlotId);
    if (slotIdx === -1) return ack({ error: 'Target slot not found' });

    const targetCard = targetSlots[slotIdx].card;

    if (targetCard.rank !== discardTop.rank) {
      // Wrong snap: draw 2 penalty cards
      const mySlots = state.caboHands.get(currentPlayerId)!;
      let penalties = 0;
      for (let i = 0; i < 2; i++) {
        caboEnsureDrawPile(state);
        const penalty = state.extraDeck.pop();
        if (penalty) {
          penalties++;
          mySlots.push({
            slotId: `${currentPlayerId}:r${state.currentRound}:pen${Date.now()}${i}`,
            card: penalty,
          });
        }
      }
      logAction(state, currentPlayerId, 'cabo:wrong-snap', `snapped the wrong card${penalties ? ` and took ${penalties} penalty card${penalties === 1 ? '' : 's'}` : ''}`, penalties ? mySlots.slice(-penalties).map(s => s.slotId) : []);
      emitToPlayer(io, state, currentPlayerId, 'cabo:hand', mySlots);
      broadcastSnapshot(io, state);
      // `code` is the machine-readable contract; the client matches it (not the
      // human string, which is free to change).
      return ack({ ok: false, code: 'WRONG_SNAP', error: 'Wrong rank — 2 penalty cards drawn' });
    }

    // Correct snap: remove card from target's hand
    targetSlots.splice(slotIdx, 1);
    state.discardPile.push(targetCard);
    logAction(state, currentPlayerId, 'cabo:snap', payload.targetType === 'own'
      ? `snapped their own ${cardName(targetCard)}!`
      : `snapped ${nameOf(state, targetPlayerId)}'s ${cardName(targetCard)}!`);

    emitToPlayer(io, state, targetPlayerId, 'cabo:hand', targetSlots);

    if (payload.targetType === 'opponent') {
      // Snapper can optionally slide one of their own cards into the gap
      if (!state.caboSnapGapPending) state.caboSnapGapPending = new Map();
      state.caboSnapGapPending.set(currentPlayerId, targetPlayerId);
      emitToPlayer(io, state, currentPlayerId, 'cabo:snapGapAvailable', { opponentId: targetPlayerId });
    }

    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('cabo:snapSlide', (payload: { ownSlotId: string }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.config.gameMode !== 'cabo' || !state.caboHands) return ack({ error: 'Not a Cabo game' });

    const opponentId = state.caboSnapGapPending?.get(currentPlayerId);
    if (!opponentId) return ack({ error: 'No snap gap pending' });

    const mySlots = state.caboHands.get(currentPlayerId);
    if (!mySlots) return ack({ error: 'No hand' });
    const slotIdx = mySlots.findIndex((s) => s.slotId === payload.ownSlotId);
    if (slotIdx === -1) return ack({ error: 'Slot not found' });

    const opponentSlots = state.caboHands.get(opponentId);
    if (!opponentSlots) return ack({ error: 'Opponent no longer in game' });

    const slidCard = mySlots[slotIdx];
    mySlots.splice(slotIdx, 1);
    const slidSlotId = `${opponentId}:r${state.currentRound}:slid${Date.now()}`;
    opponentSlots.push({ slotId: slidSlotId, card: slidCard.card });

    state.caboSnapGapPending!.delete(currentPlayerId);
    logAction(state, currentPlayerId, 'cabo:slide', `slid one of their cards into ${nameOf(state, opponentId)}'s hand`, [slidSlotId]);

    emitToPlayer(io, state, currentPlayerId, 'cabo:hand', mySlots);
    emitToPlayer(io, state, opponentId, 'cabo:hand', opponentSlots);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('cabo:snapSlideDecline', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    state.caboSnapGapPending?.delete(currentPlayerId);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('cabo:ackNextRound', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.config.gameMode !== 'cabo') return ack({ error: 'Not a Cabo game' });
    if (state.phase !== 'between-rounds') return ack({ error: 'Not between rounds' });
    state.betweenRoundAckByPlayer.add(currentPlayerId);
    autoAckDisconnected(state, state.betweenRoundAckByPlayer);
    maybeCaboAdvanceRound(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('cabo:ackRematch', (_: {}, ack: (res: any) => void) => {
    const state = getState()!;
    if (state.phase !== 'rematch-pending') return ack({ error: 'Not in rematch phase' });
    state.rematchAckByPlayer.add(currentPlayerId!);
    settleReadiness(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('cabo:leaveGame', (_: {}, ack: (res: any) => void) => handleLeaveGame(ack));

  socket.on('cabo:kickPlayer', kickPlayer);

  // ---- Teen Patti actions ----
  // The middleware already gates tp: events to this mode and gameplay ones to
  // the play phase; each handler checks the seat, the turn and the move.

  function tpSeatError(state: GameState, pid: string, needTurn: boolean): string | null {
    if (!state.tpCoins || state.phase !== 'play') return 'Cannot act in this phase';
    if (!state.tpInHand?.includes(pid) || state.tpPacked?.has(pid)) return 'You are not in this hand';
    if (needTurn && state.tpSideShow) return 'Waiting for a side-show answer';
    if (needTurn && state.tpTurn !== pid) return 'Not your turn';
    return null;
  }

  socket.on('tp:see', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    const err = tpSeatError(state, currentPlayerId, false);
    if (err) return ack({ error: err });
    if (state.tpSeen!.has(currentPlayerId)) return ack({ error: 'You have already seen your cards' });
    state.tpSeen!.add(currentPlayerId);
    logAction(state, currentPlayerId, 'tp:see', 'looked at their cards');
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('tp:bet', (payload: { double?: boolean }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    const err = tpSeatError(state, currentPlayerId, true);
    if (err) return ack({ error: err });
    const options = tpOptionsFor(state, currentPlayerId)!;
    if (options.mustSee) return ack({ error: 'Blind limit reached: look at your cards first', code: 'MUST_SEE' });
    const bet = options.bets.find((b) => b.double === (payload.double === true));
    if (!bet) return ack({ error: 'That bet is not available' });

    const seen = state.tpSeen!.has(currentPlayerId);
    tpPay(state, currentPlayerId, bet.amount);
    if (!seen) state.tpBlindTurns!.set(currentPlayerId, (state.tpBlindTurns!.get(currentPlayerId) ?? 0) + 1);
    logAction(state, currentPlayerId, 'tp:bet', seen
      ? (bet.double ? `raised to ${bet.amount}` : `played chaal for ${bet.amount}`)
      : (bet.double ? `bet ${bet.amount} blind, doubling the stake` : `bet ${bet.amount} blind`));
    if (state.tpPot! >= tpInfo(state).potLimit) {
      tpFinishHand(state, 'pot-limit');
    } else {
      state.tpStake = tpNextStake(seen, bet.amount);
      state.tpTurn = tpNextActive(state, currentPlayerId);
    }
    broadcastSnapshot(io, state);
    ack({ ok: true, amount: bet.amount });
  });

  socket.on('tp:pack', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    const err = tpSeatError(state, currentPlayerId, true);
    if (err) return ack({ error: err });
    state.tpPacked!.add(currentPlayerId);
    logAction(state, currentPlayerId, 'tp:pack', 'packed');
    if (tpActive(state).length === 1) tpFinishHand(state, 'packed');
    else state.tpTurn = tpNextActive(state, currentPlayerId);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('tp:show', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    const err = tpSeatError(state, currentPlayerId, true);
    if (err) return ack({ error: err });
    const options = tpOptionsFor(state, currentPlayerId)!;
    if (!options.show) {
      return ack({ error: tpActive(state).length !== 2 ? 'A show needs exactly two players left' : 'A seen player cannot ask a blind player for a show' });
    }
    const other = tpActive(state).find((p) => p !== currentPlayerId)!;
    tpPay(state, currentPlayerId, options.show.cost);
    logAction(state, currentPlayerId, 'tp:show', `paid ${options.show.cost} for a show`);
    // Higher hand wins; on a tie the player who did NOT pay for the show wins.
    const cmp = compareTp(state.tpCards!.get(currentPlayerId)!, state.tpCards!.get(other)!);
    tpFinishHand(state, 'show', { winner: cmp > 0 ? currentPlayerId : other, shown: [currentPlayerId, other] });
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('tp:sideShow', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    const err = tpSeatError(state, currentPlayerId, true);
    if (err) return ack({ error: err });
    const options = tpOptionsFor(state, currentPlayerId)!;
    if (!options.sideShow) return ack({ error: 'A side show is not available right now' });
    const { cost, target } = options.sideShow;
    tpPay(state, currentPlayerId, cost); // the minimum chaal; the stake is unchanged
    state.tpSideShow = { from: currentPlayerId, to: target };
    logAction(state, currentPlayerId, 'tp:side-show', `played chaal for ${cost} and asked ${nameOf(state, target)} for a side show`);
    if (!state.players.get(target)?.connected) tpResolveSideShow(state, false);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('tp:sideShowAnswer', (payload: { accept?: boolean }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.tpSideShow?.to !== currentPlayerId) return ack({ error: 'Nobody asked you for a side show' });
    tpResolveSideShow(state, payload.accept === true);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('tp:refill', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (!state.tpCoins) return ack({ error: 'Not a Teen Patti game' });
    const options = tpOptionsFor(state, currentPlayerId)!;
    const { start, potLimit } = tpInfo(state);
    if (!options.canRefill) {
      return ack({ error: tpCoinsOf(state, currentPlayerId) >= potLimit ? `You still have enough coins (${potLimit} needed to be dealt in)` : 'Refill between hands' });
    }
    const added = start - tpCoinsOf(state, currentPlayerId);
    state.tpCoins.set(currentPlayerId, start);
    state.tpRefills!.set(currentPlayerId, (state.tpRefills!.get(currentPlayerId) ?? 0) + 1);
    state.tpGranted!.set(currentPlayerId, (state.tpGranted!.get(currentPlayerId) ?? start) + added);
    // Keep this hand's coin change honest for a seat that refilled mid-hand.
    if (state.tpStartCoins?.has(currentPlayerId)) state.tpStartCoins.set(currentPlayerId, state.tpStartCoins.get(currentPlayerId)! + added);
    logAction(state, currentPlayerId, 'tp:refill', `refilled to ${start} play coins`);
    maybeTpAdvance(state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('tp:ackNextHand', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.phase !== 'between-rounds') return ack({ error: 'Not between hands' });
    state.betweenRoundAckByPlayer.add(currentPlayerId);
    autoAckDisconnected(state, state.betweenRoundAckByPlayer);
    maybeTpAdvance(state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('tp:ackRematch', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.phase !== 'rematch-pending') return ack({ error: 'Not in rematch phase' });
    state.rematchAckByPlayer.add(currentPlayerId);
    settleReadiness(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('tp:leaveGame', (_: {}, ack: (res: any) => void) => handleLeaveGame(ack));

  socket.on('tp:kickPlayer', kickPlayer);

  // ---- Leaderboard ----
  socket.on('getLeaderboard', (_: {}, ack: (res: any) => void) => {
    const sorted = [...globalLeaderboard]
      .sort((a, b) => a.totalScore - b.totalScore)
      .map((entry, index) => ({
        rank: index + 1,
        displayName: entry.displayName,
        totalScore: entry.totalScore,
        gamesPlayed: entry.gamesPlayed,
      }));
    ack({ leaderboard: sorted });
  });

  // ---- Classic mode (preserved) ----
  socket.on('playCard', (payload: { cardId: string }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    const hand = state.hands.get(currentPlayerId) || [];
    const idx = hand.findIndex((c) => c.cardId === payload.cardId);
    if (idx === -1) return ack({ error: 'Card not in hand' });
    const [card] = hand.splice(idx, 1);
    state.centerPile.push(card);
    state.hands.set(currentPlayerId, hand);
    emitToPlayer(io, state, currentPlayerId, 'hand:update', hand);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('drawCard', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    const card = state.extraDeck.pop();
    if (!card) return ack({ error: 'No cards left' });
    const hand = state.hands.get(currentPlayerId) || [];
    hand.push(card);
    state.hands.set(currentPlayerId, hand);
    emitToPlayer(io, state, currentPlayerId, 'hand:update', hand);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  // ---- Disconnect ----
  socket.on('disconnect', () => {
    const state = getState();
    if (!state || !currentPlayerId) return;
    const player = state.players.get(currentPlayerId)!;
    player.connected = false;
    player.disconnectedAt = Date.now();
    const departedAt = player.disconnectedAt;
    state.peekAckByPlayer?.add(player.playerId); state.caboPeekAckByPlayer?.add(player.playerId);
    state.betweenRoundAckByPlayer.add(player.playerId); state.rematchAckByPlayer.add(player.playerId);
    if (state.tpSideShow?.to === player.playerId) tpResolveSideShow(state, false);
    if (state.hostId === player.playerId) {
      const next = humanPlayers(state).find(p => p.connected);
      if (next) { state.hostId = next.playerId; state.notice = `${next.displayName} is now the host.`; }
    }
    settleReadiness(io, state);
    broadcastSnapshot(io, state);
    setTimeout(() => {
      if (!games.has(state.gameId) || player.connected || player.disconnectedAt !== departedAt) return;
      // Only another *human* keeps the room going; a solo player with bots
      // keeps their seat until they return (or the reaper's TTL expires).
      if (humanPlayers(state).some(p => p.connected)) removePlayer(io, state, player.playerId);
    }, DISCONNECT_GRACE_MS).unref();
  });
}

// ---------- bots ----------
// A bot is an ordinary seat whose "browser" is a BotSocket: an in-process
// stand-in for a socket.io connection. attachSocketHandlers() registers the
// same middleware and handlers on it as on a real socket, so a bot can only do
// what a player can do (turn checks, phase checks, privacy all apply) and it
// only learns what a player in its seat would see: game:update, game:private
// and its own power results, routed to it by emitToPlayer(). No game rules are
// duplicated here — just a small strategy that picks the next request.
//
// Bots act on a short timer so humans can follow along, hold still while no
// human is connected, and are removed with the room (they never keep one alive).

const BOT_NAMES = ['Ada', 'Milo', 'Juno', 'Rex', 'Pip', 'Nova', 'Ziggy', 'Lulu'];
const BOT_STEP_MS = Math.max(10, Number(process.env.BOT_STEP_MS) || 900);
const GOLF_UNSEEN_EV = 75 / 13; // average Golf value of a card we have not seen
const CABO_UNSEEN_EV = 6;       // average Cabo value of a card we have not seen
const botSockets = new Map<string, BotSocket>(); // BotSocket.id -> bot

function disposeBot(socketId: string): void {
  botSockets.get(socketId)?.dispose();
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function addBotToGame(state: GameState): { ok: true; playerId: string } | { error: string } {
  const taken = new Set(Array.from(state.players.values()).map((p) => p.displayName));
  const free = BOT_NAMES.map((n) => `Bot ${n}`).filter((n) => !taken.has(n));
  const bot = new BotSocket();
  botSockets.set(bot.id, bot);
  attachSocketHandlers(bot as unknown as Socket);
  // Joins through the public joinGame handler, exactly like a browser would.
  let res: any = null;
  bot.send('joinGame', { code: state.code, displayName: free.length ? pick(free) : 'Bot' }, (r) => { res = r; });
  const player = res?.playerId ? state.players.get(res.playerId) : undefined;
  if (!player) { bot.dispose(); return { error: res?.error ?? 'Could not add a bot' }; }
  player.isBot = true;
  bot.playerId = player.playerId;
  broadcastSnapshot(io, state);
  return { ok: true, playerId: player.playerId };
}

type BotMove = { event: string; payload: Record<string, unknown>; onOk?: () => void };

// Golf estimate: known cards scored exactly (pairs, Kings…), unseen cards at average value.
function golfEstimate(cards: Array<Card | null>): number {
  const seen = cards.filter((c): c is Card => !!c);
  return calculateGolfScore(seen.map((card) => ({ slotId: '', card, revealed: true, locked: true })))
    + (cards.length - seen.length) * GOLF_UNSEEN_EV;
}

class BotSocket {
  readonly id = `bot:${nanoPlayerId()}`;
  playerId: string | null = null;
  private handlers = new Map<string, (...args: any[]) => void>();
  private middleware: Array<(packet: any[], next: (err?: Error) => void) => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private failures = 0;
  private snapshot: GameSnapshot | null = null;
  private priv: PrivateGameState | null = null;
  private known = new Map<string, Card>(); // own hidden cards this seat has legitimately seen
  private memoryKey = '';
  private lastSeq = 0;
  private turnsThisRound = 0;
  private tpBlindBets = 0;

  // -- the slice of socket.io's Socket that attachSocketHandlers() uses --
  use(fn: (packet: any[], next: (err?: Error) => void) => void) { this.middleware.push(fn); return this; }
  on(event: string, fn: (...args: any[]) => void) { this.handlers.set(event, fn); return this; }
  join() { /* rooms are unused: emitToPlayer() routes to bots directly */ }
  leave() { /* see join() */ }
  emit() { return true; }
  disconnect() { return this; }

  // Client -> server: run the middleware chain, then the handler — as socket.io would.
  send(event: string, payload: Record<string, unknown>, ack: (res: any) => void = () => {}): void {
    const packet: any[] = [event, payload, ack];
    const run = (i: number): void => {
      if (i < this.middleware.length) { this.middleware[i](packet, (err) => { if (!err) run(i + 1); }); return; }
      const handler = this.handlers.get(event);
      if (!handler) { ack({ error: `Unknown event ${event}` }); return; }
      handler(...packet.slice(1));
    };
    try { run(0); } catch (err) {
      console.error(`[bot] ${event} threw`, err);
      ack({ error: 'Bot action failed' });
    }
  }

  // Server -> client: everything emitToPlayer() sends to this seat.
  receive(event: string, payload: any): void {
    if (this.disposed) return;
    if (event === 'game:update') {
      this.snapshot = payload as GameSnapshot;
      const action = this.snapshot.lastAction;
      if (action && action.seq !== this.lastSeq) {
        this.lastSeq = action.seq;
        // A rival's Jack/Queen or Black King swap replaced one of our cards with one we have not seen.
        if (action.actorId !== this.playerId && (action.kind === 'cabo:blind-swap' || action.kind === 'cabo:king-swap')) {
          for (const id of action.slotIds) this.known.delete(id);
        }
      }
    } else if (event === 'game:private') {
      const priv = payload as PrivateGameState;
      const key = `${priv.gameId}:${priv.matchNumber}:${priv.round}`;
      if (key !== this.memoryKey) { this.memoryKey = key; this.known.clear(); this.turnsThisRound = 0; this.tpBlindBets = 0; }
      this.priv = priv;
      // Remember any own card the server chose to show us (the opening peek).
      for (const s of priv.golfSlots) if (s.card && !s.locked) this.known.set(s.slotId, s.card);
      for (const s of priv.caboSlots) if (s.card) this.known.set(s.slotId, s.card);
    } else if (event === 'cabo:peekResult') {
      this.known.set(payload.slotId, payload.card);
      return;
    } else {
      return; // golf:hand / cabo:hand / results: the private state above already carries them
    }
    this.schedule();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    botSockets.delete(this.id);
  }

  private schedule(): void {
    if (this.disposed || this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.act(); }, BOT_STEP_MS * (0.75 + Math.random() * 0.5));
    this.timer.unref?.();
  }

  private act(): void {
    const g = this.snapshot, priv = this.priv, me = this.playerId;
    if (this.disposed || !g || !priv || !me) return;
    // Nobody watching (the only human locked their phone): hold the table as it is.
    if (!g.players.some((p) => !p.isBot && p.connected)) return;
    const move = this.decide(g, priv, me);
    if (!move) return;
    this.send(move.event, move.payload, (res) => {
      if (res?.error) {
        // Retry with fresher state; after two misses decide() falls back to the plainest legal move.
        this.failures++;
        console.warn(`[bot] ${me} ${move.event} rejected: ${res.error}`);
        if (this.failures <= 4) this.schedule();
        return;
      }
      this.failures = 0;
      move.onOk?.();
    });
  }

  private decide(g: GameSnapshot, priv: PrivateGameState, me: string): BotMove | null {
    const mode = g.config.gameMode;
    const golf = mode === 'golf';
    const tp = mode === 'teenpatti';
    const prefix = golf ? 'golf' : tp ? 'tp' : 'cabo';
    // Teen Patti: a bot that can't cover the pot limit refills before anything else.
    if (tp && priv.tpOptions?.canRefill) return { event: 'tp:refill', payload: {} };
    if (g.phase === 'peek') {
      const acks = golf ? g.golf?.peekAcks : g.cabo?.peekAcks;
      return acks?.includes(me) ? null : { event: `${prefix}:ackPeek`, payload: {} };
    }
    if (g.phase === 'between-rounds') {
      return g.betweenRoundAcks?.includes(me) ? null : { event: tp ? 'tp:ackNextHand' : `${prefix}:ackNextRound`, payload: {} };
    }
    if (g.phase === 'rematch-pending') {
      return g.rematchAcks?.includes(me) ? null : { event: `${prefix}:ackRematch`, payload: {} };
    }
    if ((g.phase === 'play' || g.phase === 'cabo-called') && !g.paused) {
      if (tp) return this.tpMove(g, priv);
      if (golf && g.golf?.turn === me) return this.golfMove(g, priv, me);
      if (!golf && g.cabo?.turn === me) return this.caboMove(g, priv, me);
    }
    return null;
  }

  // Teen Patti: strength = share of all 22,100 hands this one beats (a pair
  // already beats ~75%). Pack weak hands as the stake climbs, raise strong
  // ones, bluff now and then, and play blind for a turn or two while cheap.
  private tpMove(g: GameSnapshot, priv: PrivateGameState): BotMove | null {
    const table = g.tp;
    const options = priv.tpOptions;
    if (!table || !options) return null;
    const cards = priv.tpCards;
    if (priv.tpSideShowAsk) {
      return { event: 'tp:sideShowAnswer', payload: { accept: !!cards && tpStrength(cards) >= 0.6 } };
    }
    if (!options.myTurn) return null;
    const pressure = Math.log2(Math.max(1, table.stake / table.boot)); // +1 per doubling of the stake
    const minBet = options.bets.find((b) => !b.double);
    const raise = options.bets.find((b) => b.double);
    if (!cards) {
      const lookNow = options.mustSee || pressure >= 2 || this.tpBlindBets >= 1 + Math.floor(Math.random() * 2);
      if (lookNow || !minBet) return { event: 'tp:see', payload: {} };
      if (options.show && pressure >= 1 && Math.random() < 0.25) return { event: 'tp:show', payload: {} };
      return { event: 'tp:bet', payload: { double: !!raise && Math.random() < 0.15 }, onOk: () => { this.tpBlindBets++; } };
    }
    const strength = tpStrength(cards);
    const left = table.seats.filter((x) => x.inHand && !x.packed).length;
    const packBelow = Math.min(0.75, 0.3 + 0.08 * pressure + 0.04 * Math.max(0, left - 2));
    const bluff = Math.random() < 0.08;
    if (strength < packBelow && !bluff) return { event: 'tp:pack', payload: {} };
    if (options.show && (strength >= 0.7 || pressure >= 3)) return { event: 'tp:show', payload: {} };
    if (options.sideShow && strength >= 0.45 && strength < 0.85 && Math.random() < 0.35) return { event: 'tp:sideShow', payload: {} };
    if (raise && (strength >= 0.9 || bluff)) return { event: 'tp:bet', payload: { double: true } };
    if (minBet) return { event: 'tp:bet', payload: { double: false } };
    return { event: 'tp:pack', payload: {} };
  }

  private golfMove(g: GameSnapshot, priv: PrivateGameState, me: string): BotMove | null {
    const hand = g.golf?.hands.find((h) => h.playerId === me);
    if (!hand) return null;
    const own = hand.slots.map((s) => ({ slotId: s.slotId, locked: s.locked, card: s.card ?? this.known.get(s.slotId) ?? null }));
    const open = own.filter((s) => !s.locked);
    if (!open.length) return null;
    const safe = this.failures >= 2;
    const estimate = (slotId?: string, card?: Card) => golfEstimate(own.map((s) => (s.slotId === slotId ? card! : s.card)));
    const baseline = estimate();
    const bestSlotFor = (card: Card) => open
      .map((s) => ({ slotId: s.slotId, score: estimate(s.slotId, card) }))
      .sort((a, b) => a.score - b.score)[0];

    const drawn = priv.pendingDraw;
    if (drawn) {
      const best = bestSlotFor(drawn);
      if (!safe && best.score < baseline - 0.5) return { event: 'golf:acceptDrawAndSwap', payload: { slotId: best.slotId } };
      // Keep the drawn card out and lock a slot as it is: a card we know is good,
      // else gamble on one we have not seen, else our least-bad known card.
      const ranks = own.filter((s) => s.card).map((s) => s.card!.rank);
      const flip = open.find((s) => s.card && (rankPointValue(s.card.rank) <= 3 || ranks.filter((r) => r === s.card!.rank).length > 1))
        ?? open.find((s) => !s.card)
        ?? [...open].sort((a, b) => rankPointValue(a.card!.rank) - rankPointValue(b.card!.rank))[0];
      return { event: 'golf:rejectDrawAndReveal', payload: { slotId: flip.slotId } };
    }
    const top = g.discardTop;
    if (top) {
      const best = bestSlotFor(top);
      if (safe || best.score <= baseline - 3) return { event: 'golf:swapWithDiscard', payload: { slotId: best.slotId } };
    }
    return { event: 'golf:draw', payload: {} };
  }

  private caboMove(g: GameSnapshot, priv: PrivateGameState, me: string): BotMove | null {
    const ownIds = priv.caboSlots.map((s) => s.slotId);
    for (const id of Array.from(this.known.keys())) if (!ownIds.includes(id)) this.known.delete(id);
    const value = (id: string) => { const c = this.known.get(id); return c ? caboCardValue(c) : CABO_UNSEEN_EV; };
    const worst: string | undefined = [...ownIds].sort((a, b) => value(b) - value(a))[0]; // our best slot to replace
    const unseen = ownIds.filter((id) => !this.known.has(id));
    const total = ownIds.reduce((sum, id) => sum + value(id), 0);
    const rivals = (g.cabo?.hands ?? []).filter((h) => h.playerId !== me && h.slots.length > 0);
    const rivalSlot = () => { const h = pick(rivals); return { targetPlayerId: h.playerId, targetSlotId: pick(h.slots).slotId }; };
    const safe = this.failures >= 2;

    const king = priv.blackKing;
    if (king) {
      if (!safe && worst && value(worst) - caboCardValue(king.card) >= 2) {
        return { event: 'cabo:blackKingDecide', payload: { swap: true, ownSlotId: worst }, onOk: () => this.known.set(worst, king.card) };
      }
      return { event: 'cabo:blackKingDecide', payload: { swap: false } };
    }

    const drawn = priv.caboPendingDraw;
    if (drawn) {
      if (safe) return { event: 'cabo:discardDrawn', payload: {} };
      if (worst && value(worst) - caboCardValue(drawn) >= 2) {
        return { event: 'cabo:placeDrawn', payload: { slotId: worst }, onOk: () => this.known.set(worst, drawn) };
      }
      const power = getCaboSpecialAction(drawn);
      if (power === 'peek-own' && unseen.length) {
        return { event: 'cabo:useSpecialPower', payload: { action: 'peek-own', ownSlotId: unseen[0] } };
      }
      if (rivals.length && power === 'spy') {
        return { event: 'cabo:useSpecialPower', payload: { action: 'spy', ...rivalSlot() } };
      }
      if (rivals.length && power === 'black-king-see') {
        return { event: 'cabo:useSpecialPower', payload: { action: 'black-king-see', ...rivalSlot() } };
      }
      if (rivals.length && power === 'blind-swap') {
        const high = ownIds.filter((id) => this.known.has(id) && value(id) >= 8).sort((a, b) => value(b) - value(a))[0];
        if (high) {
          return { event: 'cabo:useSpecialPower', payload: { action: 'blind-swap', ownSlotId: high, ...rivalSlot() }, onOk: () => this.known.delete(high) };
        }
      }
      return { event: 'cabo:discardDrawn', payload: {} };
    }

    // Start of our turn. Call Cabo once the hand looks low enough; the bar
    // drops as the round drags on, so a round with bots always ends.
    const patience = Math.max(0, this.turnsThisRound - 3);
    const confident = unseen.length <= 1 || this.turnsThisRound >= 8;
    if (!safe && g.phase === 'play' && ((confident && total <= 4 + patience * 1.5) || this.turnsThisRound >= 14)) {
      return { event: 'cabo:callCabo', payload: {} };
    }
    const top = g.discardTop;
    if (top && worst && (safe || (caboCardValue(top) <= 3 && value(worst) - caboCardValue(top) >= 3))) {
      return { event: 'cabo:takeDiscard', payload: { slotId: worst }, onOk: () => { this.known.set(worst, top); this.turnsThisRound++; } };
    }
    return { event: 'cabo:draw', payload: {}, onOk: () => { this.turnsThisRound++; } };
  }
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});

// Periodically free games everyone has abandoned. unref() so the timer never
// keeps the process alive on its own.
const reaper = setInterval(() => {
  const removed = reapStaleGames();
  if (removed > 0) console.log(`Reaped ${removed} abandoned game(s)`);
}, REAP_INTERVAL_MS);
reaper.unref();
