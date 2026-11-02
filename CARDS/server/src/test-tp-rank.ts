// Teen Patti hand ranking (pure, no server needed):
//   npm run test:tp:rank
import { compareTp, evaluateTp, tpCategoryCounts, tpStrength, tpBetAmount, tpNextStake, tpShowCost, tpStakeInfo } from './teenpatti.js';
import type { Card, Rank, Suit } from './shared-types';

let failures = 0;
function check(ok: boolean, label: string) {
  if (ok) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
  console.log(`::error title=test-tp-rank::${label}`);
}

const SUITS: Record<string, Suit> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
// "As Kh Jd" -> cards
function hand(text: string): Card[] {
  return text.split(' ').map((t) => {
    const rank = t.slice(0, -1) as Rank;
    const suit = SUITS[t.slice(-1)];
    return { cardId: t, rank, suit, color: suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black', value: 0 };
  });
}
const beats = (a: string, b: string) => compareTp(hand(a), hand(b)) > 0;
const ties = (a: string, b: string) => compareTp(hand(a), hand(b)) === 0;

console.log('--- Teen Patti: hand ranking ---');

const counts = tpCategoryCounts();
check(counts.trail === 52, `52 trails (got ${counts.trail})`);
check(counts['pure-sequence'] === 48, `48 pure sequences (got ${counts['pure-sequence']})`);
check(counts.sequence === 720, `720 sequences (got ${counts.sequence})`);
check(counts.color === 1096, `1,096 colors (got ${counts.color})`);
check(counts.pair === 3744, `3,744 pairs (got ${counts.pair})`);
check(counts['high-card'] === 16440, `16,440 high cards (got ${counts['high-card']})`);
check(Object.values(counts).reduce((a, b) => a + b, 0) === 22100, '22,100 hands in total');

check(evaluateTp(hand('Ah As Ad')).category === 'trail', 'AAA is a trail');
check(evaluateTp(hand('Qs Ks As')).category === 'pure-sequence', 'Q-K-A suited is a pure sequence');
check(evaluateTp(hand('As 2h 3d')).category === 'sequence', 'A-2-3 mixed is a sequence');
check(evaluateTp(hand('Ks As 2d')).category === 'high-card', 'K-A-2 is not a run');
check(evaluateTp(hand('Kh Ah 2h')).category === 'color', 'K-A-2 suited is just a color');

// Category order
check(beats('2c 2d 2h', 'As 2s 3s'), 'lowest trail beats the best pure sequence');
check(beats('4s 3s 2s', 'As Kd Qh'), 'lowest pure sequence beats the best sequence');
check(beats('4s 3d 2h', 'As Ks Js'), 'lowest sequence beats the best color');
check(beats('5h 3h 2h', 'As Ad Kh'), 'lowest color beats the best pair');
check(beats('2s 2d 3h', 'As Kd Jh'), 'lowest pair beats the best high card');

// House rule: A-2-3 is the highest run
check(beats('As 2s 3s', 'As Ks Qs'), 'A-2-3 pure sequence beats A-K-Q pure sequence');
check(beats('As 2d 3h', 'Ad Kh Qs'), 'A-2-3 sequence beats A-K-Q sequence');
check(beats('Ad Kh Qs', 'Kd Qh Js'), 'A-K-Q beats K-Q-J');
check(beats('5d 4h 3s', '4d 3h 2s'), '5-4-3 beats 4-3-2');
check(ties('As 2d 3h', 'Ac 2h 3d'), 'equal runs tie (suits never rank)');

// Within categories
check(beats('Ah Ad Ac', 'Kh Kd Kc'), 'AAA beats KKK');
check(beats('Ah Kh 9h', 'Ad Qd Jd'), 'color: A-K-9 beats A-Q-J');
check(beats('Ah Kh Jh', 'Ad Kd 10d'), 'color: compares the lowest card last');
check(beats('9s 9d 2h', '8s 8d Ah'), 'pair: higher pair wins');
check(beats('9s 9d 5h', '9h 9c 4d'), 'pair: odd card breaks the tie');
check(beats('As Kd Jh', 'As Qd Jh'), 'high card: second card breaks the tie');
check(ties('As Kd Jh', 'Ad Kh Js'), 'identical high cards tie');

// Strength table
check(tpStrength(hand('Ah Ad Ac')) > 0.999, 'AAA is the strongest hand');
check(tpStrength(hand('5h 3d 2c')) < 0.002, '5-3-2 offsuit is the weakest hand (60 tied hands)');
check(tpStrength(hand('As Kd Jh')) > tpStrength(hand('Qs Jd 9h')), 'strength follows the ranking');

console.log('--- Teen Patti: bets ---');
check(tpBetAmount(false, 100, false) === 100 && tpBetAmount(false, 100, true) === 200, 'blind bets 1× or 2× the stake');
check(tpBetAmount(true, 100, false) === 200 && tpBetAmount(true, 100, true) === 400, 'seen bets 2× or 4× the stake');
check(tpNextStake(false, 200) === 200 && tpNextStake(true, 400) === 200, 'stake after a blind bet = bet; after a seen bet = half');
check(tpShowCost(false, 100) === 100 && tpShowCost(true, 100) === 200, 'show costs 1× blind, 2× seen');
const medium = tpStakeInfo('medium');
check(medium.boot === 100 && medium.start === 10_000 && medium.potLimit === 3_200, 'medium stakes: boot 100, start 10,000, pot limit 3,200');

if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
console.log('\nAll Teen Patti ranking checks passed');
process.exit(0);
