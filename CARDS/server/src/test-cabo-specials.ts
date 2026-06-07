import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

// Deterministically exercises all four Cabo special powers (peek-own, spy,
// blind-swap, black-king-see) plus the correct-snap mechanic by stacking
// an exact deck via the TEST_HOOKS-only __test:stackDeck handler. Run against
// a server started with TEST_HOOKS=1.
//
// Deck layout for 2 players A (host) and B; turn order [A, B], B acts first.
//   idx 0-3  -> A's slots s0..s3   : 2s 3s 4s 5s
//   idx 4-7  -> B's slots s0..s3   : 6h 8h 9h 10h
//   extraDeck (array idx / pop order):
//   idx 13   -> initial discard    : As   (popped first)
//   idx 12   -> B turn 1 draw      : 7c   (peek-own)
//   idx 11   -> A turn 1 draw      : 9d   (spy)
//   idx 10   -> B turn 2 draw      : Js   (blind-swap)
//   idx  9   -> A turn 2 draw      : Ks   (black-king-see)
//   idx  8   -> spare/bottom       : 2d

type CardT = { cardId: string; suit: string; rank: string; color: string; value: number };
type CaboSlotT = { slotId: string; card: CardT };

function assert(cond: unknown, msg: string) {
	if (!cond) throw new Error(msg);
}
function connect(): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const s = io(SERVER_URL, { transports: ['websocket'] });
		const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
		s.on('connect', () => { clearTimeout(t); resolve(s); });
	});
}
function emit<T = any>(s: Socket, event: string, payload: unknown = {}): Promise<T> {
	return new Promise((resolve) => s.emit(event, payload, resolve as (r: T) => void));
}
function waitFor<T = any>(s: Socket, event: string, timeoutMs = 3000): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
		s.once(event, (data: T) => { clearTimeout(t); resolve(data); });
	});
}

const STACK = [
	// A's hand
	{ rank: '2', suit: 'spades' }, { rank: '3', suit: 'spades' }, { rank: '4', suit: 'spades' }, { rank: '5', suit: 'spades' },
	// B's hand
	{ rank: '6', suit: 'hearts' }, { rank: '8', suit: 'hearts' }, { rank: '9', suit: 'hearts' }, { rank: '10', suit: 'hearts' },
	// extraDeck — bottom to top (pop order is right-to-left)
	{ rank: '2', suit: 'diamonds' },  // idx  8  spare bottom
	{ rank: 'K', suit: 'spades' },    // idx  9  A turn 2: black-king-see
	{ rank: 'J', suit: 'spades' },    // idx 10  B turn 2: blind-swap
	{ rank: '9', suit: 'diamonds' },  // idx 11  A turn 1: spy
	{ rank: '7', suit: 'clubs' },     // idx 12  B turn 1: peek-own
	{ rank: 'A', suit: 'spades' },    // idx 13  initial discard
];

async function run() {
	console.log('--- Cabo specials E2E (deterministic deck) ---');

	const a = await connect();
	const b = await connect();
	const hand: Record<string, CaboSlotT[]> = {};
	const snap: Record<string, any> = {};
	a.on('cabo:hand', (s: CaboSlotT[]) => { hand.a = s; });
	b.on('cabo:hand', (s: CaboSlotT[]) => { hand.b = s; });
	a.on('game:update', (g: any) => { snap.a = g; });
	b.on('game:update', (g: any) => { snap.b = g; });

	const config = { maxPlayers: 8, totalCardsPerDeck: 52, numberOfDecks: 1, cardsPerPlayer: 4, gameMode: 'cabo' };
	const created: any = await emit(a, 'createGame', { displayName: 'A', config });
	assert(!created?.error, `createGame failed: ${created?.error}`);
	const pidB = (await emit(b, 'joinGame', { code: created.code, displayName: 'B' }) as any).playerId;
	const pidA = created.playerId;

	const stackRes: any = await emit(a, '__test:stackDeck', { cards: STACK });
	assert(stackRes?.ok && stackRes.size === 14, `stackDeck failed (is TEST_HOOKS=1?): ${JSON.stringify(stackRes)}`);

	await emit(a, 'startGame', {});
	await new Promise((r) => setTimeout(r, 150));

	// --- verify initial hands ---
	const aRanks = hand.a.map((s) => s.card.rank).join(',');
	const bRanks = hand.b.map((s) => s.card.rank).join(',');
	assert(aRanks === '2,3,4,5', `A hand wrong: ${aRanks}`);
	assert(bRanks === '6,8,9,10', `B hand wrong: ${bRanks}`);
	console.log(`✓ Stacked deck dealt exactly (A=${aRanks} B=${bRanks})`);

	await emit(a, 'cabo:ackPeek', {});
	await emit(b, 'cabo:ackPeek', {});
	await new Promise((r) => setTimeout(r, 120));
	assert(snap.a.cabo.turn === pidB, `expected B first, got ${snap.a.cabo.turn}`);

	// Capture slotIds before any mutations
	const bSlot0Id = hand.b[0].slotId; // 6h
	const bSlot1Id = hand.b[1].slotId; // 8h
	const bSlot2Id = hand.b[2].slotId; // 9h — will be snapped
	const aSlot0Id = hand.a[0].slotId; // 2s
	const aSlot3Id = hand.a[3].slotId; // 5s — will be blind-swap target

	// ===== Turn 1 (B): peek-own — draw 7c, peek own slot 0 (6h) =====
	const bDraw1: any = await emit(b, 'cabo:draw', {});
	assert(bDraw1?.card?.rank === '7', `B should draw 7, got ${bDraw1?.card?.rank}`);
	const peekP = waitFor(b, 'cabo:peekResult');
	const peekAck: any = await emit(b, 'cabo:useSpecialPower', { action: 'peek-own', ownSlotId: bSlot0Id });
	assert(peekAck?.ok, `peek-own failed: ${JSON.stringify(peekAck)}`);
	const peek: any = await peekP;
	assert(peek.slotId === bSlot0Id && peek.card.rank === '6', `peek-own wrong: ${JSON.stringify(peek)}`);
	console.log(`✓ peek-own revealed own slot card = ${peek.card.rank}${peek.card.suit[0]}`);

	await new Promise((r) => setTimeout(r, 120));
	assert(snap.a.cabo.turn === pidA, `expected A after B peek, got ${snap.a.cabo.turn}`);

	// ===== Turn 2 (A): spy — draw 9d, spy B slot 1 (8h) =====
	const aDraw1: any = await emit(a, 'cabo:draw', {});
	assert(aDraw1?.card?.rank === '9', `A should draw 9, got ${aDraw1?.card?.rank}`);
	const spyP = waitFor(a, 'cabo:spyResult');
	const spyAck: any = await emit(a, 'cabo:useSpecialPower', { action: 'spy', targetPlayerId: pidB, targetSlotId: bSlot1Id });
	assert(spyAck?.ok, `spy failed: ${JSON.stringify(spyAck)}`);
	const spy: any = await spyP;
	assert(spy.targetPlayerId === pidB && spy.slotId === bSlot1Id && spy.card.rank === '8', `spy wrong: ${JSON.stringify(spy)}`);
	console.log(`✓ spy revealed opponent slot card = ${spy.card.rank}${spy.card.suit[0]}`);

	await new Promise((r) => setTimeout(r, 120));
	// Discard top is now 9d; B slot 2 = 9h — ranks match. Correct self-snap!
	assert(snap.a.cabo.turn === pidB, `expected B turn before snap, got ${snap.a.cabo.turn}`);

	// ===== Correct self-snap (B): discard=9d rank=9 matches B slot 2 (9h) =====
	assert(hand.b[2].card.rank === '9', `B slot 2 should be 9, got ${hand.b[2].card.rank}`);
	const snapAck: any = await emit(b, 'cabo:snap', { targetType: 'own', targetSlotId: bSlot2Id });
	assert(snapAck?.ok === true, `correct snap rejected: ${JSON.stringify(snapAck)}`);
	await new Promise((r) => setTimeout(r, 120));
	assert(hand.b.length === 3, `B should have 3 cards after snap, got ${hand.b.length}`);
	console.log(`✓ Correct self-snap: B slot 2 (9h) removed; B now has ${hand.b.length} cards`);

	// ===== Turn 3 (B): blind-swap — draw Js, swap B slot 0 (6h) ↔ A slot 3 (5s) =====
	assert(snap.a.cabo.turn === pidB, `expected B turn 3, got ${snap.a.cabo.turn}`);
	const bDraw2: any = await emit(b, 'cabo:draw', {});
	assert(bDraw2?.card?.rank === 'J', `B should draw J, got ${bDraw2?.card?.rank}`);
	const bHandAfterSwap = waitFor(b, 'cabo:hand');
	const aHandAfterSwap = waitFor(a, 'cabo:hand');
	const swapAck: any = await emit(b, 'cabo:useSpecialPower', {
		action: 'blind-swap',
		ownSlotId: bSlot0Id,
		targetPlayerId: pidA,
		targetSlotId: aSlot3Id,
	});
	assert(swapAck?.ok, `blind-swap failed: ${JSON.stringify(swapAck)}`);
	await Promise.all([bHandAfterSwap, aHandAfterSwap]);
	// B slot 0 should now hold what was A slot 3 (5s); A slot 3 should hold what was B slot 0 (6h)
	const bSlot0Post = hand.b.find((s) => s.slotId === bSlot0Id);
	const aSlot3Post = hand.a.find((s) => s.slotId === aSlot3Id);
	assert(bSlot0Post?.card?.rank === '5', `B slot 0 post-swap want 5, got ${bSlot0Post?.card?.rank}`);
	assert(aSlot3Post?.card?.rank === '6', `A slot 3 post-swap want 6, got ${aSlot3Post?.card?.rank}`);
	console.log(`✓ blind-swap: B slot 0 = ${bSlot0Post?.card?.rank}s, A slot 3 = ${aSlot3Post?.card?.rank}h`);

	await new Promise((r) => setTimeout(r, 120));
	assert(snap.a.cabo.turn === pidA, `expected A after blind-swap, got ${snap.a.cabo.turn}`);

	// ===== Turn 4 (A): black-king-see — draw Ks, see B slot 0 (5s), then swap with A slot 0 (2s) =====
	const aDraw2: any = await emit(a, 'cabo:draw', {});
	assert(aDraw2?.card?.rank === 'K', `A should draw K, got ${aDraw2?.card?.rank}`);
	// B slot 0 now holds 5s (after blind-swap)
	const bkSeeP = waitFor(a, 'cabo:blackKingSeeResult');
	const bkAck: any = await emit(a, 'cabo:useSpecialPower', {
		action: 'black-king-see',
		targetPlayerId: pidB,
		targetSlotId: bSlot0Id,
	});
	assert(bkAck?.ok, `black-king-see failed: ${JSON.stringify(bkAck)}`);
	const bkSee: any = await bkSeeP;
	assert(
		bkSee.targetPlayerId === pidB && bkSee.slotId === bSlot0Id && bkSee.card.rank === '5',
		`blackKingSee wrong: ${JSON.stringify(bkSee)}`,
	);
	console.log(`✓ black-king-see revealed B slot 0 = ${bkSee.card.rank}s`);

	// Decide: swap A slot 0 (2s) ↔ B slot 0 (5s)
	const aHandAfterBk = waitFor(a, 'cabo:hand');
	const bHandAfterBk = waitFor(b, 'cabo:hand');
	const decideAck: any = await emit(a, 'cabo:blackKingDecide', { swap: true, ownSlotId: aSlot0Id });
	assert(decideAck?.ok, `blackKingDecide failed: ${JSON.stringify(decideAck)}`);
	await Promise.all([aHandAfterBk, bHandAfterBk]);
	const aSlot0Post = hand.a.find((s) => s.slotId === aSlot0Id);
	const bSlot0PostBk = hand.b.find((s) => s.slotId === bSlot0Id);
	assert(aSlot0Post?.card?.rank === '5', `A slot 0 post-bk-swap want 5, got ${aSlot0Post?.card?.rank}`);
	assert(bSlot0PostBk?.card?.rank === '2', `B slot 0 post-bk-swap want 2, got ${bSlot0PostBk?.card?.rank}`);
	console.log(`✓ black-king swap: A slot 0 = ${aSlot0Post?.card?.rank}s, B slot 0 = ${bSlot0PostBk?.card?.rank}s`);

	a.close();
	b.close();
	console.log('\n✅ Cabo specials E2E OK');
	process.exit(0);
}

run().catch((err) => {
	console.error('\n❌ Cabo specials test failed:', err);
	process.exit(1);
});
