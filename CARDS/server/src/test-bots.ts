// Bot seats: lobby controls, full Golf and Cabo rounds against bots, privacy,
// pausing while the only human is away, and room cleanup.
// Start the server with a short bot step so this runs quickly:
//   BOT_STEP_MS=60 npm run dev
import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
let failures = 0;

function check(ok: boolean, label: string) {
  if (ok) { console.log(`  ✓ ${label}`); return; }
  failures++;
  console.error(`  ✗ ${label}`);
  console.log(`::error title=test-bots::${label}`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitUntil(cond: () => boolean, label: string, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!cond()) {
    if (Date.now() > deadline) { check(false, `timed out: ${label}`); return false; }
    await delay(25);
  }
  return true;
}

// One human seat that records everything it is sent.
class Seat {
  snap: any = null;
  priv: any = null;
  playerId = '';
  token = '';
  actions: any[] = [];
  leaks: string[] = [];
  constructor(public socket: Socket) { this.listen(); }
  listen() {
    this.socket.on('game:update', (s: any) => {
      this.snap = s;
      if (s.lastAction && this.actions[this.actions.length - 1]?.seq !== s.lastAction.seq) this.actions.push(s.lastAction);
      // Privacy: unlocked Golf cards and every Cabo card stay off the public snapshot.
      for (const h of s.golf?.hands ?? []) for (const slot of h.slots) if (slot.card && !slot.locked) this.leaks.push(`golf ${slot.slotId}`);
      for (const h of s.cabo?.hands ?? []) for (const slot of h.slots) if ('card' in slot) this.leaks.push(`cabo ${slot.slotId}`);
    });
    this.socket.on('game:private', (p: any) => { this.priv = p; });
  }
  bots() { return (this.snap?.players ?? []).filter((p: any) => p.isBot); }
}

async function golf() {
  console.log('--- Bots: Golf ---');
  const human = new Seat(await connect());
  const created = await emit(human.socket, 'createGame', { displayName: 'Human', config: { gameMode: 'golf', cardsPerPlayer: 4, maxPlayers: 8 } });
  check(!created.error, 'create a Golf room');
  human.playerId = created.playerId; human.token = created.playerToken;
  const code = created.code;

  // Only the host controls bots.
  const guest = new Seat(await connect());
  await emit(guest.socket, 'joinGame', { code, displayName: 'Guest' });
  check(!!(await emit(guest.socket, 'addBot')).error, 'a guest cannot add bots');
  await emit(guest.socket, 'golf:leaveGame');
  guest.socket.close();

  const a = await emit(human.socket, 'addBot');
  const b = await emit(human.socket, 'addBot');
  check(!!a.ok && !!b.ok, 'the host adds two bots');
  await waitUntil(() => human.snap?.players.length === 3, 'three seats in the lobby');
  check(human.snap.botsEnabled === true, 'snapshot advertises bot support');
  check(human.bots().length === 2 && human.snap.players.every((p: any) => p.connected), 'bots are seated and connected');
  check(new Set(human.snap.players.map((p: any) => p.displayName)).size === 3, 'bot names are unique');
  check(human.snap.hostId === human.playerId, 'the human stays host');
  check(!!(await emit(human.socket, 'removeBot', { playerId: human.playerId })).error, 'removeBot refuses a human seat');
  check(!!(await emit(human.socket, 'removeBot', { playerId: b.playerId })).ok, 'the host removes a bot');
  await waitUntil(() => human.snap.players.length === 2, 'bot left the lobby');
  check(!!(await emit(human.socket, 'addBot')).ok, 'and adds one back');

  check(!!(await emit(human.socket, 'startGame')).ok, 'start: one human and two bots');
  check(!!(await emit(human.socket, 'addBot')).error, 'no bots once the match has started');
  await emit(human.socket, 'golf:ackPeek');
  await waitUntil(() => human.snap.phase === 'play', 'bots finish their peek on their own');

  // Play simply until the round ends; bots must take every other turn.
  const deadline = Date.now() + 60000;
  while (human.snap.phase === 'play' && Date.now() < deadline) {
    if (human.snap.golf?.turn === human.playerId && !human.snap.paused) {
      if (human.priv?.pendingDraw) {
        const slot = human.snap.golf.hands.find((h: any) => h.playerId === human.playerId).slots.find((s: any) => !s.locked);
        await emit(human.socket, 'golf:rejectDrawAndReveal', { slotId: slot.slotId });
      } else {
        await emit(human.socket, 'golf:draw');
      }
    }
    await delay(20);
  }
  check(human.snap.phase === 'between-rounds', 'round 1 finishes');
  check(human.snap.golf.hands.every((h: any) => h.slots.every((s: any) => s.locked)), 'every card is locked at round end');
  const botIds = human.bots().map((p: any) => p.playerId);
  const botMoves = human.actions.filter((x) => botIds.includes(x.actorId));
  check(botMoves.length >= 8, `bots made their moves (${botMoves.length} logged)`);
  check(botMoves.every((x) => /^Bot \w+ /.test(x.text)), 'move log names the bot');
  check(human.actions.some((x) => x.actorId === human.playerId && x.kind === 'golf:reject-draw' && Array.isArray(x.slotIds) && x.slotIds.length === 1), 'move log carries the touched slot');
  check(human.leaks.length === 0, 'no hidden card reached the public snapshot');
  await waitUntil(() => botIds.every((id: string) => human.snap.betweenRoundAcks?.includes(id)), 'bots ready up for the next round');

  await emit(human.socket, 'golf:ackNextRound');
  await waitUntil(() => human.snap.currentRound === 2 && human.snap.phase === 'peek', 'round 2 is dealt');
  check(human.snap.lastAction === null, 'move log resets for the new round');

  // The last human leaving closes the room; bots never keep it alive.
  await emit(human.socket, 'golf:leaveGame');
  const late = await connect();
  check((await emit(late, 'joinGame', { code, displayName: 'Late' })).error === 'Invalid code', 'a room with only bots left is removed');
  late.close();
  human.socket.close();
}

async function cabo() {
  console.log('--- Bots: Cabo ---');
  const human = new Seat(await connect());
  const created = await emit(human.socket, 'createGame', { displayName: 'Human', config: { gameMode: 'cabo', maxPlayers: 8 } });
  human.playerId = created.playerId; human.token = created.playerToken;
  await emit(human.socket, 'addBot');
  await emit(human.socket, 'addBot');
  await emit(human.socket, 'addBot');
  await waitUntil(() => human.snap?.players.length === 4, 'three bots seated');
  check(!!(await emit(human.socket, 'startGame')).ok, 'start Cabo with three bots');
  await emit(human.socket, 'cabo:ackPeek');
  await waitUntil(() => human.snap.phase === 'play', 'bots finish their peek');

  // Away from the table: bots hold still while no human is connected.
  await waitUntil(() => human.snap.cabo?.turn !== human.playerId, 'a bot has the turn');
  const seqBefore = human.snap.lastAction?.seq ?? 0;
  human.socket.close();
  await delay(800); // shorter than the CI reaper TTL (GAME_TTL_MS=1500)
  const back = new Seat(await connect());
  const rejoin = await emit(back.socket, 'rejoinGame', { playerToken: human.token });
  check(!rejoin.error, 'the human rejoins after stepping away');
  await waitUntil(() => !!back.snap, 'snapshot after rejoin');
  check((back.snap.lastAction?.seq ?? 0) - seqBefore <= 2, `bots paused while nobody was watching (${(back.snap.lastAction?.seq ?? 0) - seqBefore} moves)`);
  check(back.snap.players.some((p: any) => p.playerId === human.playerId && p.connected), 'the human keeps their seat');
  back.playerId = human.playerId;

  let myTurns = 0;
  const deadline = Date.now() + 90000;
  while ((back.snap.phase === 'play' || back.snap.phase === 'cabo-called') && Date.now() < deadline) {
    if (back.snap.cabo?.turn === back.playerId && !back.snap.paused) {
      if (back.priv?.caboPendingDraw) {
        await emit(back.socket, 'cabo:discardDrawn');
        myTurns++;
      } else if (back.snap.phase === 'play' && myTurns >= 3) {
        await emit(back.socket, 'cabo:callCabo');
      } else {
        await emit(back.socket, 'cabo:draw');
      }
    }
    await delay(20);
  }
  check(back.snap.phase === 'between-rounds' || back.snap.phase === 'rematch-pending', 'the round is scored');
  check((back.snap.caboRoundScores ?? []).length === 4 && back.snap.caboRoundScores.every((r: any) => r.scores.length === 1), 'every seat scored once');
  const botIds = back.bots().map((p: any) => p.playerId);
  const botMoves = back.actions.filter((x) => botIds.includes(x.actorId));
  check(botMoves.length >= 3, `bots took their turns (${botMoves.length} logged)`);
  check(back.leaks.length === 0, 'no Cabo card reached the public snapshot');
  if (back.snap.phase === 'between-rounds') {
    await waitUntil(() => botIds.every((id: string) => back.snap.betweenRoundAcks?.includes(id)), 'bots ready up');
  }
  await emit(back.socket, 'cabo:leaveGame');
  back.socket.close();
}

async function teenPatti() {
  console.log('--- Bots: Teen Patti ---');
  const human = new Seat(await connect());
  const created = await emit(human.socket, 'createGame', { displayName: 'Human', config: { gameMode: 'teenpatti', tpStakes: 'low', tpHands: 0 } });
  human.playerId = created.playerId;
  for (let i = 0; i < 3; i++) await emit(human.socket, 'addBot');
  await waitUntil(() => human.snap?.players.length === 4, 'three bots seated');
  check(!!(await emit(human.socket, 'startGame')).ok, 'start Teen Patti with three bots');

  const tp = () => human.snap.tp;
  const total = () => tp().seats.reduce((a: number, x: any) => a + x.coins, 0) + tp().pot;
  let hands = 0;
  let botActions = 0;
  let lastSeq = 0;
  let balanced = true;
  const deadline = Date.now() + 90000;
  while (hands < 6 && Date.now() < deadline) {
    const snap = human.snap;
    const a = snap.lastAction;
    if (a && a.seq !== lastSeq) { lastSeq = a.seq; if (a.actorId !== human.playerId) botActions++; }
    const granted = 4 * 1000 + tp().seats.reduce((n: number, x: any) => n + (x.coins - x.net - 1000), 0);
    if (total() !== granted) balanced = false;
    const opts = human.priv?.tpOptions;
    if (snap.phase === 'play' && human.priv?.tpSideShowAsk) {
      // A bot asked us for a side show: play waits for our answer.
      await emit(human.socket, 'tp:sideShowAnswer', { accept: Math.random() < 0.5 });
    } else if (snap.phase === 'play' && opts?.myTurn) {
      // Plain human play: look on the first turn, then call; pack big stakes.
      if (opts.canSee) await emit(human.socket, 'tp:see');
      else if (tp().stake >= 8 * tp().boot) await emit(human.socket, 'tp:pack');
      else await emit(human.socket, opts.bets.length ? 'tp:bet' : 'tp:pack', { double: false });
    } else if (snap.phase === 'between-rounds') {
      if (opts?.canRefill) await emit(human.socket, 'tp:refill');
      if (!snap.betweenRoundAcks.includes(human.playerId)) {
        hands++;
        await emit(human.socket, 'tp:ackNextHand');
      }
    }
    await delay(15);
  }
  check(hands >= 6, `six hands finished with bots (${hands})`);
  check(botActions >= 6, `bots bet, packed or showed on their own (${botActions} moves)`);
  check(balanced, 'coins + pot always equal the coins handed out');
  check(human.leaks.length === 0 && !/"rank"/.test(JSON.stringify(tp().seats)), 'no hidden card reached the public snapshot');
  await emit(human.socket, 'tp:leaveGame');
  human.socket.close();
}

async function run() {
  await golf();
  await cabo();
  await teenPatti();
  if (failures) { console.error(`\n${failures} check(s) failed`); process.exit(1); }
  console.log('\nAll bot checks passed');
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  console.log(`::error title=test-bots::${String(err?.message ?? err)}`);
  process.exit(1);
});
