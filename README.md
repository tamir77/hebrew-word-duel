# המילה האחרונה — Hebrew Word Duel MVP

A mobile-first, real-time two-player Hebrew word game.

## Product requirements

- [Full PRD in Russian](docs/PRD.md)
- [Current validation and known gaps](docs/VALIDATION.md)
- [GitHub and Render deployment](docs/DEPLOYMENT.md)

The PRD includes target behavior that is not yet implemented. The server in this package preserves the original MVP behavior; review the validation notes before treating it as public-release ready.

## MVP flow

1. Player 1 creates a room and shares its URL.
2. Player 2 joins in a browser.
3. Player 1 selects 15, 30, or 60 seconds per turn; both players mark themselves ready.
4. A synchronized casino-style roulette spins and stops automatically. The server selects the opening word and randomly assigns the first turn.
5. Players alternately add, remove, or replace exactly one letter. Used words cannot repeat.
6. Every player has one joker that submits a valid move automatically.
7. Unknown dictionary words are sent to the opponent for approval.
8. A player who runs out of time loses the round.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browser windows.

## Render

This is a single Render Web Service. It serves the browser client and accepts WebSocket connections on the same public port.

- Build command: `npm ci`
- Start command: `npm start`
- Health check: `/health`
- The server listens on `0.0.0.0:$PORT`.

The included `render.yaml` is ready for a Git-backed Render Blueprint.

## MVP limitations

- Rooms are stored in memory and disappear after a restart or idle free-tier spin-down.
- The local SQLite dictionary contains 12,655 standalone singular noun spellings imported from Hspell 1.4 (12,625 unique keys after game normalization). Hspell data is AGPL-3.0-only; see `data/README.md`, `data/LICENSE-HSPELL.txt`, and `data/COPYING-HSPELL-AGPL-3.0.txt`.
- The imported list is mechanically filtered and still needs Hebrew-language editorial review before a public release.
- There are no accounts, rankings, moderation, analytics, or persistent match history yet.
