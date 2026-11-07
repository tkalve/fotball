# Copilot instructions for `fotball`

Two-player online penalty-shootout game. Two npm packages, **no root workspace** —
run npm commands from inside `frontend/` or `api/`.

- `frontend/` — Vite + React 19 + Three.js client (the game itself).
- `api/` — one Cloudflare Worker with a single Durable Object (`GameHub`) for
  matchmaking + realtime relay. In production it also serves the built
  `frontend/dist` as static assets, so the whole game runs from one origin.

## Build, test, lint

There is no test suite. Validate with typecheck and lint.

```bash
# frontend/
npm run dev        # Vite on :5173, proxies /ws to the Worker
npm run build      # tsc -b && vite build (this is also the typecheck)
npm run lint       # oxlint

# api/
npm run dev        # wrangler dev on :8787 (build the frontend first for assets)
npm run typecheck  # tsc --noEmit
npm run deploy     # builds the frontend, then wrangler deploy
```

Local dev needs **both** running: `vite` (:5173) proxies the `/ws` WebSocket to
`wrangler dev` (:8787). Deploy is automated for `main` via
`.github/workflows/deploy.yml` (needs repo secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`).

## Architecture

Every browser opens one WebSocket to `/ws`. The Worker routes all of them to a
single `GameHub` Durable Object (`idFromName("hub")`), which holds the lounge,
the share-code registry, pending pair offers, and every live match in memory.
`api/src/index.ts` is the whole Worker + Durable Object (~440 lines).

- **Auto-pair** — free players sit in a pool; when two are free both get a 30s
  `offer`, and the match starts only if both `accept`.
- **Share codes** — each connection gets a colour+object code (e.g. `blue apple`);
  `joinCode` pairs two players directly with no countdown.
- **Match** — alternating rounds, first to five goals. The striker's `shoot` and
  the keeper's `dive` are relayed. **The keeper is the single authority** for the
  outcome and reports `result`; the server owns the score, checks for a winner,
  and starts the next round with roles swapped.

Frontend game code lives in `frontend/src/game/`. `Game.ts` is the round state
machine + input + online hooks; `physics.ts` holds the trajectory simulation and
the shot solver; `constants.ts` holds every tunable number (SI units — metres,
seconds). `net/MatchClient.ts` is the typed WebSocket wrapper with auto-reconnect;
`App.tsx` orchestrates lobby↔match over it.

## Conventions

- **Wire protocol is duplicated, keep both copies in sync.**
  `api/src/protocol.ts` and `frontend/src/net/protocol.ts` must define the same
  `ClientMessage` / `ServerMessage` unions and the colour/object code word lists.
  Edit both when changing the protocol. Everything on the wire is JSON
  `{ type, ... }`.
- **Deterministic rounds** — given the shot (`target`, `speed`, `curve`) both
  clients replay the same flight, so only the outcome is authoritative, not the
  animation.
- **Goal geometry is read off the mesh, not hard-coded.** `public/NewGoalll.glb`
  is scaled so the crossbar sits at 2.44 m; mouth dimensions and net hole size are
  measured from the frame's vertices / UVs at load time (see `World.ts`).
- In dev the running game is exposed as `window.fotball` for console poking.
- No prettier/eslint config; oxlint (`frontend/.oxlintrc.json`) is the only
  linter and enforces React rules-of-hooks.
