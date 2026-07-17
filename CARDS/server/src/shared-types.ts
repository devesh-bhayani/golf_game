// Wire types shared between server and client. This file is the single source
// of truth for everything that crosses the socket. The client imports it
// directly (type-only, so nothing is bundled at runtime):
//   import type { Card, GameSnapshot } from '../../../server/src/shared-types';
// Server-internal state (GameState, GolfSlot with non-null card, Maps/Sets)
// stays in index.ts — only serialized shapes belong here.

export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export type Card = {
  cardId: string;
  suit: Suit;
  rank: Rank;
  color: 'red' | 'black';
  value: number;
};

export type GameMode = 'classic' | 'golf' | 'cabo';

export type GamePhase =
  | 'waiting'
  | 'peek'
  | 'play'
  | 'cabo-called'
  | 'between-rounds'
  | 'ended'
  | 'rematch-pending';

export type GameConfig = {
  maxPlayers: number;
  totalCardsPerDeck: number; // vestigial, ignored by the server
  numberOfDecks: number;     // client value ignored; recomputed by decksNeeded()
  cardsPerPlayer: number;
  gameMode?: GameMode;
};

// Golf slot as seen in the public snapshot: card is null until revealed+locked.
export type GolfSlotT = { slotId: string; revealed: boolean; locked: boolean; card: Card | null };

// Own Cabo hand as delivered by the private `cabo:hand` event.
export type CaboSlotPrivate = { slotId: string; card: Card };

// The `game:update` payload built by publicGameSnapshot().
export type GameSnapshot = {
  gameId: string;
  code: string;
  hostId: string;
  status: 'waiting' | 'active' | 'ended';
  phase: GamePhase;
  config: GameConfig;
  players: { playerId: string; displayName: string; connected: boolean; disconnectedAt?: number }[];
  centerPile: Card[];
  extraDeckCount: number;
  currentRound: number;
  targetRounds: number;
  discardTop?: Card | null;
  golf?: {
    hands: { playerId: string; slots: GolfSlotT[] }[];
    turn: string | null;
    round: number;
    peekPhaseActive?: boolean;
    peekAcks?: string[];
  };
  roundScores?: { playerId: string; scores: number[] }[];
  runningTotals?: Record<string, number>;
  betweenRoundAcks?: string[];
  rematchAcks?: string[];
  leaderboard?: Array<{ rank: number; displayName: string; score: number; playerId: string }>;
  cabo?: {
    hands: { playerId: string; slots: { slotId: string }[] }[];
    turn: string | null;
    round: number;
    peekPhaseActive: boolean;
    peekAcks: string[];
    caboCallerId: string | null;
    caboFinalTurnsLeft: number;
    pendingDrawPlayers: string[];
    blackKingPlayers: string[];
  };
  caboRoundScores?: { playerId: string; scores: number[] }[];
  caboCumulativeScores?: Record<string, number>;
  caboLeaderboard?: Array<{ rank: number; displayName: string; score: number; playerId: string }>;
};
