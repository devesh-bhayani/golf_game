import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

// Deterministically exercises Cabo special powers (peek-own, spy) by stacking
// an exact deck via the TEST_HOOKS-only __test:stackDeck handler. Run against a
// server started with TEST_HOOKS=1.
//
// Deck layout for 2 players A (host) and B; turn order [A, B], B acts first.
//   idx 0-3  -> A's slots s0..s3   : 2s 3s 4s 5s
//   idx 4-7  -> B's slots s0..s3   : 6h 8h 9h 10h
//   idx 8    -> draw pile (bottom) : 2d
//   idx 9    -> A draws (spy)      : 9d
//   idx 10   -> B draws (peek-own) : 7c
//   idx 11   -> discard top        : As
// Dealing takes idx 0-7 for hands; extraDeck = idx 8..11; the discard top is
// popped (idx 11), then draws pop idx 10, then idx 9.

type CardT = { cardId: string; suit: string; rank: string; color: string; value: number };
type CaboSlotT = { slotId: string; card: CardT };

function assert(cond: unknown, msg: string) {
	if (!cond) throw new Error(msg);
}
function connect(): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const s = io(SERVER_URL, { transports: ['websocket'] });
		const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
		s.on('connect', () => {
			clearTimeout(t);
			resolve(s);
		});
	});
}
function emit<T = any>(s: Socket, event: string, payload: unknown = {}): Promise<T> {
	return new Promise((resolve) => s.emit(event, payload, resolve as (r: T) => void));
}
function waitFor<T = any>(s: Socket, event: string, timeoutMs = 3000): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
		s.once(event, (data: T) => {
			clearTimeout(t);
			resolve(data);
		});
	});
}

const STACK = [
	{ rank: '2', suit: 'spades' }, { rank: '3', suit: 'spades' }, { rank: '4', suit: 'spades' }, { rank: '5', suit: 'spades' },
	{ rank: '6', suit: 'hearts' }, { rank: '8', suit: 'hearts' }, { rank: '9', suit: 'hearts' }, { rank: '10', suit: 'hearts' },
	{ rank: '2', suit: 'diamonds' }, { rank: '9', suit: 'diamonds' }, { rank: '7', suit: 'clubs' }, { rank: 'A', suit: 'spades' },
];

async function run() {
	console.log('--- Cabo specials E2E (deterministic deck) ---');

	const a = await connect();
	const b = await connect();
	const hand: Record<string, CaboSlotT[]> = {};
	const snap: Record<string, any> = {};
	a.on('cabo:hand', (s: CaboSlotT[]) => (hand.a = s));
	b.on('cabo:hand', (s: CaboSlotT[]) => (hand.b = s));
	a.on('game:update', (g: any) => (snap.a = g));
	b.on('game:update', (g: any) => (snap.b = g));

	const config = { maxPlayers: 8, totalCardsPerDeck: 52, numberOfDecks: 1, cardsPerPlayer: 4, gameMode: 'cabo' };
	const created: any = await emit(a, 'createGame', { displayName: 'A', config });
	assert(!created?.error, `createGame failed: ${created?.error}`);
	const pidB = (await emit(b, 'joinGame', { code: created.code, displayName: 'B' }) as any).playerId;
	const pidA = created.playerId;

	// Stack the deck BEFORE starting (verifies the TEST_HOOKS hook is present).
	const stackRes: any = await emit(a, '__test:stackDeck', { cards: STACK });
	assert(stackRes?.ok && stackRes.size === 12, `stackDeck failed (is TEST_HOOKS=1?): ${JSON.stringify(stackRes)}`);

	await emit(a, 'startGame', {});
	await new Promise((r) => setTimeout(r, 150));

	// Hands match the stacked deck — proves injection took effect.
	const aRanks = hand.a.map((s) => s.card.rank).join(',');
	const bRanks = hand.b.map((s) => s.card.rank).join(',');
	assert(aRanks === '2,3,4,5', `A hand wrong: ${aRanks}`);
	assert(bRanks === '6,8,9,10', `B hand wrong: ${bRanks}`);
	console.log(`✓ Stacked deck dealt exactly (A=${aRanks} B=${bRanks})`);

	await emit(a, 'cabo:ackPeek', {});
	await emit(b, 'cabo:ackPeek', {});
	await new Promise((r) => setTimeout(r, 120));
	assert(snap.a.cabo.turn === pidB, `expected B first, got ${snap.a.cabo.turn}`);

	// --- peek-own: B draws the 7c, peeks own slot 0 (the 6h) ---
	const bDraw: any = await emit(b, 'cabo:draw', {});
	assert(bDraw?.card?.rank === '7', `B should draw 7, got ${bDraw?.card?.rank}`);
	const bSlot0 = hand.b[0].slotId;
	const peekP = waitFor(b, 'cabo:peekResult');
	const peekAck: any = await emit(b, 'cabo:useSpecialPower', { action: 'peek-own', ownSlotId: bSlot0 });
	assert(peekAck?.ok, `peek-own failed: ${JSON.stringify(peekAck)}`);
	const peek: any = await peekP;
	assert(peek.slotId === bSlot0 && peek.card.rank === '6', `peek-own result wrong: ${JSON.stringify(peek)}`);
	console.log(`✓ peek-own revealed own slot card = ${peek.card.rank}${peek.card.suit[0]}`);

	await new Promise((r) => setTimeout(r, 120));
	assert(snap.a.cabo.turn === pidA, `expected A's turn after B's special, got ${snap.a.cabo.turn}`);

	// --- spy: A draws the 9d, spies B's slot 1 (the 8h) ---
	const aDraw: any = await emit(a, 'cabo:draw', {});
	assert(aDraw?.card?.rank === '9', `A should draw 9, got ${aDraw?.card?.rank}`);
	const bSlot1 = hand.b[1].slotId;
	const spyP = waitFor(a, 'cabo:spyResult');
	const spyAck: any = await emit(a, 'cabo:useSpecialPower', { action: 'spy', targetPlayerId: pidB, targetSlotId: bSlot1 });
	assert(spyAck?.ok, `spy failed: ${JSON.stringify(spyAck)}`);
	const spy: any = await spyP;
	assert(spy.targetPlayerId === pidB && spy.slotId === bSlot1 && spy.card.rank === '8', `spy result wrong: ${JSON.stringify(spy)}`);
	console.log(`✓ spy revealed opponent slot card = ${spy.card.rank}${spy.card.suit[0]}`);

	a.close();
	b.close();
	console.log('\n✅ Cabo specials E2E OK');
	process.exit(0);
}

run().catch((err) => {
	console.error('\n❌ Cabo specials test failed:', err);
	process.exit(1);
});
