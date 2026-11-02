// Teen Patti rules as pure functions: hand ranking, bet sizes, stakes, and a
// strength table for bots. No sockets or game state here (owner-approved
// exception to the one-server-file rule), so every rule is unit-testable.
// House rules are documented in CARDS/TEEN_PATTI_RULES.md; keep them in sync.

import type { Card, Rank, TpStakeLevel } from './shared-types.js';

export type TpCategory = 'trail' | 'pure-sequence' | 'sequence' | 'color' | 'pair' | 'high-card';

// Weakest first, so the index is the category's strength.
export const TP_CATEGORIES: TpCategory[] = ['high-card', 'pair', 'color', 'sequence', 'pure-sequence', 'trail'];

export const TP_CATEGORY_NAME: Record<TpCategory, string> = {
  trail: 'Trail',
  'pure-sequence': 'Pure sequence',
  sequence: 'Sequence',
  color: 'Color',
  pair: 'Pair',
  'high-card': 'High card',
};

const RANK_VALUE: Record<Rank, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14,
};

export type TpHandValue = { category: TpCategory; tiebreak: number[] };

// House rule: A-2-3 is the highest run (value 15), then A-K-Q (14), K-Q-J (13)
// ... down to 4-3-2 (4). K-A-2 is not a run.
function runValue(desc: number[]): number | null {
  if (desc[0] === 14 && desc[1] === 3 && desc[2] === 2) return 15;
  if (desc[0] - desc[1] === 1 && desc[1] - desc[2] === 1) return desc[0];
  return null;
}

export function evaluateTp(cards: Card[]): TpHandValue {
  if (cards.length !== 3) throw new Error('Teen Patti hands have exactly 3 cards');
  const v = cards.map((c) => RANK_VALUE[c.rank]).sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  if (v[0] === v[2]) return { category: 'trail', tiebreak: [v[0]] };
  const run = runValue(v);
  if (run !== null) return { category: flush ? 'pure-sequence' : 'sequence', tiebreak: [run] };
  if (flush) return { category: 'color', tiebreak: v };
  if (v[0] === v[1]) return { category: 'pair', tiebreak: [v[0], v[2]] };
  if (v[1] === v[2]) return { category: 'pair', tiebreak: [v[1], v[0]] };
  return { category: 'high-card', tiebreak: v };
}

// > 0 if a beats b, < 0 if b beats a, 0 for identical strength (suits never rank).
export function compareTp(a: Card[], b: Card[]): number {
  return compareValues(evaluateTp(a), evaluateTp(b));
}

function compareValues(a: TpHandValue, b: TpHandValue): number {
  const byCategory = TP_CATEGORIES.indexOf(a.category) - TP_CATEGORIES.indexOf(b.category);
  if (byCategory !== 0) return byCategory;
  for (let i = 0; i < Math.max(a.tiebreak.length, b.tiebreak.length); i++) {
    const d = (a.tiebreak[i] ?? 0) - (b.tiebreak[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function tpHandName(cards: Card[]): string {
  return TP_CATEGORY_NAME[evaluateTp(cards).category];
}

// ---------- stakes and bets ----------

// Same ratios at every level: pot limit = 32 boots, starting stack = 100 boots.
// Nobody can put more than the pot limit into one hand, and you need at least
// that much to be dealt in, so nobody ever runs short mid-hand: no all-ins and
// no side pots.
export const TP_STAKES: Record<TpStakeLevel, { boot: number; start: number }> = {
  low: { boot: 10, start: 1_000 },
  medium: { boot: 100, start: 10_000 },
  high: { boot: 1_000, start: 100_000 },
};
export const TP_POT_LIMIT_BOOTS = 32;

export function tpStakeInfo(level: TpStakeLevel) {
  const { boot, start } = TP_STAKES[level];
  return { boot, start, potLimit: boot * TP_POT_LIMIT_BOOTS };
}

// The two bets on offer: blind 1× or 2× the stake; seen (chaal) 2× or 4×.
export function tpBetAmount(seen: boolean, stake: number, double: boolean): number {
  return (seen ? 2 : 1) * stake * (double ? 2 : 1);
}

// The stake the next player sees after a bet.
export function tpNextStake(seen: boolean, bet: number): number {
  return seen ? bet / 2 : bet;
}

// Show (two players left): blind pays 1× stake; seen pays 2× and may only ask a seen opponent.
export function tpShowCost(requesterSeen: boolean, stake: number): number {
  return requesterSeen ? 2 * stake : stake;
}

// ---------- strength table (bots) ----------

// Share of all 22,100 possible hands that this hand beats (ties count half).
let strengthTable: Map<string, number> | null = null;

const keyOf = (v: TpHandValue) => `${v.category}:${v.tiebreak.join(',')}`;

function buildStrengthTable(): Map<string, number> {
  const ranks = Object.keys(RANK_VALUE) as Rank[];
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
  const deck: Card[] = [];
  for (const suit of suits) for (const rank of ranks) {
    deck.push({ cardId: `${rank}${suit}`, rank, suit, color: suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black', value: RANK_VALUE[rank] });
  }
  const values: TpHandValue[] = [];
  for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) for (let k = j + 1; k < deck.length; k++) {
    values.push(evaluateTp([deck[i], deck[j], deck[k]]));
  }
  values.sort(compareValues);
  const table = new Map<string, number>();
  let i = 0;
  while (i < values.length) {
    let j = i;
    while (j + 1 < values.length && compareValues(values[j + 1], values[i]) === 0) j++;
    table.set(keyOf(values[i]), (i + (j - i + 1) / 2) / values.length);
    i = j + 1;
  }
  return table;
}

export function tpStrength(cards: Card[]): number {
  strengthTable ??= buildStrengthTable();
  return strengthTable.get(keyOf(evaluateTp(cards))) ?? 0;
}

// For tests: every possible hand's category, counted.
export function tpCategoryCounts(): Record<TpCategory, number> {
  const ranks = Object.keys(RANK_VALUE) as Rank[];
  const suits = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
  const deck: Card[] = [];
  for (const suit of suits) for (const rank of ranks) deck.push({ cardId: '', rank, suit, color: 'black', value: 0 });
  const counts = Object.fromEntries(TP_CATEGORIES.map((c) => [c, 0])) as Record<TpCategory, number>;
  for (let i = 0; i < deck.length; i++) for (let j = i + 1; j < deck.length; j++) for (let k = j + 1; k < deck.length; k++) {
    counts[evaluateTp([deck[i], deck[j], deck[k]]).category]++;
  }
  return counts;
}
