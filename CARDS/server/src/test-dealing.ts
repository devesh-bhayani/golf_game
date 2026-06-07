import { io } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mirror of the server's deck-sizing rule (server/src/index.ts decksNeeded).
const CARDS_PER_DECK = 52;
const DRAW_PILE_HEADROOM = 12;
function decksNeeded(numPlayers: number, cardsPerPlayer: number): number {
	const cardsRequired = numPlayers * cardsPerPlayer + DRAW_PILE_HEADROOM;
	return Math.max(1, Math.ceil(cardsRequired / CARDS_PER_DECK));
}

async function testDealing(players: number, cardsPerPlayer: number) {
	console.log(`\nTesting ${players} players, ${cardsPerPlayer} cards each:`);
	
	const clients = Array.from({ length: players }, () => io(SERVER_URL, { transports: ['websocket'] }));
	
	// Wait for all to connect
	await Promise.all(clients.map(client => new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('Client did not connect')), 5000);
		client.on('connect', () => { clearTimeout(timeout); resolve(); });
	})));

	// Create game from first client
	const createRes: any = await new Promise((resolve) => {
		clients[0].emit('createGame', { 
			displayName: 'Host', 
			config: { maxPlayers: 8, totalCardsPerDeck: 52, numberOfDecks: 1, cardsPerPlayer } 
		}, resolve);
	});
	
	if (createRes?.error) throw new Error('createGame failed: ' + createRes.error);
	const code = createRes.code;

	// Join from other clients
	for (let i = 1; i < players; i++) {
		const joinRes: any = await new Promise((resolve) => {
			clients[i].emit('joinGame', { code, displayName: `Player ${i + 1}` }, resolve);
		});
		if (joinRes?.error) throw new Error(`joinGame failed for player ${i + 1}: ` + joinRes.error);
	}

	// Collect hands and game state
	const hands: any[][] = Array.from({ length: players }, () => []);
	let gameState: any = null;
	
	clients.forEach((client, i) => {
		client.on('hand:update', (cards) => { hands[i] = cards; });
	});
	
	clients[0].on('game:update', (game: any) => {
		gameState = game;
	});

	// Start game
	const startRes: any = await new Promise((resolve) => {
		clients[0].emit('startGame', {}, resolve);
	});
	if (startRes?.error) throw new Error('startGame failed: ' + startRes.error);

	await delay(500);

	// Verify dealing
	let totalDealt = 0;
	for (let i = 0; i < players; i++) {
		console.log(`  Player ${i + 1}: ${hands[i].length} cards`);
		totalDealt += hands[i].length;
		if (hands[i].length !== cardsPerPlayer) {
			throw new Error(`Player ${i + 1} got ${hands[i].length} cards, expected ${cardsPerPlayer}`);
		}
	}

	const deckTotal = decksNeeded(players, cardsPerPlayer) * 52;
	const expectedExtra = deckTotal - (players * cardsPerPlayer);
	console.log(`  Total dealt: ${totalDealt}, deck total: ${deckTotal}, Expected extra: ${expectedExtra}`);

	// Check game state
	await delay(200);
	
	if (!gameState) {
		throw new Error('No game state received');
	}
	
	const extraDeckCount = gameState.extraDeckCount;
	if (extraDeckCount !== expectedExtra) {
		throw new Error(`Extra deck has ${extraDeckCount} cards, expected ${expectedExtra}`);
	}

	console.log(`  ✓ Correct: ${players} × ${cardsPerPlayer} = ${totalDealt} dealt, ${extraDeckCount} remaining`);

	// Cleanup
	clients.forEach(client => client.close());
}

async function runTests() {
	try {
		await testDealing(2, 5);  // 1 deck: 10 dealt, 42 remaining
		await testDealing(3, 7);  // 1 deck: 21 dealt, 31 remaining
		await testDealing(4, 13); // 2 decks: 52 dealt, 52 remaining (was 0 — broken before fix)
		await testDealing(2, 1);  // 1 deck: 2 dealt, 50 remaining
		await testDealing(8, 8);  // 2 decks: 64 dealt, 40 remaining (overflowed 1 deck before fix)
		await testDealing(8, 13); // 3 decks: 104 dealt, 52 remaining (largest reachable table)
		console.log('\n✅ All dealing tests passed!');
	} catch (error) {
		console.error('\n❌ Test failed:', error);
		process.exit(1);
	}
}

runTests();
