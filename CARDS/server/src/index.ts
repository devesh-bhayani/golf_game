import express from 'express';
import http from 'http';
import cors from 'cors';
import { Server } from 'socket.io';
import { customAlphabet } from 'nanoid';

type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

type Card = {
  cardId: string;
  suit: Suit;
  rank: Rank;
  color: 'red' | 'black';
  value: number;
};

type Player = {
  playerId: string;
  playerToken: string;
  currentSocketId: string;
  displayName: string;
  connected: boolean;
  disconnectedAt?: number;
};

type GameMode = 'classic' | 'golf' | 'cabo';

type GamePhase =
  | 'waiting'
  | 'peek'
  | 'play'
  | 'cabo-called'
  | 'between-rounds'
  | 'ended'
  | 'rematch-pending';

type GameConfig = {
  maxPlayers: number;
  totalCardsPerDeck: number;
  numberOfDecks: number;
  cardsPerPlayer: number;
  gameMode?: GameMode;
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
  caboRoundScores?: Map<string, number[]>;
  caboCumulativeScores?: Map<string, number>;
  caboPendingDraw?: Map<string, Card>;
  caboBlackKingPending?: Map<string, { targetPlayerId: string; targetSlotId: string }>;
  caboSnapGapPending?: Map<string, string>; // snapperId -> opponentId
  caboLeaderboard?: Array<{ playerId: string; displayName: string; score: number; rank: number }>;
};

const nano4 = customAlphabet('0123456789', 4);
const nanoToken = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 32);
const nanoPlayerId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

const codeToGameId = new Map<string, string>();
const games = new Map<string, GameState>();
const tokenIndex = new Map<string, { gameId: string; playerId: string }>();
const globalLeaderboard: Array<{ playerId: string; displayName: string; totalScore: number; gamesPlayed: number }> = [];

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

function dealCards(state: GameState): void {
  const playerIds = Array.from(state.players.keys());
  const numPlayers = playerIds.length;
  const cardsPerPlayer = state.config.cardsPerPlayer;
  state.hands = new Map<string, Card[]>(playerIds.map((p) => [p, []]));
  const fullDeck = createDecks(state.config.numberOfDecks, state.gameId);
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

  const fullDeck = createDecks(state.config.numberOfDecks, state.gameId);

  state.golfHands = new Map<string, GolfSlot[]>();
  state.turnOrder = playerIds;
  state.currentTurnIndex = 1 % numPlayers;
  state.peekAckByPlayer = new Set<string>();
  state.peekPhaseActive = true;
  state.phase = 'peek';
  state.pendingDrawByPlayer = new Map<string, Card>();

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

function calculateGolfScore(slots: GolfSlot[]): number {
  const cards = slots.map((s) => s.card);

  const kingCount = cards.filter((c) => c.rank === 'K').length;
  let kingScore = 0;
  if (kingCount === 1) kingScore = 0;
  else if (kingCount === 2) kingScore = -5;
  else if (kingCount === 3) kingScore = -10;
  else if (kingCount === 4) kingScore = -20;

  const nonKings = cards.filter((c) => c.rank !== 'K');
  const counts: Record<string, number> = {};
  for (const c of nonKings) counts[c.rank] = (counts[c.rank] || 0) + 1;

  let nonKingScore = 0;
  for (const rank of Object.keys(counts)) {
    const n = counts[rank];
    const v = rankPointValue(rank as Rank);
    if (n >= 4) {
      nonKingScore += -20 + (n - 4) * v;
    } else if (n === 3) {
      nonKingScore += 0;
    } else if (n === 2) {
      nonKingScore += 0;
    } else {
      nonKingScore += v;
    }
  }

  return kingScore + nonKingScore;
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

  const fullDeck = createDecks(state.config.numberOfDecks, state.gameId);

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

function caboEndTurn(io: Server, state: GameState): void {
  if (!state.caboTurnOrder) return;
  const numPlayers = state.caboTurnOrder.length;

  if (state.phase === 'cabo-called') {
    let remaining = (state.caboFinalTurnsLeft ?? 0) - 1;

    if (remaining <= 0) {
      state.caboFinalTurnsLeft = 0;
      finalizeCaboRound(io, state);
      return;
    }

    let idx = state.caboCurrentTurnIndex ?? 0;
    for (let i = 0; i < numPlayers; i++) {
      idx = (idx + 1) % numPlayers;
      const pid = state.caboTurnOrder[idx];
      if (pid === state.caboCallerId) continue;
      const player = state.players.get(pid);
      if (!player?.connected) {
        remaining--;
        if (remaining <= 0) {
          state.caboCurrentTurnIndex = idx;
          state.caboFinalTurnsLeft = 0;
          finalizeCaboRound(io, state);
          return;
        }
        continue;
      }
      state.caboCurrentTurnIndex = idx;
      state.caboFinalTurnsLeft = remaining;
      return;
    }
    state.caboFinalTurnsLeft = 0;
    finalizeCaboRound(io, state);
  } else {
    state.caboCurrentTurnIndex = ((state.caboCurrentTurnIndex ?? 0) + 1) % numPlayers;
  }
}

function finalizeCaboRound(io: Server, state: GameState): void {
  if (!state.caboHands || !state.caboRoundScores || !state.caboCumulativeScores) return;

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

  state.rematchAckByPlayer = new Set();
  autoAckDisconnected(state, state.rematchAckByPlayer);
}

function maybeCaboAdvanceRound(io: Server, state: GameState): void {
  if (state.phase !== 'between-rounds') return;
  const required = Array.from(state.players.values()).filter((p) => p.connected).map((p) => p.playerId);
  if (required.length === 0) return;
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
  state.currentRound = 1;
  state.caboRoundScores = new Map(Array.from(state.players.keys()).map((pid) => [pid, []]));
  state.caboCumulativeScores = new Map(Array.from(state.players.keys()).map((pid) => [pid, 0]));
  state.betweenRoundAckByPlayer = new Set();
  state.rematchAckByPlayer = new Set();
  dealCaboRound(state);
}

// ---------- shared helpers ----------

function emitToPlayer(io: Server, state: GameState, playerId: string, event: string, payload: any) {
  const p = state.players.get(playerId);
  if (p && p.currentSocketId) io.to(p.currentSocketId).emit(event, payload);
}

function broadcastSnapshot(io: Server, state: GameState) {
  for (const pid of state.players.keys()) {
    emitToPlayer(io, state, pid, 'game:update', publicGameSnapshot(state, pid));
  }
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
    finalizeGame(state);
  }
}

function maybeAdvanceRound(io: Server, state: GameState) {
  if (state.phase !== 'between-rounds') return;
  const required = Array.from(state.players.values()).filter((p) => p.connected).map((p) => p.playerId);
  if (required.length === 0) return;
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

  state.rematchAckByPlayer = new Set();
  autoAckDisconnected(state, state.rematchAckByPlayer);
}

function resetForRematch(state: GameState) {
  state.status = 'active';
  state.scores = undefined;
  state.leaderboard = undefined;
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
    })),
    centerPile: state.centerPile,
    extraDeckCount: state.extraDeck.length,
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

io.on('connection', (socket) => {
  let currentGameId: string | null = null;
  let currentPlayerId: string | null = null;

  function getState(): GameState | null {
    if (!currentGameId) return null;
    return games.get(currentGameId) ?? null;
  }

  socket.on('createGame', (payload: { displayName?: string; config: GameConfig }, ack: (res: any) => void) => {
    const gameId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    let code = nano4();
    while (codeToGameId.has(code)) code = nano4();
    const config = payload.config;

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
      displayName: payload.displayName || 'Host',
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
    const gameId = codeToGameId.get(payload.code);
    if (!gameId) return ack({ error: 'Invalid code' });
    const state = games.get(gameId);
    if (!state) return ack({ error: 'Game not found' });
    if (state.status !== 'waiting') return ack({ error: 'Game in progress' });
    if (state.players.size >= state.config.maxPlayers) return ack({ error: 'Game full' });

    const playerId = nanoPlayerId();
    const playerToken = nanoToken();
    const player: Player = {
      playerId,
      playerToken,
      currentSocketId: socket.id,
      displayName: payload.displayName || `Player ${state.players.size + 1}`,
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

    player.currentSocketId = socket.id;
    player.connected = true;
    player.disconnectedAt = undefined;

    currentGameId = state.gameId;
    currentPlayerId = player.playerId;
    socket.join(state.gameId);

    broadcastSnapshot(io, state);
    if (state.config.gameMode === 'golf' && state.golfHands) {
      io.to(socket.id).emit('golf:hand', state.golfHands.get(player.playerId));
      const pendingCard = state.pendingDrawByPlayer.get(player.playerId);
      if (pendingCard) io.to(socket.id).emit('golf:pendingDraw', pendingCard);
    } else if (state.config.gameMode === 'cabo' && state.caboHands) {
      io.to(socket.id).emit('cabo:hand', state.caboHands.get(player.playerId) ?? []);
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
    if (state.players.size < 2) return ack({ error: 'Need at least 2 players' });
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

  // ---- Golf actions ----

  socket.on('golf:ackPeek', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (!state.golfHands) return ack({ error: 'Not a golf game' });
    const slots = state.golfHands.get(currentPlayerId);
    if (!slots) return ack({ error: 'No hand' });
    for (const s of slots) {
      if (s.peekOnly) {
        s.revealed = false;
        s.peekOnly = false;
      }
    }
    if (!state.peekAckByPlayer) state.peekAckByPlayer = new Set();
    state.peekAckByPlayer.add(currentPlayerId);
    for (const [pid, p] of state.players) if (!p.connected) state.peekAckByPlayer.add(pid);

    if (state.peekAckByPlayer.size === state.players.size) {
      for (const slotsOfPlayer of state.golfHands.values()) {
        for (const s of slotsOfPlayer) {
          if (s.peekOnly) { s.peekOnly = false; s.revealed = false; }
        }
      }
      state.peekPhaseActive = false;
      state.phase = 'play';
    }

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
    if (state.extraDeck.length === 0) reshuffleDrawPile(state);
    const card = state.extraDeck.pop();
    if (!card) return ack({ error: 'No cards left' });
    state.pendingDrawByPlayer.set(currentPlayerId, card);
    broadcastSnapshot(io, state);
    ack({ ok: true, card });
  });

  socket.on('golf:acceptDrawAndSwap', (payload: { slotId: string }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (!state.golfHands || !state.discardPile) return ack({ error: 'Not a golf game' });
    if (state.phase !== 'play') return ack({ error: 'Cannot act in this phase' });
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
    const card = state.pendingDrawByPlayer.get(currentPlayerId);
    if (!card) return ack({ error: 'No pending card' });

    const slots = state.golfHands.get(currentPlayerId)!;
    const slot = slots.find((s) => s.slotId === payload.slotId);
    if (!slot || slot.locked) return ack({ error: 'Invalid slot' });

    state.discardPile.push(card);
    slot.revealed = true;
    slot.locked = true;
    state.pendingDrawByPlayer.delete(currentPlayerId);

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

  socket.on('golf:kickPlayer', (payload: { playerId: string }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.hostId !== currentPlayerId) return ack({ error: 'Only host can kick' });
    const target = state.players.get(payload.playerId);
    if (!target) return ack({ error: 'Player not found' });
    if (target.connected) return ack({ error: 'Player is connected' });
    if (!target.disconnectedAt || Date.now() - target.disconnectedAt < 30_000) {
      return ack({ error: 'Grace period not elapsed' });
    }

    if (state.golfHands) {
      const slots = state.golfHands.get(target.playerId);
      if (slots) {
        for (const s of slots) {
          if (!s.locked) { s.revealed = true; s.locked = true; }
        }
      }
    }

    if (state.turnOrder && state.turnOrder[state.currentTurnIndex || 0] === target.playerId) {
      advanceTurn(state);
    }

    state.peekAckByPlayer?.add(target.playerId);
    state.betweenRoundAckByPlayer.add(target.playerId);
    state.rematchAckByPlayer.add(target.playerId);

    checkRoundEnd(io, state);
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('golf:ackRematch', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.phase !== 'rematch-pending') return ack({ error: 'Not in rematch phase' });
    state.rematchAckByPlayer.add(currentPlayerId);
    autoAckDisconnected(state, state.rematchAckByPlayer);

    const required = Array.from(state.players.values()).filter((p) => p.connected).map((p) => p.playerId);
    const allAck = required.length > 0 && required.every((pid) => state.rematchAckByPlayer.has(pid));
    if (allAck) {
      resetForRematch(state);
      broadcastSnapshot(io, state);
      for (const pid of state.players.keys()) {
        emitToPlayer(io, state, pid, 'golf:hand', state.golfHands!.get(pid));
      }
    } else {
      broadcastSnapshot(io, state);
    }
    ack({ ok: true });
  });

  socket.on('golf:leaveGame', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.phase !== 'waiting' && state.phase !== 'rematch-pending') {
      return ack({ error: 'Cannot leave mid-game; disconnect to stop playing' });
    }
    const player = state.players.get(currentPlayerId);
    if (!player) return ack({ error: 'Player not found' });

    state.players.delete(currentPlayerId);
    tokenIndex.delete(player.playerToken);

    if (state.hostId === currentPlayerId) {
      const next = Array.from(state.players.keys())[0];
      if (next) state.hostId = next;
    }
    if (state.players.size === 0) {
      codeToGameId.delete(state.code);
      games.delete(state.gameId);
    }

    socket.leave(state.gameId);
    currentGameId = null;
    currentPlayerId = null;

    if (games.has(state.gameId)) broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  socket.on('golf:updateConfig', (payload: { cardsPerPlayer: number }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.hostId !== currentPlayerId) return ack({ error: 'Host only' });
    if (state.phase !== 'rematch-pending') return ack({ error: 'Only allowed before rematch' });
    if (![4, 6, 8].includes(payload.cardsPerPlayer)) return ack({ error: 'Invalid cardsPerPlayer' });
    state.config.cardsPerPlayer = payload.cardsPerPlayer;
    broadcastSnapshot(io, state);
    ack({ ok: true });
  });

  // ---- Cabo actions ----

  socket.on('cabo:ackPeek', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.config.gameMode !== 'cabo' || !state.caboHands) return ack({ error: 'Not a Cabo game' });
    if (!state.caboPeekPhaseActive) return ack({ error: 'Not in peek phase' });

    if (!state.caboPeekAckByPlayer) state.caboPeekAckByPlayer = new Set();
    state.caboPeekAckByPlayer.add(currentPlayerId);
    for (const [pid, p] of state.players) if (!p.connected) state.caboPeekAckByPlayer.add(pid);

    if (state.caboPeekAckByPlayer.size >= state.players.size) {
      state.caboPeekPhaseActive = false;
      state.phase = 'play';
    }

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

    broadcastSnapshot(io, state);
    ack({ ok: true, card });
  });

  socket.on('cabo:placeDrawn', (payload: { slotId: string }, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.config.gameMode !== 'cabo' || !state.caboHands || !state.discardPile) return ack({ error: 'Not a Cabo game' });
    if (state.phase !== 'play' && state.phase !== 'cabo-called') return ack({ error: 'Cannot act in this phase' });

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
    const numPlayers = state.caboTurnOrder!.length;
    state.caboFinalTurnsLeft = numPlayers - 1;

    // Find first valid player for final turns (skip caller and disconnected)
    let idx = state.caboCurrentTurnIndex ?? 0;
    let remaining = state.caboFinalTurnsLeft;

    for (let i = 0; i < numPlayers; i++) {
      idx = (idx + 1) % numPlayers;
      const pid = state.caboTurnOrder![idx];
      if (pid === currentPlayerId) continue;
      const player = state.players.get(pid);
      if (!player?.connected) {
        remaining--;
        if (remaining <= 0) {
          state.caboCurrentTurnIndex = idx;
          state.caboFinalTurnsLeft = 0;
          broadcastSnapshot(io, state);
          ack({ ok: true });
          finalizeCaboRound(io, state);
          broadcastSnapshot(io, state);
          return;
        }
        continue;
      }
      state.caboCurrentTurnIndex = idx;
      state.caboFinalTurnsLeft = remaining;
      break;
    }

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
      for (let i = 0; i < 2; i++) {
        caboEnsureDrawPile(state);
        const penalty = state.extraDeck.pop();
        if (penalty) {
          mySlots.push({
            slotId: `${currentPlayerId}:r${state.currentRound}:pen${Date.now()}${i}`,
            card: penalty,
          });
        }
      }
      emitToPlayer(io, state, currentPlayerId, 'cabo:hand', mySlots);
      broadcastSnapshot(io, state);
      return ack({ ok: false, error: 'Wrong rank — 2 penalty cards drawn' });
    }

    // Correct snap: remove card from target's hand
    targetSlots.splice(slotIdx, 1);
    state.discardPile.push(targetCard);

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
    opponentSlots.push({ slotId: `${opponentId}:r${state.currentRound}:slid${Date.now()}`, card: slidCard.card });

    state.caboSnapGapPending!.delete(currentPlayerId);

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
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.config.gameMode !== 'cabo') return ack({ error: 'Not a Cabo game' });
    if (state.phase !== 'rematch-pending') return ack({ error: 'Not in rematch phase' });
    state.rematchAckByPlayer.add(currentPlayerId);
    autoAckDisconnected(state, state.rematchAckByPlayer);

    const required = Array.from(state.players.values()).filter((p) => p.connected).map((p) => p.playerId);
    const allAck = required.length > 0 && required.every((pid) => state.rematchAckByPlayer.has(pid));
    if (allAck) {
      resetCaboForRematch(state);
      broadcastSnapshot(io, state);
      for (const pid of state.players.keys()) {
        emitToPlayer(io, state, pid, 'cabo:hand', state.caboHands!.get(pid) ?? []);
      }
    } else {
      broadcastSnapshot(io, state);
    }
    ack({ ok: true });
  });

  socket.on('cabo:leaveGame', (_: {}, ack: (res: any) => void) => {
    const state = getState();
    if (!state || !currentPlayerId) return ack({ error: 'Not in game' });
    if (state.phase !== 'waiting' && state.phase !== 'rematch-pending') {
      return ack({ error: 'Cannot leave mid-game; disconnect to stop playing' });
    }
    const player = state.players.get(currentPlayerId);
    if (!player) return ack({ error: 'Player not found' });

    state.players.delete(currentPlayerId);
    tokenIndex.delete(player.playerToken);

    if (state.hostId === currentPlayerId) {
      const next = Array.from(state.players.keys())[0];
      if (next) state.hostId = next;
    }
    if (state.players.size === 0) {
      codeToGameId.delete(state.code);
      games.delete(state.gameId);
    }

    socket.leave(state.gameId);
    currentGameId = null;
    currentPlayerId = null;

    if (games.has(state.gameId)) broadcastSnapshot(io, state);
    ack({ ok: true });
  });

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
    if (!currentGameId || !currentPlayerId) return;
    const state = games.get(currentGameId);
    if (!state) return;
    const player = state.players.get(currentPlayerId);
    if (!player) return;
    if (player.currentSocketId !== socket.id) return;
    player.connected = false;
    player.disconnectedAt = Date.now();

    // Auto-ack in any active ack set
    if (state.phase === 'between-rounds') state.betweenRoundAckByPlayer.add(currentPlayerId);
    if (state.phase === 'rematch-pending') state.rematchAckByPlayer.add(currentPlayerId);
    state.peekAckByPlayer?.add(currentPlayerId);
    state.caboPeekAckByPlayer?.add(currentPlayerId);

    broadcastSnapshot(io, state);

    if (state.phase === 'between-rounds') {
      if (state.config.gameMode === 'cabo') {
        maybeCaboAdvanceRound(io, state);
      } else {
        maybeAdvanceRound(io, state);
      }
      broadcastSnapshot(io, state);
    }

    // If disconnected player had their turn in cabo-called, auto-advance
    if (state.config.gameMode === 'cabo' && state.phase === 'cabo-called' && state.caboTurnOrder) {
      const currentTurnPid = state.caboTurnOrder[state.caboCurrentTurnIndex ?? 0];
      if (currentTurnPid === currentPlayerId) {
        caboEndTurn(io, state);
        broadcastSnapshot(io, state);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
