# Plan creation logic (Adaptive Running Coach)

How `POST /api/plan` builds a locked training week from Garmin fitness + race goal.

Related: [running-plan-guide-learnings.md](./running-plan-guide-learnings.md) (external coaching principles).

---

## Pipeline overview

```text
Form inputs
    → Fetch Garmin runs
    → ① Fitness gate (last 3 × 30+ min)
    → ② Calibrate current fitness (pace / longest / typical)
    → ③ Goal feasibility check  ← fails create if unrealistic
    → ④ Phase + progression (current → goal for THIS week)
    → ⑤ Bare weekly template (easy / quality / long / rest)
    → ⑥ Map this week’s runs (completed / extra / skipped / today)
    → Locked active plan (in-memory)
```

Code entry: `createPlan` in `server/src/data/planStore.ts`.

---

## Inputs

| Field | Role |
|-------|------|
| `title` | Display name |
| `raceDistanceKm` | Event distance |
| `raceGoalTimeSec` | Target finish → goal pace |
| `targetDate` | Race day → days to race + phase |
| `trainingDaysPerWeek` | 2–7 → week skeleton |

Constraints: one active plan at a time (409 if already active).

---

## Step ① — Fitness gate

**Module:** `server/src/engine/fitness.ts` → `assertFitnessReady`

- Load recent Garmin runs (wide window so “last 3” can be found).
- Qualifying run: duration ≥ 30 min and distance &gt; 0.
- Need **at least 3** qualifying runs.

**Fail:** `400` — e.g. *Need at least 3 runs of 30+ minutes…*

---

## Step ② — Calibrate from last 3 runs

**Modules:** `lastCalibrationRuns`, `estimateCurrentPaceSecPerKm`, `assessFitness`

From the **3 most recent** qualifying runs:

| Metric | How |
|--------|-----|
| `currentPaceSecPerKm` | Median avg pace |
| `longestRunKm` | Max distance |
| `typicalSessionKm` | Median of non-longest (floor ~4 km) |
| `volumeBaselineKm` | ≈ longest + typical × (days − 1), adjusted by readiness |
| `readiness` | `progress` \| `hold` \| `ease` (HR / sustainability) |

This is the **field pace anchor** (where you are now). Race goal is not used as today’s easy pace.

**Fail:** `400` if pace cannot be read from last 3.

---

## Step ③ — Goal feasibility (vs last 3)

**Module:** `server/src/engine/goalFeasibility.ts` → `assertGoalFeasible`

Compares race goal to last-3 fitness and calendar. If the goal looks unachievable, **create stops** with `400` and a clear message (no plan is stored).

### Pace rule

- Goal pace = `raceGoalTimeSec / raceDistanceKm`.
- Gap fraction = `(currentPace − goalPace) / currentPace` (0 if already at/faster than goal).
- Allowed gain ≈ **1% of current pace per week available** + **5% slack**.
- If gap &gt; allowed → error (suggest softer goal time or later race).
- Extra guard: gap &gt; **40%** with &lt; **20 weeks** → error.

### Distance rule

- If race distance &gt; **2.2 ×** longest recent run, require enough weeks to build long-run distance (`~ceil((ratio − 1) × 5)` weeks).
- If not enough weeks → error (later date or shorter race).

### Date rule

- Race date in the past / today → error.

### Pass

Message recorded only in logic; create continues.

---

## Step ④ — Progression for this week

**Module:** `server/src/engine/progression.ts` → `buildWeekTowardGoal`

- Phase from days to race: base / build / peak / taper (`phases.ts`).
- **Pace blend** from current toward goal (0 at plan start; rises over Mondays; capped so training never jumps to full race pace).
- **Volume** between ability weekly km and race-oriented peak, then phase factor.
- **Floors:** long ≈ ~90% of longest; easy ≈ typical session.

Stores on plan: `startingPaceSecPerKm`, `startingDaysToRace` for later Monday rolls.

---

## Step ⑤ — Bare weekly template

**Module:** `server/src/engine/weeklyBuilder.ts` → `buildWeeklyPlan`

- Place N training days across Mon–Sun.
- Split weekly km into easy / quality / long (+ rest).
- Attach prescriptions (structure, notes, pace band) and expectations for scoring.

---

## Step ⑥ — Map this calendar week

**Modules:** `matcher.ts`, `mapRunsOntoThisWeek`, `applyDayStatuses`

Only runs whose date falls in the current `weekOf`…+6 days:

| Outcome | Rule |
|---------|------|
| **Completed** | Same-day planned session, distance within band → score vs prescription |
| **Extra** | In week but not a planned match → tagged Extra on that day |
| **Skipped** | Past planned workout (non-rest) with no matching run |
| **Today** | UI pin on today’s row |

Sync cursor advances to newest Garmin run. Out-of-week runs are **not** attached.

---

## After create (not part of create, but same engine)

| Event | Behavior |
|-------|----------|
| Dashboard `GET /api/plan/current` | Sync new runs past cursor; re-apply statuses; Monday week roll if `weekOf` stale |
| Monday roll | Rebuild week further along path to goal; readiness from last week’s signals |
| End plan | Clears in-memory plan so a new create can run |

---

## Error summary (create)

| Status | When |
|--------|------|
| 409 | Active plan already exists |
| 400 | Validation (title, dates, days, distance, time) |
| 400 | Fitness gate failed (&lt; 3 × 30 min runs) |
| 400 | No readable pace on last 3 |
| 400 | **Goal unrealistic vs last 3** (pace and/or distance vs time) |
| 503 | Garmin not configured when loading runs |

UI should show `error` body text from these responses on Start plan.

---

## Design principles (locked)

1. **Last 3 runs** = truth about now.  
2. **Race form** = destination.  
3. **Feasibility gate** = refuse fantasy goals early.  
4. **This week** stays near current fitness; blend toward goal over time.  
5. **One locked plan**; adapt via sync + Monday roll, not free edit.
