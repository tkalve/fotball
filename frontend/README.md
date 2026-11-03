# Goall — frontend

A two-player penalty game. One player shoots, the other keeps goal. The
multiplayer link-up comes later; for now you switch roles with the toggle in the
header and the other side is played by the computer.

```bash
npm install
npm run dev
```

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
  App.tsx            React shell: role toggle, scoreline, hints
  ui/PowerMeter.tsx  writes to the DOM directly at 60 Hz
  game/
    Game.ts          round state machine, input, cameras, collisions
    World.ts         scene, lights, pitch, markings, goal loading, netting
    Ball.ts          ball mesh plus gravity / drag / Magnus integration
    Figure.ts        shared player rig with aimable, stretchable limbs
    Keeper.ts        set position and the dive pose
    Striker.ts       the computer striker's run-up and strike
    physics.ts       trajectory simulation and the shot solver
    textures.ts      procedural turf, football panelling, sky and net mask
    constants.ts     every tunable number, in metres and seconds
```

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

In development the running game is exposed as `window.goall`, which is handy for
poking at the scene from the console.
