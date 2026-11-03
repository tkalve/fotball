/** Everything is in metres / seconds / radians. World axes: +X right, +Y up, +Z out of the goal. */

/** The goal mouth sits on the z = 0 plane; the shooter and the pitch live at positive z. */
export const GOAL_CROSSBAR_HEIGHT = 2.44
export const PENALTY_SPOT_Z = 8

/** Markings are sized for a small-sided pitch, to match the goal in goall.glb. */
export const PENALTY_AREA_DEPTH = 8.5
export const PENALTY_AREA_HALF_WIDTH = 7
export const GOAL_AREA_DEPTH = 3.2
export const GOAL_AREA_HALF_WIDTH = 3.6
export const PENALTY_ARC_RADIUS = 5.2
export const KEEPER_Z = 0.5

export const BALL_RADIUS = 0.11

export const GRAVITY = 9.81
/** 0.5 * rho * Cd * A / m for a size-5 ball — acceleration = DRAG_K * v^2. */
export const DRAG_K = 0.0135
export const MAGNUS_K = 0.011
export const GROUND_RESTITUTION = 0.55
export const GROUND_FRICTION = 0.72

export const MIN_SHOT_SPEED = 14
export const MAX_SHOT_SPEED = 25
/** Seconds for the power meter to sweep from empty to full. */
export const POWER_SWEEP = 1.05
export const MAX_CURVE = 1

export const PITCH_WIDTH = 90
export const PITCH_LENGTH = 130

export const KIT_KEEPER = 0x1fc47a
export const KIT_STRIKER = 0xe8453c

/** Physics runs on fixed substeps so a 29 m/s ball cannot tunnel through a glove. */
export const PHYSICS_STEP = 1 / 360
