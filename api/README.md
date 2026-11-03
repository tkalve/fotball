# Fotball — api

The matchmaking and realtime backend: one Cloudflare Worker with a single
Durable Object (`GameHub`). It also serves the built frontend (`../frontend/dist`)
as static assets, so the whole game runs from one Worker on one origin.

```bash
npm install
npm run dev     # wrangler dev on :8787 (build the frontend first for assets)
```

`npm run deploy` builds the frontend and runs `wrangler deploy`. CI does the same
via `.github/workflows/deploy.yml`, which needs the repo secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## How it works

Every browser opens a WebSocket to `/ws`; the Worker routes them all to the one
`GameHub` instance (`idFromName("hub")`), which holds the lounge, the share-code
registry, pending pair offers, and every live match in memory.

- **Lounge / auto-pair** — players willing to play sit in a pool. Whenever two are
  free, both get a 30-second `offer`; the match starts only if both `accept`. A
  decline/timeout sits the decliner out until they ask again.
- **Share codes** — each connection is given a unique colour+object code (e.g.
  `blue apple`). `joinCode` pairs two players directly, no countdown.
- **A match** — alternating rounds, first to five goals. The striker's `shoot`
  and the keeper's `dive` are relayed; the keeper is authoritative and reports
  the `result`, so the Worker updates the score, checks for a winner, and starts
  the next round with the roles swapped.

`src/protocol.ts` is the wire contract (kept in sync with
`../frontend/src/net/protocol.ts`). `src/index.ts` is the Worker + Durable Object.
