# The Card Room — Golf & Cabo

A browser card room for 2–8 friends. Create a room, share its invite link or four-digit code, and play without accounts or app installs. The lowest score wins.

The welcome screen includes a first-game walkthrough. **Rules & how to play** is available from the lobby, table, and results screens, with separate guides for Golf and Cabo. The canonical house rules and scoring examples are in [GOLF_RULES.md](GOLF_RULES.md).

## Run locally

Use Node.js 20 or newer. Install each package from its own directory:

```sh
cd CARDS/server
npm ci
npm run dev
```

In another terminal:

```sh
cd CARDS/client
npm ci
npm run dev
```

Open http://localhost:5173. The server uses http://localhost:3001 by default. For another backend address, copy `client/.env.example` to `client/.env` and set `VITE_SERVER_URL`. Restart the client after changing it.

Seats are stored per browser tab and survive refreshes. Separate tabs can join as separate players. Test with at least two tabs or devices.

## Current behavior

- Golf supports 4, 6, or 8 cards, rank-based combinations, King bonuses, and extra rounds when the lowest totals tie.
- Cabo supports peeks, spies, blind swaps, Black King decisions, snaps, and final turns after calling Cabo.
- The server sends only authorized card values. Hidden cards are not merely concealed by the interface.
- Refresh restores the correct lobby or table and pending decisions.
- A disconnected player has 30 seconds to return. The host role transfers to a connected player immediately. If someone stays online, an absent player leaves after the grace period.
- Play pauses with fewer than two connected players. If fewer than two players remain in the room, it returns to the lobby.
- Leaving a running match forfeits your seat.
- Classic is retained only for compatibility; it is not offered in the public interface.

## Tests

Start a separate test server from `CARDS/server`:

```sh
TEST_HOOKS=1 GAME_TTL_MS=1500 REAP_INTERVAL_MS=700 npm run dev
```

Then, from `CARDS/server`, run these sequentially:

```sh
npm run test:dealing
npm run test:dealing:golf
npm run test:reaper
npm run test:validation
npm run e2e
npm run e2e:golf
npm run e2e:cabo
npm run e2e:cabo:specials
npm run test:release
```

Tests accept `SERVER_URL` for a different test server. The test-hook server must not be shared with normal players; deterministic-deck suites must run sequentially.

`test:release` covers hidden own-card privacy, refresh without re-peeking, one connection per seat, invalid actions, duplicate draws, disconnect readiness, host transfer, forfeits, complete Golf and Cabo matches/rematches, Golf tie-break rounds, eight-player/eight-card Golf, and a Black King decision restored after reconnect.

CI runs all nine suites and both production builds. The existing script tests do not replace final browser and real-device checks.

## Production builds

```sh
# CARDS/server
npm run build
npm start

# CARDS/client
npm run build
npm run preview
```

`preview` is for inspecting the client build locally; it still needs the backend server.

## Deployment

The backend needs a persistent Node process and WebSocket support. The frontend is a static Vite build. Existing configurations support either Fly.io or Render for the backend, with Vercel for the frontend.

1. Deploy `CARDS/server` using its Fly configuration or the repository's Render blueprint.
2. Verify the backend's `/health` endpoint returns `ok`.
3. Deploy `CARDS/client` to Vercel with `VITE_SERVER_URL` set to the backend's public HTTPS URL. This value is baked into the client build, so redeploy after changing it.
4. Set backend `ALLOWED_ORIGIN` to the frontend's public origin.
5. Keep `TEST_HOOKS` unset. Test hooks are also forcibly disabled when `NODE_ENV=production`.
6. Keep the backend to one instance: room state is in process memory.
7. Test the public game from two separate devices/networks, including a complete match, refresh, disconnect/rejoin, results, and rematch.

For Fly.io, deploy from `CARDS/server` using `fly deploy`; its app name must match your own existing Fly application. For Render, import the repository blueprint in the hosting dashboard. For Vercel, use `CARDS/client` as the root directory and Vite as the framework.

### Limits

Rooms and scores are held in memory. A server restart or deployment ends active rooms. Abandoned rooms expire after one hour by default. The interface explains expired rooms and lets players create a new one. This is a casual single-server game; it does not promise persistent saved matches or a cross-session global ranking.

## Release status

The implementation and automated checks are complete for this local milestone. Public hosting, a final small-screen/device playtest, and the Handshake submission remain. See `.scratch/contest-release/PRD.md` at the repository root for the current checklist.
