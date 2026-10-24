# skribbl-clone

A multiplayer drawing and guessing game that runs in the browser, inspired by skribbl.io.

Live demo: https://skribble-clone-d061.onrender.com
The app is hosted on a free Render instance that spins down when idle. The first request can take about a minute to wake up.

## Features

- Room creation and joining with 5-character room codes
- Customizable room settings (round count, draw time, hint count, word count, public or private toggle)
- Turn-based drawing with HTML5 canvas (brush, eraser, size picker, 16-color palette, undo, and clear)
- Three word modes: Normal, Hidden (word length masked with a question mark), and Combination (two-word phrases)
- Real-time guessing and segregated chat (guessers only see wrong guesses, drawers and players who guessed chat in a private channel)
- Automatic hints revealed at equal intervals across each turn
- Time-based scoring for guessers and fixed points per guess for the drawer
- Session rejoin via sessionStorage tokens so page refreshes or short drops do not drop the player from the game
- 30-second disconnect grace period before a player is removed from the room

## Tech Stack

- Frontend: React 19, TypeScript, Vite, Vanilla CSS
- Backend: Node.js, Express, Socket.IO, TypeScript, tsup
- Shared: TypeScript types and event definitions shared by client and server
- Testing: Node.js native test runner (`node:test`) and tsx

## Folder Structure

```
.
├── client/          React frontend, canvas logic, UI components, styles
├── server/          Express app, Socket.IO handlers, Game, Room, and Player classes
├── shared/          Common TypeScript interfaces, enums, and socket event names
├── package.json     Root workspaces configuration, build and start scripts
└── tsconfig.base.json Shared TypeScript compiler configuration
```

## Local Setup

### Requirements

- Node.js 20 or higher
- npm 10 or higher

### Installation

Clone the repository and install all dependencies from the root:

```bash
git clone https://github.com/Ashmit76311/Skribble-Clone.git
cd Skribble-Clone
npm install
```

### Environment Variables

Create `.env` files if you want to override defaults.

In `server/.env`:
```
PORT=3001
CLIENT_URL=http://localhost:5173
```

In `client/.env`:
```
VITE_SERVER_URL=http://localhost:3001
```

If `VITE_SERVER_URL` is omitted, the client connects to `http://localhost:3001` in development, and to the same origin in production.

### Running in Development

Start both the backend and frontend dev servers concurrently:

```bash
npm run dev
```

- Frontend runs at: http://localhost:5173
- Backend runs at: http://localhost:3001

## Production Build

Build the client, the server, and copy runtime assets:

```bash
npm run build
```

This compiles:
1. `client/` into `client/dist/` via Vite
2. `server/` into `server/dist/index.js` via tsup, bundling `@skribbl/shared` and copying `words.json` into `server/dist/`

Run the production server from the repository root:

```bash
npm start
```

The production server listens on the `PORT` specified in the environment (default `3001`) and binds to `0.0.0.0`. It serves the compiled React app as static files, handles API requests, and runs Socket.IO on the same port.

## Deployment on Render

This project is deployed as a single Web Service on Render.

- Environment: Node
- Build Command: `npm ci && npm run build`
- Start Command: `npm start`
- Environment Variables:
  - `NODE_ENV`: `production`
- Health check path: `/health`
- Instance: 1 instance (free tier)

Express handles `/health`, `/api/*`, static assets from `client/dist`, and a wildcard fallback `*` that returns `index.html` for client-side routing (`/room/:code`). Socket.IO attaches to the same HTTP server instance, so no cross-origin configuration is needed in production.

## Known Limitations

- All rooms, active games, and player sessions are stored in server memory. Restarting or redeploying the server clears all active rooms and disconnects players.
- Designed for a single server instance. Running multiple instances would require an external pub/sub adapter (such as Redis) to share game state and socket broadcasts across nodes.
