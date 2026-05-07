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


