# Workout-based week — execution notes

## Task 1 — fitness-module (done)
- Added `server/src/engine/fitness.ts`: 14d window, 3×30min gate, assessFitness → readiness + volumeBaselineKm.
- Next: plan model + sync/roll in planStore.

## Task 2 — plan-model-sync (done)
- Extended engine types: ExtraRunEntry, PlanFitness, SyncCursor; sessions.extras.
- Matcher: same-day incomplete + distance band only; else null → Extra.
- planStore: async createPlan (Garmin gate), syncPlanWithGarmin, Monday rollWeekForward.

## Task 3 — api-wire (done)
- POST /plan async + fitness 400; GET /plan/current syncs + Monday roll.

## Task 4 — dashboard-extras (done)
- Fitness line, Extra rows, gate copy on setup; create shows server gate errors.
- Smoke: create succeeded with readiness ease, ~16.2 km week from Garmin fitness.
