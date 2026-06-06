import { io, Socket } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';

// Run the server under test with a short TTL so we don't wait an hour:
//   GAME_TTL_MS=1500 REAP_INTERVAL_MS=700 npm run dev
const WAIT_MS = Number(process.env.WAIT_MS) || 3500;

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
function emit<T>(s: Socket, event: string, payload: unknown): Promise<T> {
	return new Promise((resolve) => s.emit(event, payload, resolve as (r: T) => void));
}

const golfConfig = {
	maxPlayers: 8,
	totalCardsPerDeck: 52,
	numberOfDecks: 1,
	cardsPerPlayer: 4,
	gameMode: 'golf',
};

async function run() {
	console.log('--- Reaper E2E ---');

	// 1. An "abandoned" game: two players that will both disconnect.
	const a = await connect();
	const createAbandoned: any = await emit(a, 'createGame', { displayName: 'A', config: golfConfig });
	assert(!createAbandoned?.error, `createGame failed: ${createAbandoned?.error}`);
	const abandonedCode = createAbandoned.code;
	const abandonedToken = createAbandoned.playerToken;

	const b = await connect();
	const joinB: any = await emit(b, 'joinGame', { code: abandonedCode, displayName: 'B' });
	assert(!joinB?.error, `joinGame failed: ${joinB?.error}`);
	console.log(`Abandoned game ${abandonedCode} created with 2 players`);

	// 2. A "live" game whose host stays connected — must survive the sweep.
	const host = await connect();
	const createLive: any = await emit(host, 'createGame', { displayName: 'Host', config: golfConfig });
	assert(!createLive?.error, `createGame failed: ${createLive?.error}`);
	const liveCode = createLive.code;
	console.log(`Live game ${liveCode} created (host stays connected)`);

	// 3. Everyone in the abandoned game leaves.
	a.close();
	b.close();
	console.log(`Both players of ${abandonedCode} disconnected; waiting ${WAIT_MS}ms for reaper...`);
	await delay(WAIT_MS);

	// 4. The abandoned game is gone: token and code both resolve to nothing.
	const probe = await connect();
	const rejoin: any = await emit(probe, 'rejoinGame', { playerToken: abandonedToken });
	assert(
		rejoin?.error === 'Invalid token',
		`expected abandoned token reaped, got ${JSON.stringify(rejoin)}`,
	);
	const joinDead: any = await emit(probe, 'joinGame', { code: abandonedCode, displayName: 'C' });
	assert(
		joinDead?.error === 'Invalid code',
		`expected abandoned code reaped, got ${JSON.stringify(joinDead)}`,
	);
	console.log('✓ Abandoned game reaped (token + code freed)');

	// 5. The live game survived — still joinable.
	const joinLive: any = await emit(probe, 'joinGame', { code: liveCode, displayName: 'D' });
	assert(!joinLive?.error, `live game should survive reaper, got ${JSON.stringify(joinLive)}`);
	console.log('✓ Live game survived the sweep');

	probe.close();
	host.close();
	console.log('\n✅ Reaper E2E OK');
	process.exit(0);
}

run().catch((err) => {
	console.error('\n❌ Reaper test failed:', err);
	process.exit(1);
});
