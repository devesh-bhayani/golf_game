import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(cond: unknown, msg: string) {
	if (!cond) throw new Error(msg);
}

// Verifies the server scales the deck to the table size. An 8-player golf game
// with 8 cards each needs 64 cards just for hands — more than one 52-card deck.
// Before the deck-scaling fix this dealt `undefined` cards and left an empty
// draw pile. Now it must allocate enough decks for full hands + a draw pile.
async function testGolfDealing(players: number, cardsPerPlayer: number) {
	console.log(`\nGolf dealing: ${players} players, ${cardsPerPlayer} cards each`);

	const clients: Socket[] = Array.from({ length: players }, () =>
		io(SERVER_URL, { transports: ['websocket'] }),
	);

	await Promise.all(
		clients.map(
			(c) =>
				new Promise<void>((resolve, reject) => {
					const t = setTimeout(() => reject(new Error('client did not connect')), 5000);
					c.on('connect', () => {
						clearTimeout(t);
						resolve();
					});
				}),
		),
	);

	// Each client records its own private hand and the latest public snapshot.
	const privateHands: any[][] = Array.from({ length: players }, () => []);
	let snapshot: any = null;
	clients.forEach((c, i) => {
		c.on('golf:hand', (slots: any[]) => {
			privateHands[i] = slots;
		});
		c.on('game:update', (game: any) => {
			snapshot = game;
		});
	});

	const config = {
		maxPlayers: 8,
		totalCardsPerDeck: 52,
		numberOfDecks: 1, // intentionally wrong; server must override
		cardsPerPlayer,
		gameMode: 'golf',
	};

	const createRes: any = await new Promise((resolve) => {
		clients[0].emit('createGame', { displayName: 'Host', config }, resolve);
	});
	assert(!createRes?.error, `createGame failed: ${createRes?.error}`);
	const code = createRes.code;

	for (let i = 1; i < players; i++) {
		const joinRes: any = await new Promise((resolve) => {
			clients[i].emit('joinGame', { code, displayName: `P${i + 1}` }, resolve);
		});
		assert(!joinRes?.error, `joinGame failed for P${i + 1}: ${joinRes?.error}`);
	}

	const startRes: any = await new Promise((resolve) => {
		clients[0].emit('startGame', {}, resolve);
	});
	assert(!startRes?.error, `startGame failed: ${startRes?.error}`);

	await delay(600);

	// 1. Every player got a full hand of real (defined) cards.
	for (let i = 0; i < players; i++) {
		const hand = privateHands[i];
		assert(
			hand.length === cardsPerPlayer,
			`P${i + 1} got ${hand.length} slots, expected ${cardsPerPlayer}`,
		);
		hand.forEach((slot, s) => {
			assert(
				slot && slot.card && typeof slot.card.rank === 'string',
				`P${i + 1} slot ${s} has no real card (got ${JSON.stringify(slot?.card)})`,
			);
		});
	}
	console.log(`  ✓ All ${players} players have ${cardsPerPlayer} real cards (no undefined)`);

	// 2. A draw pile and a discard top exist (the game can actually be played).
	assert(snapshot, 'no public snapshot received');
	assert(
		snapshot.extraDeckCount > 0,
		`draw pile empty (extraDeckCount=${snapshot.extraDeckCount})`,
	);
	assert(snapshot.discardTop, 'no discard top card');
	console.log(
		`  ✓ Draw pile has ${snapshot.extraDeckCount} cards, discard top = ${snapshot.discardTop.rank} ${snapshot.discardTop.suit}`,
	);

	clients.forEach((c) => c.close());
}

async function run() {
	try {
		await testGolfDealing(2, 4); // small: 1 deck
		await testGolfDealing(8, 8); // largest reachable golf table: needs 2 decks
		console.log('\n✅ Golf dealing tests passed!');
	} catch (err) {
		console.error('\n❌ Golf dealing test failed:', err);
		process.exit(1);
	}
}

run();
