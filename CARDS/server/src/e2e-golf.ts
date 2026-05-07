import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function connect(): Promise<Socket> {
	return new Promise((resolve, reject) => {
		const s = io(SERVER_URL, { transports: ['websocket'] });
		const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
		s.on('connect', () => { clearTimeout(t); resolve(s); });
	});
}

function emit<T>(s: Socket, event: string, payload: unknown): Promise<T> {
	return new Promise((resolve) => s.emit(event, payload, resolve));
}

function waitFor<T>(s: Socket, event: string, timeoutMs = 3000): Promise<T> {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
		s.once(event, (data: T) => { clearTimeout(t); resolve(data); });
	});
}

// Returns the first unlocked slot id for a given player from the snapshot
function firstUnlockedSlot(snapshot: any, playerId: string): string | null {
	const hand = snapshot.golf?.hands?.find((h: any) => h.playerId === playerId);
	if (!hand) return null;
	const slot = hand.slots.find((s: any) => !s.locked);
	return slot?.slotId ?? null;
}

async function run() {
	console.log('--- Golf E2E ---');

	// --- 1. Setup ---
	const [a, b] = await Promise.all([connect(), connect()]);

	// snapshot listeners
	let snapshotA: any = null;
	let snapshotB: any = null;
	a.on('game:update', (s: any) => { snapshotA = s; });
	b.on('game:update', (s: any) => { snapshotB = s; });

	let handA: any[] = [];
	let handB: any[] = [];
	a.on('golf:hand', (slots: any) => { handA = slots; });
	b.on('golf:hand', (slots: any) => { handB = slots; });

	// --- 2. Create + join golf game (4 cards) ---
	const createRes: any = await emit(a, 'createGame', {
		displayName: 'Host A',
		config: { maxPlayers: 4, totalCardsPerDeck: 52, numberOfDecks: 1, cardsPerPlayer: 4, gameMode: 'golf' },
	});
	if (createRes?.error) throw new Error('createGame: ' + createRes.error);
	const { code, playerId: pidA } = createRes;
	console.log('Created golf game, code:', code);

	const joinRes: any = await emit(b, 'joinGame', { code, displayName: 'Player B' });
	if (joinRes?.error) throw new Error('joinGame: ' + joinRes.error);
	const { playerId: pidB } = joinRes;
	console.log('B joined, pidA:', pidA, 'pidB:', pidB);

	// --- 3. Start game ---
	const startRes: any = await emit(a, 'startGame', {});
	if (startRes?.error) throw new Error('startGame: ' + startRes.error);
	await delay(300);

	if (!snapshotA) throw new Error('No snapshot after start');
	if (snapshotA.phase !== 'peek') throw new Error('Expected peek phase, got: ' + snapshotA.phase);
	if (!handA.length) throw new Error('A did not receive golf:hand');
	if (!handB.length) throw new Error('B did not receive golf:hand');
	if (handA.length !== 4) throw new Error(`A has ${handA.length} cards, expected 4`);
	if (handB.length !== 4) throw new Error(`B has ${handB.length} cards, expected 4`);
	const peekSlotsA = handA.filter((s: any) => s.peekOnly);
	const peekSlotsB = handB.filter((s: any) => s.peekOnly);
	if (peekSlotsA.length !== 2) throw new Error(`A peek slots: ${peekSlotsA.length}, expected 2`);
	if (peekSlotsB.length !== 2) throw new Error(`B peek slots: ${peekSlotsB.length}, expected 2`);
	console.log('✓ Peek phase: both players received 4 cards, 2 peek slots each');

	// Verify peek cards hidden from opponent's snapshot
	const bHandInSnapshotA = snapshotA.golf?.hands?.find((h: any) => h.playerId === pidB);
	if (bHandInSnapshotA?.slots?.some((s: any) => s.card !== null)) {
		throw new Error('B\'s cards visible to A during peek — privacy bug');
	}
	console.log("✓ B's cards not visible to A during peek");

	// --- 4. Both ack peek ---
	const ackA: any = await emit(a, 'golf:ackPeek', {});
	if (ackA?.error) throw new Error('ackPeek A: ' + ackA.error);
	await delay(100);

	const ackB: any = await emit(b, 'golf:ackPeek', {});
	if (ackB?.error) throw new Error('ackPeek B: ' + ackB.error);
	await delay(300);

	if (snapshotA.phase !== 'play') throw new Error('Expected play phase after all ack, got: ' + snapshotA.phase);
	if (snapshotA.golf?.peekPhaseActive !== false) throw new Error('peekPhaseActive should be false');
	console.log('✓ Both acked peek → play phase');

	// --- 5. Play through one full round ---
	// Turn order: currentTurnIndex=1 → pidB goes first
	// Each turn: swap with discard (simplest, always locks a slot)
	// 2 players × 4 cards = 8 turns to complete round 1

	const turnPlayer = (snapshot: any) => snapshot?.golf?.turn;

	for (let turn = 0; turn < 8; turn++) {
		await delay(100);
		const currentTurn = turnPlayer(snapshotA ?? snapshotB);
		const isATurn = currentTurn === pidA;
		const activeSocket = isATurn ? a : b;
		const activePid = isATurn ? pidA : pidB;

		const slotId = firstUnlockedSlot(snapshotA, activePid);
		if (!slotId) throw new Error(`No unlocked slot for ${activePid} on turn ${turn}`);

		// Alternate: even turns swap discard, odd turns draw+reject
		if (turn % 2 === 0) {
			const res: any = await emit(activeSocket, 'golf:swapWithDiscard', { slotId });
			if (res?.error) throw new Error(`swapWithDiscard turn ${turn}: ${res.error}`);
		} else {
			const drawRes: any = await emit(activeSocket, 'golf:draw', {});
			if (drawRes?.error) throw new Error(`draw turn ${turn}: ${drawRes.error}`);
			// reject: discard drawn card, reveal the selected slot
			const rejectRes: any = await emit(activeSocket, 'golf:rejectDrawAndReveal', { slotId });
			if (rejectRes?.error) throw new Error(`rejectDrawAndReveal turn ${turn}: ${rejectRes.error}`);
		}
		await delay(50);
	}

	await delay(300);
	console.log('✓ Completed 8 turns (round 1)');

	// --- 6. Verify between-rounds ---
	if (snapshotA.phase !== 'between-rounds') {
		throw new Error('Expected between-rounds after round 1, got: ' + snapshotA.phase);
	}
	if (!snapshotA.roundScores?.length) throw new Error('No roundScores after round 1');
	console.log('✓ Between-rounds triggered, scores:', snapshotA.runningTotals);

	// --- 7. Both ack next round ---
	const nextA: any = await emit(a, 'golf:ackNextRound', {});
	if (nextA?.error) throw new Error('ackNextRound A: ' + nextA.error);
	await delay(100);
	const nextB: any = await emit(b, 'golf:ackNextRound', {});
	if (nextB?.error) throw new Error('ackNextRound B: ' + nextB.error);
	await delay(300);

	if (snapshotA.phase !== 'peek') throw new Error('Expected peek phase for round 2, got: ' + snapshotA.phase);
	if (snapshotA.currentRound !== 2) throw new Error('Expected round 2, got: ' + snapshotA.currentRound);
	console.log('✓ Round 2 started (peek phase)');

	// --- 8. Reconnect: pending draw restore ---
	// Get to play phase first
	await emit(a, 'golf:ackPeek', {});
	await delay(100);
	await emit(b, 'golf:ackPeek', {});
	await delay(300);

	// Give the active player a pending draw then disconnect + rejoin
	const turnPid = turnPlayer(snapshotA);
	const turnSocket = turnPid === pidA ? a : b;
	const turnToken = turnPid === pidA ? createRes.playerToken : joinRes.playerToken;

	const drawRes2: any = await emit(turnSocket, 'golf:draw', {});
	if (drawRes2?.error) throw new Error('draw for pending-draw test: ' + drawRes2.error);
	console.log('✓ Drew card for pending-draw rejoin test');

	// Disconnect and rejoin
	turnSocket.disconnect();
	await delay(200);

	const rejoiningSocket = await connect();
	let pendingDrawRestored: any = null;
	rejoiningSocket.on('golf:pendingDraw', (card: any) => { pendingDrawRestored = card; });

	const rejoinRes: any = await emit(rejoiningSocket, 'rejoinGame', { playerToken: turnToken });
	if (rejoinRes?.error) throw new Error('rejoinGame: ' + rejoinRes.error);
	await delay(300);

	if (!pendingDrawRestored) throw new Error('Pending draw not restored on rejoin');
	if (pendingDrawRestored.cardId !== drawRes2.card.cardId) {
		throw new Error('Restored pending draw card mismatch');
	}
	console.log('✓ Pending draw restored on rejoin:', pendingDrawRestored.rank, pendingDrawRestored.suit);

	// --- Done ---
	a.close();
	b.close();
	rejoiningSocket.close();
	console.log('\n✅ Golf E2E OK');
}

run().catch((e) => {
	console.error('\n❌ Golf E2E failed:', e.message);
	process.exit(1);
});
