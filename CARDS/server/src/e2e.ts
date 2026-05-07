import { io } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

function delay(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
	const a = io(SERVER_URL, { transports: ['websocket'] });
	const b = io(SERVER_URL, { transports: ['websocket'] });

	let gameId = '';
	let code = '';

	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('A did not connect')), 5000);
		a.on('connect', () => { clearTimeout(timeout); resolve(); });
	});
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error('B did not connect')), 5000);
		b.on('connect', () => { clearTimeout(timeout); resolve(); });
	});

	// Create game from A
	const createRes: any = await new Promise((resolve) => {
		a.emit('createGame', { displayName: 'Host A', config: { maxPlayers: 4, totalCardsPerDeck: 52, numberOfDecks: 1, cardsPerPlayer: 7 } }, resolve);
	});
	if (createRes?.error) throw new Error('createGame failed: ' + createRes.error);
	gameId = createRes.gameId;
	code = createRes.code;
	console.log('Created game', { gameId, code });

	// Join game from B
	const joinRes: any = await new Promise((resolve) => {
		b.emit('joinGame', { code, displayName: 'Player B' }, resolve);
	});
	if (joinRes?.error) throw new Error('joinGame failed: ' + joinRes.error);
	console.log('B joined');

	// Start game from A
	const startRes: any = await new Promise((resolve) => {
		a.emit('startGame', {}, resolve);
	});
	if (startRes?.error) throw new Error('startGame failed: ' + startRes.error);
	console.log('Game started');

	let handB: any[] = [];
	b.on('hand:update', (cards) => { handB = cards; });
	await delay(500);
	if (!handB.length) throw new Error('B did not receive hand');

	// Play a card from B
	const playCardId = handB[0].cardId;
	const playRes: any = await new Promise((resolve) => {
		b.emit('playCard', { cardId: playCardId }, resolve);
	});
	if (playRes?.error) throw new Error('playCard failed: ' + playRes.error);
	console.log('B played 1 card');

	// Draw a card from B
	const drawRes: any = await new Promise((resolve) => {
		b.emit('drawCard', {}, resolve);
	});
	if (drawRes?.error) throw new Error('drawCard failed: ' + drawRes.error);
	console.log('B drew 1 card');

	// Error: invalid code
	const badJoin: any = await new Promise((resolve) => {
		const c = io(SERVER_URL, { transports: ['websocket'] });
		c.on('connect', () => c.emit('joinGame', { code: '9999', displayName: 'Bad' }, (r: any) => { resolve(r); c.close(); }));
	});
	if (!badJoin?.error) throw new Error('Expected invalid code error');
	console.log('Invalid code error verified');

	a.close();
	b.close();
	console.log('E2E OK');
}

run().catch((e) => {
	console.error(e);
	process.exit(1);
});
