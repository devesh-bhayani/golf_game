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
  playerId: string;        // stable across reconnects
  playerToken: string;     // secret, returned to client once
  currentSocketId: string; // updated on (re)connect
  displayName: string;
  connected: boolean;
  disconnectedAt?: number; // ms epoch when disconnect started
};

type GameMode = 'classic' | 'golf';

type GamePhase =
  | 'waiting'
  | 'peek'
  | 'play'
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

type GameState = {
  gameId: string;
  code: string;
  hostId: string;
  status: 'waiting' | 'active' | 'ended';
  phase: GamePhase;
  config: GameConfig;
  players: Map<string, Player>;
  hands: Map<string, Card[]>; // classic mode
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
};

const nano4 = customAlphabet('0123456789', 4);
const nanoToken = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 32);
const nanoPlayerId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12);

const codeToGameId = new Map<string, string>();
const games = new Map<string, GameState>();
// token -> { gameId, playerId } for rejoin lookup
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
  // Right of dealer plays first; dealer = host = seat 0; so start at seat 1.
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

  // initial peek: bottom row
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

  // Kings handled separately with bonus tiers
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
      // Four of a kind = -20 bonus; if more (multi-deck), extras score normally
      nonKingScore += -20 + (n - 4) * v;
    } else if (n === 3) {
      // Three = 0
      nonKingScore += 0;
    } else if (n === 2) {
      // Pair = 0
      nonKingScore += 0;
    } else {
      // single
      nonKingScore += v;
    }
  }

  return kingScore + nonKingScore;
}

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
  // Score this round
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
  if (required.length === 0) return; // edge: nobody connected; wait
  if (!required.every((pid) => state.betweenRoundAckByPlayer.has(pid))) return;
  state.currentRound += 1;
  dealGolfRound(state);
  // Send each player their hand including peek
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

  // Competition ranking: 1, 1, 3, 4 ... (co-winners share rank 1)
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

  // Update global leaderboard cumulatively
  for (const r of gameResults) {
    const existing = globalLeaderboard.find((p) => p.playerId === r.playerId);
    if (existing) {
      existing.totalScore += r.score;
      existing.gamesPlayed += 1;
    } else {
      globalLeaderboard.push({
        playerId: r.playerId,
        displayName: r.displayName,
        totalScore: r.score,
        gamesPlayed: 1,
      });
    }
  }
  globalLeaderboard.sort((a, b) => a.totalScore - b.totalScore);

  // Reset rematch ack set for the upcoming rematch decision
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
    } else {
      dealCards(state);
      state.phase = 'play';
    }

    broadcastSnapshot(io, state);
    if (state.config.gameMode === 'golf') {
      for (const pid of state.players.keys()) {
        emitToPlayer(io, state, pid, 'golf:hand', state.golfHands!.get(pid));
      }
    } else {
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
    // Auto-ack disconnected (so a dropped player doesn't block start)
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

    // Flip target's unlocked slots to revealed+locked
    if (state.golfHands) {
      const slots = state.golfHands.get(target.playerId);
      if (slots) {
        for (const s of slots) {
          if (!s.locked) { s.revealed = true; s.locked = true; }
        }
      }
    }

    // If it was their turn, advance
    if (state.turnOrder && state.turnOrder[state.currentTurnIndex || 0] === target.playerId) {
      advanceTurn(state);
    }

    // Auto-ack them in any active ack set
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
    // Allowed in waiting and rematch-pending only
    if (state.phase !== 'waiting' && state.phase !== 'rematch-pending') {
      return ack({ error: 'Cannot leave mid-game; disconnect to stop playing' });
    }
    const player = state.players.get(currentPlayerId);
    if (!player) return ack({ error: 'Player not found' });

    state.players.delete(currentPlayerId);
    tokenIndex.delete(player.playerToken);

    // If host left, hand off to next player; if no one left, drop game
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
    if (player.currentSocketId !== socket.id) return; // a newer socket already took over
    player.connected = false;
    player.disconnectedAt = Date.now();
    // Auto-ack in any active ack set
    if (state.phase === 'between-rounds') state.betweenRoundAckByPlayer.add(currentPlayerId);
    if (state.phase === 'rematch-pending') state.rematchAckByPlayer.add(currentPlayerId);
    state.peekAckByPlayer?.add(currentPlayerId);

    broadcastSnapshot(io, state);
    // If we were waiting on between-round/rematch and only this player was missing, advance
    if (state.phase === 'between-rounds') {
      maybeAdvanceRound(io, state);
      broadcastSnapshot(io, state); // re-broadcast after potential phase change to peek
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
