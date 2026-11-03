# Fotball — frontend

A two-player online penalty game. Two people open the site, get paired in the
lounge, and play a shootout against each other: each round one player strikes and
the other keeps goal, roles alternate, first to five goals wins.

The matchmaking + realtime backend lives in [`../api`](../api) (a Cloudflare
Worker with a Durable Object). In local development, run both:

```bash
npm install
npm run dev            # Vite on :5173, proxies /ws to the Worker
# in ../api, in another terminal:
#   npm install && npm run dev   # wrangler dev on :8787
```

Vite proxies the `/ws` socket to `wrangler dev`, so the lounge works end to end
while developing. In production the Worker serves this app's built `dist/` as
static assets and handles `/ws` itself — one origin, no CORS.

## Pairing

Open the site and you drop into the **lounge**. When a second player is waiting,
both are asked to pair up with a 30-second countdown; if both say yes, the match
starts. You also get a kid-friendly **share code** — a colour and an object like
`blue apple` — that a friend can enter (pick the colour, pick the object) to play
you directly.

## Playing

**Striker** — move the mouse to place the reticle anywhere on the goal, hold the
button to charge the power meter (it sweeps up and back down, so timing it is
the skill), and slide sideways while holding to put bend on the ball. Release to
shoot. The reticle is honest: the launch velocity is solved against the full
flight model, so the ball lands where you pointed. Spin changes the *path*, not
the destination — that is how you bend one round the keeper.

**Keeper** — watch the run-up, then click where you want to throw your gloves, or
use `Q W E` / `A S D` for the six standard dives. The striker's approach angle
leans towards where the shot is going, but not reliably. Commit too early and you
are beaten.

## Layout

```
src/
  App.tsx            lobby/match orchestration over the socket
  net/
    protocol.ts      shared wire types + the code word lists
    MatchClient.ts   the WebSocket, typed message fan-out, auto-reconnect
  ui/
    Lobby.tsx        waiting, the 30s pair offer, share code + join picker
    MatchStage.tsx   owns the Game, wires it to the socket, match HUD
    PowerMeter.tsx   writes to the DOM directly at 60 Hz
  game/
    Game.ts          round state machine, input, cameras, collisions, online hooks
    World.ts         scene, lights, pitch, markings, goal loading, netting
    Ball.ts          ball mesh plus gravity / drag / Magnus integration
    Figure.ts        shared player rig with aimable, stretchable limbs
    Keeper.ts        set position and the dive pose
    Striker.ts       the run-up and strike animation
    physics.ts       trajectory simulation and the shot solver
    textures.ts      procedural turf, football panelling, sky and net mask
    constants.ts     every tunable number, in metres and seconds
```

Online rounds are deterministic given the shot (target, speed, curve), so both
clients replay the same flight. The **keeper is the single authority** for the
outcome — the save depends on their reaction timing, which only they know
precisely — and reports it up; the striker just waits for that word. The server
(the Durable Object) owns the score, alternates roles, and drives each round.

`public/NewGoalll.glb` supplies the goal: a `Frame` mesh plus `Net 1` (back and
roof), `Net 2` and `Net 3` (the side panels). It is scaled at load time so the
crossbar sits at 2.44 m, which makes the mouth 4.69 x 2.34 m.

Two things are read off the mesh rather than hard-coded. The mouth dimensions
that decide goal, woodwork and wide come from the frame's own vertices: posts
and crossbar are the same tube, so the crossbar's thickness gives both the clear
height and how far the posts intrude on the width. And the netting's hole size
comes from measuring each panel's UV scale against its world size, because the
three panels are unwrapped independently — without that the holes come out a
different size on the sides than on the back.

The net meshes arrive as solid shells with a placeholder colour; the holes are
punched in with an alpha grid generated in `textures.ts`.

In development the running game is exposed as `window.fotball`, which is handy for
poking at the scene from the console.
