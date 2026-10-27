import { strict as assert } from 'node:assert';
import { io, Socket } from 'socket.io-client';

const URL = process.env.SERVER_URL || 'http://localhost:3001';
const sockets: Socket[] = [];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
type Client = { socket: Socket; snapshot: any; private: any; id: string; token: string };
async function connect(): Promise<Client> {
  const socket = io(URL, { transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  const c: Client = { socket, snapshot: null, private: null, id: '', token: '' };
  socket.on('game:update', value => c.snapshot = value);
  socket.on('game:private', value => c.private = value);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Connection timeout')), 4000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', error => { clearTimeout(timer); reject(error); });
  });
  return c;
}
async function emit(c: Client, event: string, payload: any = {}): Promise<any> {
  const response = await new Promise<any>((resolve, reject) => c.socket.timeout(3000).emit(event, payload, (error: Error | null, value: any) => error ? reject(error) : resolve(value)));
  await sleep(5); // Allow the other clients' snapshot packets to arrive too.
  return response;
}
async function ok(c: Client, event: string, payload: any = {}) {
  const r = await emit(c, event, payload); assert(!r.error, `${event}: ${r.error}`); return r;
}
async function room(mode = 'golf', count = 2, cards = 4) {
  const clients: Client[] = [];
  for (let i = 0; i < count; i++) clients.push(await connect());
  const created = await ok(clients[0], 'createGame', { displayName: 'Host', config: { gameMode: mode, cardsPerPlayer: cards, maxPlayers: 8 } });
  clients[0].id = created.playerId; clients[0].token = created.playerToken;
  for (const [i, c] of clients.entries()) if (i) {
    const r = await ok(c, 'joinGame', { code: created.code, displayName: `Player ${i + 1}` });
    c.id = r.playerId; c.token = r.playerToken;
  }
  return clients;
}
const close = (clients: Client[]) => clients.forEach(c => c.socket.close());
async function ready(clients: Client[], mode = 'golf') { for (const c of clients) await ok(c, `${mode}:ackPeek`); }
async function stack(c: Client, hands: string[][], draw = '9') {
  const cards = [...hands.flat(), ...Array(20).fill(draw)].map(rank => ({ rank, suit: 'spades' }));
  await ok(c, '__test:stackDeck', { cards });
}
async function golfRound(clients: Client[]) {
  await ready(clients);
  let actions = 0;
  while (clients[0].snapshot.phase === 'play') {
    assert(actions++ < 200, 'Golf round did not end');
    const snapshot = clients[0].snapshot;
    const c = clients.find(c => c.id === snapshot.golf.turn)!;
    const slot = snapshot.golf.hands.find((h: any) => h.playerId === c.id).slots.find((s: any) => !s.locked);
    assert(slot, 'Turn belongs to a player without playable slots');
    await ok(c, 'golf:draw');
    await ok(c, 'golf:rejectDrawAndReveal', { slotId: slot.slotId });
  }
}

async function run() {
  {
    const cs = await room();
    const replacement = await connect();
    await ok(replacement, 'rejoinGame', { playerToken: cs[0].token });
    assert.equal(replacement.snapshot.phase, 'waiting');
    assert.equal(replacement.snapshot.hostId, cs[0].id);
    assert.equal(cs[0].socket.connected, false, 'Old connection must lose control');
    close([...cs, replacement]);
    console.log('✓ Waiting-room rejoin preserves phase; one active connection per seat');
  }
  for (const mode of ['golf', 'cabo']) {
    const cs = await room(mode);
    await ok(cs[0], 'startGame');
    const key = mode === 'golf' ? 'golfSlots' : 'caboSlots';
    assert.deepEqual(cs[0].private[key].map((s: any) => !!s.card), [false, false, true, true]);
    await ok(cs[0], `${mode}:ackPeek`);
    assert(cs[0].private[key].every((s: any) => s.card === null), 'Acknowledged peek must disappear immediately');
    const replacement = await connect();
    await ok(replacement, 'rejoinGame', { playerToken: cs[0].token });
    assert(replacement.private[key].every((s: any) => s.card === null), 'Rejoin must not repeat a peek');
    await ok(cs[1], `${mode}:ackPeek`);
    assert.equal(replacement.snapshot.phase, 'play');
    assert((await emit(replacement, 'startGame')).error);
    const before = replacement.snapshot.extraDeckCount;
    assert((await emit(replacement, 'drawCard')).error);
    assert.equal(replacement.snapshot.extraDeckCount, before);
    assert((await emit(replacement, mode === 'golf' ? 'cabo:draw' : 'golf:draw')).error);
    await ok(cs[1], `${mode}:draw`);
    const afterDraw = cs[1].snapshot.extraDeckCount;
    assert((await emit(cs[1], `${mode}:draw`)).error, 'Duplicate draws must fail');
    assert.equal(cs[1].snapshot.extraDeckCount, afterDraw);
    assert((await emit(cs[1], `${mode}:draw`, null)).error, 'Malformed payload rejected');
    close([...cs, replacement]);
  }
  console.log('✓ Own-card privacy, anti-repeek, mode/phase guards, duplicate draws and malformed requests');
  for (const mode of ['golf', 'cabo']) {
    const cs = await room(mode, 3);
    await ok(cs[0], 'startGame');
    await ok(cs[0], `${mode}:ackPeek`); await ok(cs[1], `${mode}:ackPeek`);
    cs[2].socket.close(); await sleep(70);
    assert.equal(cs[0].snapshot.phase, 'play', 'Last unready disconnect must advance peek');
    cs[0].socket.close(); await sleep(70);
    assert.equal(cs[1].snapshot.hostId, cs[1].id, 'Connected player takes host role');
    assert.equal(cs[1].snapshot.paused, true);
    const rejoined = await connect();
    await ok(rejoined, 'rejoinGame', { playerToken: cs[0].token });
    assert.equal(cs[1].snapshot.paused, false);
    await ok(rejoined, `${mode}:leaveGame`);
    close([...cs, rejoined]);
  }
  console.log('✓ Peek disconnect, immediate host transfer, pause and reconnect');
  {
    const cs = await room(); await ok(cs[0], 'startGame'); await ready(cs);
    await ok(cs[1], 'golf:leaveGame');
    assert.equal(cs[0].snapshot.phase, 'waiting');
    assert.equal(cs[0].snapshot.players.length, 1);
    const friend = await connect(); await ok(friend, 'joinGame', { code: cs[0].snapshot.code, displayName: 'New friend' });
    await ok(cs[0], 'startGame'); assert.equal(cs[0].snapshot.phase, 'peek');
    close([...cs, friend]);
  }
  console.log('✓ Forfeit returns the last player to a reusable lobby');
  {
    const cs = await room(); const hands = [['10', 'J', '2', '3'], ['4', '5', '6', '7']];
    await stack(cs[0], hands); await ok(cs[0], 'startGame');
    for (let round = 1; round <= 4; round++) {
      await golfRound(cs);
      assert.equal(cs[0].snapshot.runningTotals[cs[0].id], 25 * round, 'Only identical ranks combine');
      assert.equal(cs[0].private.scoreDetails.reduce((n: number, item: any) => n + item.points, 0), 25);
      if (round < 4) { await stack(cs[0], hands); for (const c of cs) await ok(c, 'golf:ackNextRound'); }
    }
    assert.equal(cs[0].snapshot.phase, 'rematch-pending');
    assert.equal(cs[0].snapshot.leaderboard[0].playerId, cs[1].id);
    const oldMatch = cs[0].snapshot.matchNumber;
    for (const c of cs) await ok(c, 'golf:ackRematch');
    assert.equal(cs[0].snapshot.phase, 'peek'); assert.equal(cs[0].snapshot.matchNumber, oldMatch + 1);
    assert.equal(cs[0].snapshot.currentRound, 1); close(cs);
  }
  console.log('✓ Entire Golf match, rank scoring, explanation and rematch');
  {
    const cs = await room(); const tied = [['5', '5', '8', 'K'], ['5', '5', '8', 'K']];
    await stack(cs[0], tied); await ok(cs[0], 'startGame');
    for (let i = 1; i <= 4; i++) {
      await golfRound(cs);
      if (i < 4) { await stack(cs[0], tied); for (const c of cs) await ok(c, 'golf:ackNextRound'); }
    }
    assert.equal(cs[0].snapshot.phase, 'between-rounds'); assert.equal(cs[0].snapshot.targetRounds, 5);
    await stack(cs[0], [['K','K','3','4'], ['4','5','6','7']]);
    for (const c of cs) await ok(c, 'golf:ackNextRound');
    await golfRound(cs); assert.equal(cs[0].snapshot.phase, 'rematch-pending');
    assert.equal(cs[0].snapshot.leaderboard[0].playerId, cs[0].id); close(cs);
  }
  console.log('✓ Tied lead adds a round; King bonuses decide the winner');
  {
    const cs = await room('golf', 8, 8);
    const hands = [Array(8).fill('K'), ...Array.from({length:7}, () => ['A','2','3','4','5','6','7','8'])];
    await stack(cs[0], hands); await ok(cs[0], 'startGame');
    for (let i = 1; i <= 8; i++) {
      await golfRound(cs);
      assert.equal(cs[0].snapshot.runningTotals[cs[0].id], -40 * i);
      if (i < 8) { await stack(cs[0], hands); for (const c of cs) await ok(c, 'golf:ackNextRound'); }
    }
    assert.equal(cs[0].snapshot.phase, 'rematch-pending'); close(cs);
  }
  console.log('✓ Eight players × eight cards × eight rounds; multiple-deck King groups');
  {
    const cs = await room('cabo');
    // Host = 0; guest = 30, therefore guest loses 35 per call and crosses 100 after 3 rounds.
    const hands = [['A','A','A','A'], ['J','Q','K','A']];
    await stack(cs[0], hands); await ok(cs[0], 'startGame');
    for (let round = 1; round <= 3; round++) {
      await ready(cs, 'cabo');
      // After the first round the previous winner (host) starts; take a turn to reach the guest.
      if (cs[0].snapshot.cabo.turn === cs[0].id) { await ok(cs[0], 'cabo:draw'); await ok(cs[0], 'cabo:discardDrawn'); }
      await ok(cs[1], 'cabo:callCabo'); await ok(cs[0], 'cabo:draw'); await ok(cs[0], 'cabo:discardDrawn');
      assert.equal(cs[0].snapshot.caboCumulativeScores[cs[1].id], round * 35);
      assert(cs[0].private.caboSlots.every((s: any) => s.card), 'Final own hand revealed for scoring');
      if (round < 3) { await stack(cs[0], hands); for (const c of cs) await ok(c, 'cabo:ackNextRound'); }
    }
    assert.equal(cs[0].snapshot.phase, 'rematch-pending');
    for (const c of cs) await ok(c, 'cabo:ackRematch');
    assert.equal(cs[0].snapshot.phase, 'peek'); assert.equal(cs[0].snapshot.caboCumulativeScores[cs[0].id], 0);
    close(cs);
  }
  console.log('✓ Cabo threshold, complete match and rematch');
  {
    const cs = await room('cabo');
    const cards = [...['2','3','4','5','6','8','9','10'].map(rank => ({rank,suit:'spades'})), {rank:'2',suit:'hearts'}, {rank:'K',suit:'spades'}, {rank:'A',suit:'spades'}];
    await ok(cs[0], '__test:stackDeck', {cards}); await ok(cs[0], 'startGame'); await ready(cs,'cabo');
    await ok(cs[1], 'cabo:draw');
    await ok(cs[1], 'cabo:useSpecialPower', {action:'black-king-see',targetPlayerId:cs[0].id,targetSlotId:cs[0].private.caboSlots[0].slotId});
    assert.equal(cs[1].private.blackKing.card.rank,'2'); cs[1].socket.close();
    const b=await connect(); b.id=cs[1].id;
    await ok(b,'rejoinGame',{playerToken:cs[1].token}); assert.equal(b.private.blackKing.card.rank,'2');
    await ok(b,'cabo:blackKingDecide',{swap:false}); assert.equal(b.private.blackKing,null);
    assert.equal(b.private.caboPendingDraw,null); assert.equal(b.snapshot.cabo.turn,cs[0].id); close([...cs,b]);
  }
  console.log('✓ Black King decision survives reconnect; pass clears it and advances turn');
  {
    const cs=await room('cabo',3); await ok(cs[0],'startGame'); await ready(cs,'cabo');
    await ok(cs[1],'cabo:callCabo'); assert.equal(cs[0].snapshot.cabo.turn,cs[2].id);
    await ok(cs[2],'cabo:leaveGame'); assert.equal(cs[0].snapshot.cabo.turn,cs[0].id);
    assert.equal(cs[0].snapshot.cabo.caboFinalTurnsLeft,1);
    await ok(cs[0],'cabo:draw'); await ok(cs[0],'cabo:discardDrawn');
    assert.equal(cs[0].snapshot.phase,'between-rounds'); close(cs);
  }
  console.log('✓ Departing Cabo final-turn player is removed exactly once');
  console.log('Release regression suite passed.');
}
run().then(() => process.exit(0)).catch(error => { console.error(error); process.exitCode=1; }).finally(() => sockets.forEach(s => s.close()));
