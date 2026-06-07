import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

// ----------------------------------------------------------------------------
// Cabo end-to-end happy path for 2 players. Covers the deterministic core:
//   setup + full-hand delivery, peek privacy, ackPeek -> play, draw+discard,
//   draw+place (swap), callCabo -> final turn -> round finalize with VERIFIED
//   scoring, ackNextRound -> round 2, and the wrong-snap penalty path.
//
// Card-specific special powers (peek-own/spy/blind-swap/black-king) and the
// correct-snap path depend on which card is drawn from a randomly shuffled
// deck, so they can't be exercised deterministically without a deck-injection
// hook. Those remain a follow-up.
// ----------------------------------------------------------------------------

type CardT = { cardId: string; suit: string; rank: string; color: 'red' | 'black'; value: number };
type CaboSlotT = { slotId: string; card: CardT };

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
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

// Mirror of the server's caboCardValue.
function caboCardValue(card: CardT): number {
	if (card.rank === 'A') return 0;
	if (card.rank === 'K') return card.color === 'red' ? -1 : 10;
	if (['J', 'Q'].includes(card.rank)) return 10;
	return parseInt(card.rank);
}
function handScore(slots: CaboSlotT[]): number {
	return slots.reduce((sum, s) => sum + caboCardValue(s.card), 0);
}

const caboConfig = {
	maxPlayers: 8,
	totalCardsPerDeck: 52,
	numberOfDecks: 1,
	cardsPerPlayer: 4,
	gameMode: 'cabo',
};

async function run() {
	console.log('--- Cabo E2E ---');

	const a = await connect();
	const b = await connect();

	// Track latest private hand and latest public snapshot per player.
	const hand: Record<string, CaboSlotT[]> = {};
	const snap: Record<string, any> = {};
	a.on('cabo:hand', (slots: CaboSlotT[]) => (hand.a = slots));
	b.on('cabo:hand', (slots: CaboSlotT[]) => (hand.b = slots));
	a.on('game:update', (g: any) => (snap.a = g));
	b.on('game:update', (g: any) => (snap.b = g));

	// --- 1. Create + join ---
	const created: any = await emit(a, 'createGame', { displayName: 'A', config: caboConfig });
	assert(!created?.error, `createGame failed: ${created?.error}`);
	const code = created.code;
	const pidA = created.playerId;

	const joined: any = await emit(b, 'joinGame', { code, displayName: 'B' });
	assert(!joined?.error, `joinGame failed: ${joined?.error}`);
	const pidB = joined.playerId;
	console.log(`Created cabo game ${code}, pidA=${pidA} pidB=${pidB}`);

	// --- 2. Start: both players get a full 4-card hand privately ---
	const started: any = await emit(a, 'startGame', {});
	assert(!started?.error, `startGame failed: ${started?.error}`);
	await delay(150);
	assert(hand.a?.length === 4 && hand.b?.length === 4, `expected 4 cards each, got a=${hand.a?.length} b=${hand.b?.length}`);
	console.log('✓ Both players dealt 4 private cards');

	// --- 3. Peek privacy: public snapshot exposes only slotIds, never cards ---
	assert(snap.a?.cabo?.peekPhaseActive === true, 'expected peek phase active');
	const anyCardLeaked = snap.a.cabo.hands.some((h: any) => h.slots.some((s: any) => 'card' in s && s.card));
	assert(!anyCardLeaked, 'public snapshot leaked card data during peek');
	console.log('✓ Peek phase: public snapshot hides all card values');

	// --- 4. Both ack peek -> play; first turn is the player after the dealer (B) ---
	await emit(a, 'cabo:ackPeek', {});
	await emit(b, 'cabo:ackPeek', {});
	await delay(120);
	assert(snap.a.phase === 'play', `expected play phase, got ${snap.a.phase}`);
	assert(snap.a.cabo.turn === pidB, `expected B to start, turn=${snap.a.cabo.turn}`);
	console.log('✓ Both acked peek -> play phase, B goes first');

	// --- 5. B draws then discards the drawn card (turn passes to A) ---
	const bDraw: any = await emit(b, 'cabo:draw', {});
	assert(bDraw?.ok && bDraw.card, `B draw failed: ${JSON.stringify(bDraw)}`);
	assert(snap.a.cabo.pendingDrawPlayers.includes(pidB), 'B should have a pending draw');
	const bDiscard: any = await emit(b, 'cabo:discardDrawn', {});
	assert(bDiscard?.ok, `B discardDrawn failed: ${JSON.stringify(bDiscard)}`);
	await delay(120);
	assert(snap.a.cabo.turn === pidA, `expected A's turn after B discards, turn=${snap.a.cabo.turn}`);
	console.log('✓ B drew and discarded; turn advanced to A');

	// --- 6. A draws then places the drawn card into slot 0 (swap) ---
	const aSlot0 = hand.a[0].slotId;
	const aDraw: any = await emit(a, 'cabo:draw', {});
	assert(aDraw?.ok && aDraw.card, `A draw failed: ${JSON.stringify(aDraw)}`);
	const aPlace: any = await emit(a, 'cabo:placeDrawn', { slotId: aSlot0 });
	assert(aPlace?.ok, `A placeDrawn failed: ${JSON.stringify(aPlace)}`);
	await delay(120);
	assert(hand.a[0].card.cardId === aDraw.card.cardId, 'A slot 0 should now hold the drawn card');
	assert(snap.a.cabo.turn === pidB, `expected B's turn after A places, turn=${snap.a.cabo.turn}`);
	console.log('✓ A drew and swapped into slot 0; turn advanced to B');

	// --- 7. B calls Cabo -> cabo-called, A gets exactly one final turn ---
	const callRes: any = await emit(b, 'cabo:callCabo', {});
	assert(callRes?.ok, `callCabo failed: ${JSON.stringify(callRes)}`);
	await delay(120);
	assert(snap.a.phase === 'cabo-called', `expected cabo-called, got ${snap.a.phase}`);
	assert(snap.a.cabo.caboCallerId === pidB, `expected caller B, got ${snap.a.cabo.caboCallerId}`);
	assert(snap.a.cabo.turn === pidA, `expected A's final turn, got ${snap.a.cabo.turn}`);
	console.log('✓ B called Cabo; A gets the final turn');

	// Capture round-1 final hands (unchanged from here until next round is dealt).
	const aHandR1 = hand.a;
	const bHandR1 = hand.b;

	// --- 8. A takes the final turn -> round finalizes -> between-rounds ---
	const aDraw2: any = await emit(a, 'cabo:draw', {});
	assert(aDraw2?.ok, `A final draw failed: ${JSON.stringify(aDraw2)}`);
	const aDiscard2: any = await emit(a, 'cabo:discardDrawn', {});
	assert(aDiscard2?.ok, `A final discard failed: ${JSON.stringify(aDiscard2)}`);
	await delay(150);
	assert(snap.a.phase === 'between-rounds', `expected between-rounds, got ${snap.a.phase}`);
	console.log('✓ Final turn taken; round finalized -> between-rounds');

	// --- 9. Verify scoring matches the rules (lowest hand = 0; caller +5 otherwise) ---
	const rawA = handScore(aHandR1);
	const rawB = handScore(bHandR1);
	const min = Math.min(rawA, rawB);
	const lowest = new Set<string>();
	if (rawA === min) lowest.add(pidA);
	if (rawB === min) lowest.add(pidB);
	const expectScoreA = lowest.has(pidA) ? 0 : rawA; // A is not the caller
	const expectScoreB = lowest.has(pidB) ? 0 : rawB + 5; // B is the caller -> +5 unless lowest

	const scoresByPid: Record<string, number[]> = {};
	for (const row of snap.a.caboRoundScores) scoresByPid[row.playerId] = row.scores;
	const serverA = scoresByPid[pidA]?.[0];
	const serverB = scoresByPid[pidB]?.[0];
	console.log(`  raw: A=${rawA} B=${rawB}; expected round score A=${expectScoreA} B=${expectScoreB}; server A=${serverA} B=${serverB}`);
	assert(serverA === expectScoreA, `A round score mismatch: server ${serverA} vs expected ${expectScoreA}`);
	assert(serverB === expectScoreB, `B round score mismatch: server ${serverB} vs expected ${expectScoreB}`);
	assert(snap.a.caboCumulativeScores[pidA] === expectScoreA, 'A cumulative mismatch');
	assert(snap.a.caboCumulativeScores[pidB] === expectScoreB, 'B cumulative mismatch');
	console.log('✓ Round scoring verified (lowest=0, caller penalty applied)');

	// --- 10. Both ack next round -> round 2 peek phase, fresh hands dealt ---
	await emit(a, 'cabo:ackNextRound', {});
	await emit(b, 'cabo:ackNextRound', {});
	await delay(150);
	assert(snap.a.cabo.round === 2, `expected round 2, got ${snap.a.cabo.round}`);
	assert(snap.a.cabo.peekPhaseActive === true, 'expected round 2 peek phase');
	assert(hand.a?.length === 4 && hand.b?.length === 4, 'expected fresh 4-card hands in round 2');
	console.log('✓ Advanced to round 2 (peek phase, fresh hands)');

	// --- 11. Wrong-snap penalty path (round 2 play) ---
	await emit(a, 'cabo:ackPeek', {});
	await emit(b, 'cabo:ackPeek', {});
	await delay(120);
	assert(snap.a.phase === 'play', `expected round 2 play, got ${snap.a.phase}`);

	const discardTop: CardT | null = snap.a.discardTop;
	assert(discardTop, 'expected a discard top in round 2');
	const mismatchSlot = hand.a.find((s) => s.card.rank !== discardTop!.rank);
	if (mismatchSlot) {
		const before = hand.a.length;
		const snapRes: any = await emit(a, 'cabo:snap', { targetType: 'own', targetSlotId: mismatchSlot.slotId });
		assert(snapRes?.ok === false, `wrong snap should be rejected, got ${JSON.stringify(snapRes)}`);
		await delay(120);
		assert(hand.a.length === before + 2, `expected 2 penalty cards, hand went ${before} -> ${hand.a.length}`);
		console.log(`✓ Wrong snap penalized: hand ${before} -> ${hand.a.length} cards`);
	} else {
		console.log('… skipped wrong-snap check (all 4 cards matched discard rank — rare)');
	}

	a.close();
	b.close();
	console.log('\n✅ Cabo E2E OK');
	process.exit(0);
}

run().catch((err) => {
	console.error('\n❌ Cabo E2E failed:', err);
	process.exit(1);
});
