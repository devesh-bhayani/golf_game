# Cards MVP

Monorepo with a Socket.IO TypeScript server and a Vite React client.

## Getting started

1. Install dependencies
   - In `server/`: `npm install`
   - In `client/`: `npm install`
2. Run
   - In `server/`: `npm run dev` (http://localhost:3001)
   - In `client/`: `npm run dev` (http://localhost:5173)

Set `VITE_SERVER_URL` in `client/.env` to point to the server if not localhost.

## Features
- Create/Join by 4-digit code
- Unique player IDs (socket.id for MVP)
- Private hands via per-socket events
- Play to center pile
- Draw from extra deck
- Real-time sync across clients

## Deploy (Fly.io backend + Vercel frontend)

Split deploy: Socket.IO server on Fly (persistent Node), static client on Vercel (CDN).

### 1. Backend → Fly.io

```sh
# one-time
curl -L https://fly.io/install.sh | sh
fly auth login

# from CARDS/server/
fly launch --no-deploy --copy-config   # accepts existing fly.toml; pick a unique app name if "golf-cards-api" taken
fly deploy
```

Verify: `curl https://<your-app>.fly.dev/health` → `ok`.

### 2. Frontend → Vercel

- Push repo to GitHub.
- Vercel dashboard → **New Project** → import repo.
- **Root Directory**: `CARDS/client` · **Framework**: Vite (auto-detected).
- **Environment Variable**: `VITE_SERVER_URL = https://<your-app>.fly.dev`
- Deploy. Vercel gives you e.g. `https://golf-cards.vercel.app`.

### 3. Tighten CORS

```sh
fly secrets set ALLOWED_ORIGIN=https://golf-cards.vercel.app -a <your-app>
```

(Auto-redeploys.) Done — share the Vercel URL.

### Notes
- State is in-memory; a Fly machine restart drops all active games. Acceptable for friends-scale.
- To change region edit `primary_region` in `CARDS/server/fly.toml` (e.g. `lhr`, `fra`, `sin`) and `fly deploy`.


