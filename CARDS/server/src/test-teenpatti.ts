// Teen Patti server rules with stacked decks. Needs the server started with
// TEST_HOOKS=1 (deck stacking):  npm run test:tp
import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
let failures = 0;

function check(ok: boolean, label: string) {
  if (ok) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
  console.log(`::error title=test-teenpatti::${label}`);
}

function connect(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(SERVER_URL, { transports: ['websocket'], forceNew: true });
    const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
    s.on('connect', () => { clearTimeout(t); resolve(s); });
  });
}

function emit(s: Socket, event: string, payload: unknown = {}): Promise<any> {
  return new Promise((resolve) => s.emit(event, payload, resolve));
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Seat {
  snap: any = null;
  priv: any = null;
  id = '';
  token = '';
  constructor(public socket: Socket, public name: string) {
    socket.on('game:update', (s: any) => { this.snap = s; });
    socket.on('game:private', (p: any) => { this.priv = p; });
  }
  get tp() { return this.snap?.tp; }
  seat(id = this.id) { return this.tp.seats.find((x: any) => x.playerId === id); }
}

// "As Kd Jh | 2c 3c 5d" -> stacked deck, dealt 3 cards per player in seat order.
const SUIT: Record<string, string> = { s: 'spades', h: 'hearts', d: 'diamonds', c: 'clubs' };
function deck(text: string) {
  return text.split(/[\s|]+/).filter(Boolean).map((t) => ({ rank: t.slice(0, -1), suit: SUIT[t.slice(-1)] }));
}

async function table(n: number, config: Record<string, unknown> = {}): Promise<Seat[]> {
  const names = ['A', 'B', 'C', 'D'];
  const seats: Seat[] = [];
  for (let i = 0; i < n; i++) seats.push(new Seat(await connect(), names[i]));
  const created = await emit(seats[0].socket, 'createGame', { displayName: 'A', config: { gameMode: 'teenpatti', maxPlayers: 8, ...config } });
  if (created.error) throw new Error(created.error);
  seats[0].id = created.playerId; seats[0].token = created.playerToken;
  for (let i = 1; i < n; i++) {
    const joined = await emit(seats[i].socket, 'joinGame', { code: created.code, displayName: names[i] });
    if (joined.error) throw new Error(joined.error);
    seats[i].id = joined.playerId; seats[i].token = joined.playerToken;
  }
  await delay(30);
  return seats;
}

async function stack(seat: Seat, text: string) {
  const r = await emit(seat.socket, '__test:stackDeck', { cards: deck(text) });
  if (r.error) throw new Error('stackDeck needs the server started with TEST_HOOKS=1');
}

// Sum of all seats' coins plus the pot.
const total = (s: Seat) => s.tp.seats.reduce((a: number, x: any) => a + x.coins, 0) + s.tp.pot;
const hasCardData = (v: unknown) => /"rank"/.test(JSON.stringify(v));

async function basics() {
  console.log('--- Teen Patti: dealing, blind/seen betting, show, privacy ---');
  const [A, B, C] = await table(3);
  await stack(A, 'Ah Ad Ac | Ks Kd 2c | 7h 5d 2s');
  check(!!(await emit(A.socket, 'startGame')).ok, 'start a 3-player game (medium stakes)');
  await delay(20);
  check(A.snap.phase === 'play' && A.tp.handNumber === 1, 'hand 1 is in play');
  check(A.tp.boot === 100 && A.tp.potLimit === 3200 && A.tp.start === 10000, 'boot 100, pot limit 3,200, start 10,000');
  check(A.tp.seats.every((x: any) => x.coins === 9900 && x.bet === 100 && x.inHand) && A.tp.pot === 300, 'everyone paid the 100 boot');
  check(A.tp.dealerId === A.id && A.tp.turn === B.id, 'A deals, the player after the dealer acts first');
  check([A, B, C].every((s) => s.priv.tpCards === null), 'blind players are not sent their own cards');
  check(!hasCardData(A.snap.tp.seats) && A.tp.result === null, 'the public snapshot carries no cards');
  check(total(A) === 30000, 'coins + pot = 30,000');

  check(JSON.stringify(B.priv.tpOptions.bets.map((b: any) => b.amount)) === '[100,200]', 'blind options: 1× or 2× the stake');
  check((await emit(B.socket, 'tp:bet', { double: false })).amount === 100, 'B bets 100 blind');
  check(A.tp.stake === 100 && A.tp.turn === C.id, 'stake stays 100, turn passes to C');
  check(!!(await emit(B.socket, 'tp:bet', {})).error, 'acting out of turn is refused');
  check((await emit(C.socket, 'tp:bet', { double: true })).amount === 200, 'C doubles blind: 200');
  check(A.tp.stake === 200 && A.tp.turn === A.id, 'stake becomes 200');

  check(!!(await emit(A.socket, 'tp:see')).ok, 'A looks at their cards');
  check(A.priv.tpCards?.length === 3 && B.priv.tpCards === null, 'only A receives A\'s cards');
  check(A.seat().seen && !A.seat(B.id).seen, 'seen status is public');
  check(JSON.stringify(A.priv.tpOptions.bets.map((b: any) => b.amount)) === '[400,800]', 'seen options: 2× or 4× the stake');
  check(A.priv.tpOptions.show === null && A.priv.tpOptions.sideShow === null, 'no show with 3 left; no side show against a blind player');
  check((await emit(A.socket, 'tp:bet', {})).amount === 400, 'A plays chaal for 400');
  check(A.tp.stake === 200, 'a seen bet of 400 leaves the stake at 200');
  check(!!(await emit(B.socket, 'tp:pack')).ok && A.seat(B.id).packed, 'B packs');
  check(A.tp.turn === C.id, 'turn skips to C');

  check(C.priv.tpOptions.show?.cost === 200, 'blind C may show for 1× the stake');
  check((await emit(C.socket, 'tp:bet', {})).amount === 200, 'C bets 200 blind instead');
  check(A.priv.tpOptions.show === null, 'seen A may not force a show against blind C');
  check(!!(await emit(A.socket, 'tp:show')).error, 'the server refuses that show too');
  await emit(A.socket, 'tp:bet', {});
  check(total(A) === 30000, 'coins still add up mid-hand');
  check(!!(await emit(C.socket, 'tp:show')).ok, 'C pays for a show');
  await delay(20);
  const r = A.tp.result;
  check(A.snap.phase === 'between-rounds' && r?.how === 'show' && r.winners[0] === A.id, 'A wins the show with a trail');
  check(r.shown.length === 2 && !r.shown.some((h: any) => h.playerId === B.id), 'only the two shown hands are revealed; packed B stays hidden');
  check(r.shown.find((h: any) => h.playerId === A.id).hand === 'Trail', 'shown hands are named');
  // pot: 300 boots + B 100 + C 200 + A 400 + C 200 + A 400 + C's 200 show = 1,800
  check(r.pot === 1800 && A.seat().coins === 10000 - 100 - 400 - 400 + 1800, `A collects the 1,800 pot (pot ${r.pot}, A ${A.seat().coins})`);
  check(r.deltas[A.id] === 900 && r.deltas[B.id] === -200 && r.deltas[C.id] === -700, `per-hand coin changes (${JSON.stringify(Object.values(r.deltas))})`);
  check(total(A) === 30000, 'coins + pot = 30,000 after the hand');
  check(B.priv.tpCards?.length === 3, 'after the hand you may see your own cards');
  for (const s of [A, B, C]) { await emit(s.socket, 'tp:leaveGame'); s.socket.close(); }
}

async function showTie() {
  console.log('--- Teen Patti: show tie goes against the payer ---');
  const [A, B] = await table(2);
  await stack(A, 'As Kd Jh | Ad Kh Js');
  await emit(A.socket, 'startGame');
  await delay(20);
  check(B.priv.tpOptions.show?.cost === 100, 'two players left from the start: blind show costs the stake');
  await emit(B.socket, 'tp:show');
  await delay(20);
  check(A.tp.result?.winners[0] === A.id, 'identical hands: the player who did not pay wins');
  for (const s of [A, B]) { await emit(s.socket, 'tp:leaveGame'); s.socket.close(); }
}

async function sideShows() {
  console.log('--- Teen Patti: side shows ---');
  const [A, B, C] = await table(3);
  // Hand 1 (dealer A, order B C A): accepted side show.
  await stack(A, '9s 9d 4c | Qs Jd 3h | Ks Kh 5d');
  await emit(A.socket, 'startGame');
  await delay(20);
  await emit(B.socket, 'tp:see');
  await emit(B.socket, 'tp:bet', {});
  await emit(C.socket, 'tp:see');
  check(C.priv.tpOptions.sideShow?.target === B.id && C.priv.tpOptions.sideShow.cost === 200, 'C can ask seen B (the previous player) for a side show, cost 2× stake');
  check(!!(await emit(C.socket, 'tp:sideShow')).ok, 'C asks B for a side show');
  check(B.priv.tpSideShowAsk?.from === C.id && A.priv.tpSideShowAsk === null, 'only B is asked');
  check(!!(await emit(C.socket, 'tp:bet', {})).error, 'play waits for the answer');
  check(!!(await emit(A.socket, 'tp:sideShowAnswer', { accept: true })).error, 'only the asked player can answer');
  await emit(B.socket, 'tp:sideShowAnswer', { accept: true });
  check(A.seat(B.id).packed && !A.seat(C.id).packed, 'accepted: the lower hand (B) packs');
  check(C.priv.tpKnown?.[0]?.playerId === B.id && B.priv.tpKnown?.[0]?.playerId === C.id, 'the two players see each other\'s cards');
  check((A.priv.tpKnown ?? []).length === 0 && !hasCardData(A.snap.tp), 'nobody else sees them');
  check(A.tp.turn === A.id, 'turn passes to the player after the asker');
  check(total(A) === 30000, 'coins add up');
  await emit(A.socket, 'tp:pack');
  await delay(20);
  check(A.tp.result?.how === 'packed' && A.tp.result.winners[0] === C.id && A.tp.result.shown.length === 0, 'last player standing wins without showing');

  // Hand 2 (dealer B, order C A B): declined side show.
  await stack(A, '4h 3d 2s | As Ks Qs | Kd Kh Kc');
  for (const s of [A, B, C]) await emit(s.socket, 'tp:ackNextHand');
  await delay(20);
  check(A.tp.handNumber === 2 && A.tp.dealerId === B.id && A.tp.turn === C.id, 'hand 2: dealer moves to B, C acts first');
  await emit(C.socket, 'tp:see');
  await emit(C.socket, 'tp:bet', {});
  await emit(A.socket, 'tp:see');
  check(A.priv.tpOptions.sideShow?.target === C.id, 'A may ask C');
  await emit(A.socket, 'tp:sideShow');
  await emit(C.socket, 'tp:sideShowAnswer', { accept: false });
  check(!A.seat().packed && !A.seat(C.id).packed && A.tp.turn === B.id, 'declined: nobody packs, play continues after the asker');
  check((A.priv.tpKnown ?? []).length === 0, 'declined: no cards change hands');
  await emit(B.socket, 'tp:pack');
  await emit(C.socket, 'tp:pack');
  await delay(20);

  // Hand 3 (dealer C, order A B C): tie goes against the asker.
  await stack(A, 'As Kd Jh | Ad Kh Js | 2c 3c 5d');
  for (const s of [A, B, C]) await emit(s.socket, 'tp:ackNextHand');
  await delay(20);
  check(A.tp.turn === A.id, 'hand 3: A acts first');
  await emit(A.socket, 'tp:see');
  await emit(A.socket, 'tp:bet', {});
  await emit(B.socket, 'tp:see');
  await emit(B.socket, 'tp:sideShow');
  await emit(A.socket, 'tp:sideShowAnswer', { accept: true });
  check(A.seat(B.id).packed && !A.seat().packed, 'tied side show: the asker (B) packs');
  check(total(A) === 30000, 'coins add up across three hands');
  for (const s of [A, B, C]) { await emit(s.socket, 'tp:leaveGame'); s.socket.close(); }
}

async function potLimit() {
  console.log('--- Teen Patti: pot limit and split ---');
  const [A, B, C] = await table(3, { tpStakes: 'low' });
  await stack(A, 'As Kd Jh | Ad Kh Js | 2c 3c 5d');
  await emit(A.socket, 'startGame');
  await delay(20);
  check(A.tp.boot === 10 && A.tp.potLimit === 320 && A.tp.pot === 30, 'low stakes: boot 10, pot limit 320');
  await emit(B.socket, 'tp:bet', { double: true }); // 20
  await emit(C.socket, 'tp:bet', { double: true }); // 40
  await emit(A.socket, 'tp:bet', { double: true }); // 80
  check(A.tp.pot === 170 && A.tp.stake === 80, 'pot 170, stake 80');
  const opts = B.priv.tpOptions.bets;
  check(opts[1]?.amount === 150, 'a bet that would pass the limit is trimmed to fit (150)');
  await emit(B.socket, 'tp:bet', { double: true });
  await delay(20);
  const r = A.tp.result;
  check(r?.how === 'pot-limit' && r.pot === 320 && r.shown.length === 3, 'pot reached 320: every remaining hand is shown');
  check(r.winners.length === 2 && r.winners.includes(A.id) && r.winners.includes(B.id), 'tied best hands split the pot');
  check(A.seat().coins === 1000 - 10 - 80 + 160 && A.seat(B.id).coins === 1000 - 10 - 20 - 150 + 160 && A.seat(C.id).coins === 1000 - 10 - 40, 'payouts: 160 each');
  check(total(A) === 3000, 'coins add up');
  for (const s of [A, B, C]) { await emit(s.socket, 'tp:leaveGame'); s.socket.close(); }
}

async function refills() {
  console.log('--- Teen Patti: refills, sitting out, blind limit, match length, leaving ---');
  const [A, B] = await table(2, { tpStakes: 'low', tpHands: 0 });
  let hands = 0;
  check(!!(await emit(A.socket, '__test:stackDeck', { cards: deck('Ah Ad Ac | 2s 3d 5h') })).ok, 'stack hand 1');
  await emit(A.socket, 'startGame');
  await delay(20);
  check(!!(await emit(B.socket, 'tp:refill')).error, 'no refill while you are in a hand');
  // B keeps losing pot-limit hands until it cannot cover the pot limit.
  while (B.seat(B.id).coins >= 320 && hands < 12) {
    while (A.snap.phase === 'play') {
      const mover = A.tp.turn === A.id ? A : B;
      await emit(mover.socket, 'tp:bet', { double: true });
    }
    hands++;
    if (B.seat(B.id).coins >= 320) {
      await stack(A, 'Ah Ad Ac | 2s 3d 5h');
      await emit(A.socket, 'tp:ackNextHand');
      await emit(B.socket, 'tp:ackNextHand');
      await delay(10);
    }
  }
  check(B.seat(B.id).coins < 320, `after ${hands} lost hands B is below the 320 table minimum`);
  check(B.priv.tpOptions.canRefill && !A.priv.tpOptions.canRefill, 'only B is offered a refill');
  await emit(A.socket, 'tp:ackNextHand');
  await emit(B.socket, 'tp:ackNextHand');
  await delay(10);
  check(A.snap.phase === 'between-rounds' && /refill/i.test(A.snap.notice ?? ''), 'with only one player able to cover the limit, no hand is dealt');
  check(!!(await emit(A.socket, 'tp:refill')).error, 'A has enough coins and cannot refill');
  await stack(A, 'Ah Ad Ac | 2s 3d 5h');
  const before = B.seat(B.id).coins;
  const totalBefore = total(A);
  check(!!(await emit(B.socket, 'tp:refill')).ok, 'B refills');
  await delay(10);
  check(B.seat(B.id).coins === 990 && B.seat(B.id).refills === 1, `B refilled to 1,000 and paid the 10 boot for the new hand (${B.seat(B.id).coins})`);
  check(A.snap.phase === 'play', 'everyone was ready, so the next hand is dealt straight away');
  const granted = 1000 + (1000 - before); // starting stack + the top-up
  check(B.seat(B.id).net === B.seat(B.id).coins - granted, `net = coins - coins granted (start + ${1000 - before} top-up)`);
  check(total(A) === totalBefore + (1000 - before), 'coins add up: the refill adds exactly the top-up');
  for (const s of [A, B]) { await emit(s.socket, 'tp:leaveGame'); s.socket.close(); }

  // Blind limit
  const [P, Q] = await table(2, { tpStakes: 'low', tpBlindLimit: 3 });
  await emit(P.socket, 'startGame');
  await delay(20);
  for (let i = 0; i < 6; i++) await emit((P.tp.turn === P.id ? P : Q).socket, 'tp:bet', {});
  const mover = P.tp.turn === P.id ? P : Q;
  check(mover.priv.tpOptions.mustSee && mover.priv.tpOptions.bets.length === 0, 'after 3 blind bets a player must look');
  check((await emit(mover.socket, 'tp:bet', {})).code === 'MUST_SEE', 'blind bet refused with MUST_SEE');
  await emit(mover.socket, 'tp:see');
  check(mover.priv.tpOptions.bets.length === 2, 'after looking, chaal is available');
  for (const s of [P, Q]) { await emit(s.socket, 'tp:leaveGame'); s.socket.close(); }

  // Match length and rematch
  const [X, Y] = await table(2, { tpStakes: 'low', tpHands: 10 });
  await emit(X.socket, 'startGame');
  await delay(20);
  for (let h = 1; h <= 10; h++) {
    await emit((X.tp.turn === X.id ? X : Y).socket, 'tp:pack');
    if (h < 10) { await emit(X.socket, 'tp:ackNextHand'); await emit(Y.socket, 'tp:ackNextHand'); }
  }
  await delay(10);
  check(X.snap.phase === 'rematch-pending' && X.snap.status === 'ended', 'the match ends after 10 hands');
  const lb = X.tp.leaderboard;
  check(lb?.length === 2 && lb[0].net >= lb[1].net && lb[0].rank === 1, 'standings by net coins');
  await emit(X.socket, 'tp:ackRematch');
  await emit(Y.socket, 'tp:ackRematch');
  await delay(10);
  check(X.snap.phase === 'play' && X.tp.handNumber === 1 && X.tp.seats.every((s: any) => s.coins === 990 && s.refills === 0), 'play again: coins reset, hand 1');
  for (const s of [X, Y]) { await emit(s.socket, 'tp:leaveGame'); s.socket.close(); }

  // Leaving mid-hand
  const [L, M, N] = await table(3);
  await emit(L.socket, 'startGame');
  await delay(20);
  check(L.tp.turn === M.id, 'M to act');
  await emit(M.socket, 'tp:bet', {});
  await emit(N.socket, 'tp:bet', {});
  await emit(L.socket, 'tp:bet', {});
  check(L.tp.turn === M.id && L.tp.pot === 600, 'pot 600, M to act');
  await emit(M.socket, 'tp:leaveGame');
  M.socket.close();
  await delay(10);
  check(L.tp.pot === 600 && L.tp.turn === N.id && L.snap.phase === 'play', 'M leaves: their bets stay in the pot and the turn moves on');
  await emit(N.socket, 'tp:pack');
  await delay(10);
  check(L.tp.result?.winners[0] === L.id && L.tp.result.pot === 600, 'the last player standing collects the pot, including M\'s bets');
  for (const s of [L, N]) { await emit(s.socket, 'tp:leaveGame'); s.socket.close(); }
}

async function run() {
  await basics();
  await showTie();
  await sideShows();
  await potLimit();
  await refills();
  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nAll Teen Patti checks passed');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  console.log(`::error title=test-teenpatti::${String(err?.message ?? err)}`);
  process.exit(1);
});
