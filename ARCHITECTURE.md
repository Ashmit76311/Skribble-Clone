# Architecture

## 1. Overview

The app is built as a client-server architecture using WebSockets for real-time multiplayer synchronization.

```
+-------------------------------------------------------------+
| Browser Client (React, Canvas, Socket.IO Client)            |
+-------------------------------------------------------------+
                              |
                     WebSocket / HTTP
                              |
+-------------------------------------------------------------+
| Express HTTP Server + Socket.IO Server                      |
|                                                             |
|   +-----------------------------------------------------+   |
|   | RoomManager                                         |   |
|   |   - Map<code, Room>                                 |   |
|   |   - Map<socketId, code>                             |   |
|   +-----------------------------------------------------+   |
|                             |                               |
|   +-----------------------------------------------------+   |
|   | Room                                                |   |
|   |   - settings, chatHistory, players: Player[]        |   |
|   +-----------------------------------------------------+   |
|              |                              |               |
|   +--------------------+          +---------------------+   |
|   | Player             |          | Game                |   |
|   |   - id (stable)    |          |   - turnOrder       |   |
|   |   - token (secret) |          |   - strokes[]       |   |
|   |   - socketId       |          |   - timers          |   |
|   |   - isConnected    |          |   - hintManager     |   |
|   +--------------------+          +---------------------+   |
+-------------------------------------------------------------+
```

## 2. Server Classes

The server domain logic is separated into four classes under `server/src/`:

### RoomManager (`server/src/RoomManager.ts`)
- Owns the global registry of all active rooms (`Map<string, Room>`).
- Owns the mapping from socket ID to room code (`Map<string, string>`).
- Handles creating rooms, looking up rooms by code, listing public rooms for the lobby, and deleting rooms when empty.

### Room (`server/src/Room.ts`)
- Owns the room configuration (`RoomSettings`), phase, player list (`Player[]`), and chat history.
- Manages player lifecycle within the room (`addPlayer`, `removePlayer`, looking up players by ID, token, or current socket ID).
- Manages host reassignment when the current host leaves.
- Owns the `Game` instance (`game: Game | null`) when a match is active.
- Filters chat messages by player role so secret words do not leak.
- Clears all player grace timers on room destruction or reset.

### Player (`server/src/Player.ts`)
- Owns player identity:
  - `id`: Stable UUID generated once when the player first joins. Used across turn order, drawer ID, scoreboards, and state lookups.
  - `token`: Secret UUID generated once and delivered only to that specific player. Used to authenticate rejoin requests.
  - `socketId`: ID of the current active socket connection. Replaced whenever the player reconnects.
  - `isConnected`: Boolean tracking whether the player's socket is currently connected.
  - `disconnectTimer`: Node.js timer holding the 30-second grace countdown on disconnect.
  - `score`, `isHost`, `isDrawing`, `hasGuessed`: In-game player states.
- Exposes `toJSON()` returning `PlayerData`, which omits `token` and `socketId` to prevent leaking private identifiers.

### Game (`server/src/Game.ts`)
- Owns the state of an active match:
  - `turnOrder`: Array of player stable IDs defining the drawing sequence.
  - `turnIndex`: Current index into `turnOrder`.
  - `round`: Current round number.
  - `phase`: Current game phase (`WORD_SELECT`, `DRAWING`, `ROUND_END`, `GAME_OVER`).
  - `currentWord`: The chosen secret word for the current turn.
  - `wordOptions`: Array of words presented to the drawer.
  - `strokes`: Array of completed `Stroke` objects for the current turn.
  - `pendingStroke`: In-progress stroke receiving real-time move points.
  - `timer` and `hintTimers`: Server-side timeout handles for the turn timer and scheduled hint reveals.
  - `endsAt`: UTC timestamp in milliseconds when the current phase expires.
  - `hintManager`: Instance of `HintManager` handling mask generation and progressive letter reveals.
  - `guessOrder` and `turnScores`: Tracks the order of correct guesses and points earned in the current turn.

## 3. Event Flow

| Event Name | Direction | Payload | Description |
|---|---|---|---|
| `create_room` | Client -> Server | `{ name, settings }` | Creates a new room, returns `{ room, token, playerId }` in callback. |
| `join_room` | Client -> Server | `{ name, code }` | Joins an existing room, returns `{ room, token, playerId }` in callback. |
| `rejoin_room` | Client -> Server | `{ code, token }` | Validates token, attaches new socket, returns full game state. |
| `start_game` | Client -> Server | none | Sent by host to begin the match. |
| `select_word` | Client -> Server | `{ word }` | Sent by drawer to choose a word from options. |
| `draw_start` | Client -> Server | `{ x, y, color, size, tool }` | Starts a stroke on the server. |
| `draw_move` | Client -> Server | `{ x, y }` | Adds coordinates to current stroke. |
| `draw_end` | Client -> Server | none | Finalizes the current stroke on the server. |
| `draw_data` | Server -> Room | `{ type, x, y, color, size, tool }` | Relays drawing action to all players. |
| `draw_undo` | Client -> Server | none | Removes the last stroke, server broadcasts remaining strokes. |
| `canvas_clear` | Client -> Server | none | Clears all strokes, server broadcasts empty canvas. |
| `guess` | Client -> Server | `{ text }` | Submits a guess during drawing phase. |
| `guess_result` | Server -> Room | `{ playerId, playerName, correct, points, scores }` | Notifies room of a correct guess with updated scores. |
| `chat` | Client -> Server | `{ text }` | Sends a message; routed as a guess or chat depending on phase and role. |
| `chat_message` | Server -> Client(s) | `{ playerId, name, text, type }` | Delivers chat message to authorized recipients. |
| `round_start` | Server -> Client(s) | `{ round, drawerId, endsAt, wordOptions? }` | Starts word selection; wordOptions sent only to drawer. |
| `word_chosen` | Server -> Client(s) | `{ wordLength, endsAt, word?, hint? }` | Notifies turn start; full word sent only to drawer. |
| `hint_update` | Server -> Client(s) | `{ hint }` | Sends updated masked string to guessers who have not guessed. |
| `round_end` | Server -> Room | `{ word, scores, turnPoints, nextDrawerId }` | Ends turn, reveals word, distributes points. |
| `game_over` | Server -> Room | `{ winner, winners, leaderboard }` | Ends game, announces final standings. |
| `play_again` | Client -> Server | none | Sent by host to return room to lobby. |
| `game_state` | Server -> Client | `{ room, strokes, hint }` | Full synchronization sent to a player. |
| `player_joined` | Server -> Room | `{ player, players }` | Broadcast when a new player joins. |
| `player_left` | Server -> Room | `{ playerId, name, players }` | Broadcast when a player disconnects and grace period expires. |
| `host_changed` | Server -> Room | `{ hostId }` | Broadcast when room host changes. |
| `error` | Server -> Client | `{ message }` | Emitted when an action fails validation. |

## 4. Drawing

- **Capture**: The canvas uses Pointer Events (`onPointerDown`, `onPointerMove`, `onPointerUp`, `onPointerCancel`) with `setPointerCapture` and CSS `touch-action: none`. This unifies mouse, stylus, and touch input into a single handler.
- **Normalization**: Pixel coordinates are converted to unit fractions between 0 and 1 relative to the canvas bounding box (`x = (clientX - rect.left) / rect.width`, `y = (clientY - rect.top) / rect.height`). This ensures drawing renders identically on screens of different sizes or aspect ratios.
- **Throttling**: In `Game.handleDrawMove`, moves from the drawer are throttled to a maximum of one point every 10 milliseconds.
- **Validation**: Server validates that `x` and `y` are numbers between 0 and 1, `color` is a 6-digit hex string (`^#[0-9a-f]{6}$`), `size` is an integer between 1 and 50, and `tool` is either `"brush"` or `"eraser"`.
- **Storage**: `strokes` is an array of `Stroke` objects on `Game`. Each stroke holds its point list, color, size, and tool.
- **Broadcast**: Server broadcasts `draw_data` to all clients in the room (including the drawer) so all browsers render from the same event stream.
- **Undo and Clear**:
  - `draw_undo`: Drawer emits `draw_undo`. The server pops the last element from `strokes` and broadcasts `draw_undo` with the remaining strokes.
  - `canvas_clear`: Drawer emits `canvas_clear`. The server sets `strokes = []` and broadcasts `canvas_clear`.
- **Late Join and Rejoin**: When a player joins mid-game or rejoins after a refresh, the server includes the full `strokes` array in the response. The client iterates through all strokes and repaints them onto the canvas.

## 5. Game State and Turn Management

- **Phases**: `GamePhase` has five states:
  1. `LOBBY`: Waiting for players.
  2. `WORD_SELECT`: Drawer has 15 seconds to choose a word. If time expires, the server picks randomly.
  3. `DRAWING`: Drawer draws, guessers guess, hints reveal periodically.
  4. `ROUND_END`: 5-second pause displaying the revealed word and turn points.
  5. `GAME_OVER`: Final scoreboard displayed with Play Again option for the host.
- **Turn Order**: Formed at game start by copying the list of player stable IDs. The drawer rotates sequentially. When all players have drawn, `round` increments.
- **Timers**:
  - Phase expiration is tracked on the server as an absolute timestamp (`endsAt = Date.now() + durationMs`).
  - Clients compute remaining seconds locally using `Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))`, keeping the UI timer in sync without requiring per-second socket ticks.
- **Early Turn End**: When all connected guessers have correctly guessed the word, the turn ends immediately without waiting for the full draw time to expire.
- **Disconnects During Game**:
  - If a guesser disconnects, they are excluded from the "all guessers have guessed" check so they do not hold up the turn.
  - If the drawer disconnects, their turn timer keeps running for up to 30 seconds. If they rejoin within 30 seconds, they resume drawing. If the grace timer expires, the turn is skipped (`word: "(skipped)"`).
  - If fewer than 2 players remain connected, the game only ends after the disconnected player's 30-second grace period expires.

## 6. Word Secrecy

The server never broadcasts the secret word to guessers before the turn is over.

- **Payload Filtering**:
  - In `Game.buildRoomData(forPlayerId)`:
    ```ts
    const canSeeWord = isDrawer || hasGuessed || phase === ROUND_END || phase === GAME_OVER;
    ```
    If `canSeeWord` is false, `word` is sent as `null`. `hint` contains only the masked representation.
  - `round_start`: The `wordOptions` array is sent only to the drawer's socket (`io.to(drawer.socketId)`). Other players receive `round_start` with only `round`, `drawerId`, and `endsAt`.
  - `word_chosen`: The drawer receives `{ word, hint: word }`. Guessers receive `{ wordLength, hint: maskedHint }`.
  - `guess_result`: Broadcasts that a player guessed correctly along with their score, but does not include the word.
  - After guessing correctly, the server sends a private `word_chosen` update containing the word only to that guesser's socket.
- **Per-Socket Routing**: All individual payloads are emitted using `player.socketId`, while internal game state maps to the player's stable `player.id`.

## 7. Word Matching

Implemented in `server/src/wordMatching.ts`:

- **Normalize**: `normalize(text)` converts to lowercase, trims leading/trailing whitespace, and collapses multiple internal spaces into a single space (`replace(/\s+/g, " ")`).
- **Exact Match**: `isCorrectGuess(guess, word)` checks `normalize(guess) === normalize(word)`.
- **Close Guess**: `isCloseGuess(guess, word)` computes Levenshtein edit distance. If the distance is exactly 1 and the word length is greater than 3 letters, it returns true. The guesser receives a private system message (`'guess' is close!`) and the guess is hidden from everyone else.
- **Secret Word Blocking**: `containsSecretWord(guess, word)` uses a regex with word boundaries (`\b${escapedWord}\b`). If a player who has not guessed yet includes the secret word inside a longer chat message, the message is blocked and they receive a private warning so the word is not spoiled for others.

## 8. Scoring and Hints

### Scoring (`server/src/scoring.ts`)
- **Guesser Points**:
  ```
  points = 100 + round(400 * (remainingMs / totalMs)) + (isFirst ? 50 : 0)
  ```
  A correct guess awards between 100 points (last second) and 500 points (instant guess), plus a 50-point bonus for the first player to guess.
- **Drawer Points**:
  The drawer earns a flat 75 points for every guesser who finds the word during their turn.

### Hints (`server/src/hints.ts`)
- **Hint Count**: Capped at `floor(word.length / 2)` to ensure at least half the letters remain hidden.
- **Intervals**: If a turn allows $N$ hints and lasts $T$ milliseconds, hints are scheduled at intervals of $T / (N + 1)$.
- **Selection**: Unrevealed character indices are shuffled and revealed one letter at a time.
- **Modes**:
  - `Normal`: Blanks represented as `_ _ _ _ _`, spaces preserved, letters revealed over time.
  - `Hidden`: Displays a single `?`. Word length is set to `null` and hints are disabled.
  - `Combination`: Two words separated by a space (e.g. `cat dog`). Displays `_ _ _   _ _ _`, hints reveal letters across the phrase while preserving spacing.

## 9. Session Rejoin

Session rejoin allows players to survive page refreshes or brief network drops without losing their seat or disrupting games.

- **Dual Identity**:
  - Every player has a stable `id` (`crypto.randomUUID()`) and a secret `token` (`crypto.randomUUID()`).
  - The `token` is sent only in the direct acknowledgment callback to that specific player upon `create_room` or `join_room`. It is never placed in `room.players` or broadcast.
  - The client stores `{ code, token, playerId }` in `sessionStorage`.
- **Rejoining**:
  - On loading `/room/:code` or on socket reconnect, the client emits `rejoin_room { code, token }`.
  - The server verifies that the token exists in that specific room, cancels any active disconnect grace timer, marks the player connected, and maps their new `socketId`.
  - The server returns the player's full context: room data (with word if authorized), current strokes, whether they have already guessed, and up to the last 50 chat messages they are permitted to view.
  - If rejoin fails (room deleted or token expired), the client clears `sessionStorage` and falls back to the normal join screen.
- **30-Second Grace Period**:
  - When a socket disconnects, the player is not removed immediately. They are marked `isConnected = false`, and an offline tag is shown to other players.
  - A 30-second timer starts (`player.disconnectTimer = setTimeout(..., 30000)`).
  - If the player returns within 30 seconds, `clearTimeout` cancels the grace timer.
  - If the timer expires, the player is formally removed via `room.removePlayer()`, reassigning host, skipping turn if they were drawing, or ending the game if fewer than 2 players remain.

## 10. Deployment Architecture

- **Single Service**:
  - Both Express HTTP routes and Socket.IO are hosted on the same Node.js server.
  - In production (`NODE_ENV=production`), Express serves static assets from `client/dist`. A wildcard route (`app.get("*", ...)`) serves `client/dist/index.html` for client-side routing (`/room/:code`).
  - Socket.IO attaches directly to the HTTP server, sharing the same port (e.g. 3001 locally, or `PORT` provided by Render).
- **Persistent Server vs Serverless**:
  - This application requires a persistent Node.js server (such as Render Web Services, Railway, or VPS).
  - Serverless platforms like Vercel or Netlify execute stateless, short-lived functions that shut down after an HTTP request finishes. They cannot maintain long-lived WebSocket TCP connections, in-memory rooms, or active turn timers (`setTimeout`).
