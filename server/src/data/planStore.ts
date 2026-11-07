import { applyProgressiveAdaptation } from '../engine/adapter.js';
import {
  assertFitnessReady,
  assessFitness,
  estimateCurrentPaceSecPerKm,
  FITNESS_WINDOW_DAYS,
  newestRun,
  runsInWindow,
} from '../engine/fitness.js';
import { dayStamp, matchRunToSession, sessionForDate } from '../engine/matcher.js';
import { buildPaceBands } from '../engine/paces.js';
import { daysToRace } from '../engine/phases.js';
import { buildWeekTowardGoal } from '../engine/progression.js';
import { scoreSession, detectFatigue } from '../engine/scorer.js';
import {
  addDays,
  buildWeeklyPlan,
  mondayOf,
} from '../engine/weeklyBuilder.js';
import type {
  ExtraRunEntry,
  FitnessReadiness,
  PerformanceSignal,
  RunActual,
  SessionScore,
} from '../engine/types.js';
import { getCachedGarminRuns } from '../garmin/cache.js';
import type { GarminRunRow } from '../garmin/client.js';
import { isGarminConfigured } from '../garmin/client.js';
import type { CreatePlanInput, EvaluateRunInput, TrainingPlan } from '../types.js';

let activePlan: TrainingPlan | null = null;
const recentSignals: PerformanceSignal[] = [];

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function loadRecentGarminRuns(refresh = false): Promise<GarminRunRow[]> {
  if (!isGarminConfigured()) {
    throw Object.assign(
      new Error(
        'GARMIN_PERSONAL_API_KEY is not set. Connect Garmin to assess fitness and sync runs.',
      ),
      { status: 503 },
    );
  }
  const { runs } = await getCachedGarminRuns({
    // Wide enough window to find last 3 qualifying runs for calibration
    startDate: isoDateDaysAgo(Math.max(90, FITNESS_WINDOW_DAYS + 2)),
    limit: 80,
    refresh,
  });
  return runs;
}

function runToActual(run: GarminRunRow): RunActual {
  return {
    activityId: String(run.id),
    startTime: run.startTime,
    distanceKm: run.distanceKm,
    durationSec: run.durationSec,
    avgPaceSecPerKm: run.avgPaceSecPerKm,
    avgHr: run.avgHr,
    lateFadeRatio: null,
  };
}

function alreadySeenActivity(plan: TrainingPlan, activityId: string): boolean {
  if (plan.sessions.some((s) => s.linkedActivityId === activityId)) return true;
  if (plan.sessions.some((s) => (s.extras ?? []).some((e) => e.activityId === activityId))) {
    return true;
  }
  return false;
}

function recomputeCompletedKm(plan: TrainingPlan): number {
  const planned = plan.sessions
    .filter((s) => s.completed && s.distanceKm != null)
    .reduce((sum, s) => sum + (s.distanceKm ?? 0), 0);
  const extras = plan.sessions.reduce(
    (sum, s) => sum + (s.extras ?? []).reduce((eSum, e) => eSum + e.distanceKm, 0),
    0,
  );
  return round1(planned + extras);
}

function todayStamp(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function weekDateSet(weekOf: string): Set<string> {
  return new Set(Array.from({ length: 7 }, (_, i) => addDays(weekOf, i)));
}

function attachExtra(plan: TrainingPlan, run: GarminRunRow): boolean {
  const stamp = dayStamp(run.startTime);
  // Only attach extras that fall on a day in this plan week
  if (!weekDateSet(plan.weekOf).has(stamp)) return false;

  const day = sessionForDate(plan.sessions, run.startTime);
  if (!day) return false;
  if ((day.extras ?? []).some((e) => e.activityId === String(run.id))) return true;

  const entry: ExtraRunEntry = {
    activityId: String(run.id),
    name: run.name || 'Extra run',
    distanceKm: run.distanceKm,
    durationSec: run.durationSec,
    avgPaceSecPerKm: run.avgPaceSecPerKm,
    avgHr: run.avgHr,
    startTime: run.startTime,
  };
  day.extras = [...(day.extras ?? []), entry];
  return true;
}

/**
 * Map Garmin runs onto this week's days only. Outside the week → ignore (do not add).
 * Matching planned session → score/complete; else → Extra on that day.
 */
function mapRunsOntoThisWeek(plan: TrainingPlan, runs: GarminRunRow[]): TrainingPlan {
  const dates = weekDateSet(plan.weekOf);
  const inWeek = runs
    .filter((r) => dates.has(dayStamp(r.startTime)))
    .filter((r) => !alreadySeenActivity(plan, String(r.id)))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  let current = plan;
  for (const run of inWeek) {
    activePlan = current;
    const actual = runToActual(run);
    const matched = matchRunToSession(current.sessions, actual);
    if (matched) {
      evaluateAndAdapt({
        activityId: actual.activityId,
        startTime: actual.startTime,
        distanceKm: actual.distanceKm,
        durationSec: actual.durationSec,
        avgPaceSecPerKm: actual.avgPaceSecPerKm,
        avgHr: actual.avgHr,
      });
      current = activePlan!;
    } else {
      attachExtra(current, run);
      current.currentWeeklyMileageKm = recomputeCompletedKm(current);
    }
  }
  return current;
}

/** Past incomplete workouts → skipped; completed stay completed; future stay scheduled. */
function applyDayStatuses(plan: TrainingPlan): void {
  const today = todayStamp();
  for (const s of plan.sessions) {
    if (s.completed || s.linkedActivityId) {
      s.status = 'completed';
      s.completed = true;
      continue;
    }
    if (s.type === 'rest') {
      s.status = 'scheduled';
      continue;
    }
    if (s.date < today) {
      s.status = 'skipped';
      s.lastSignal = s.lastSignal ?? 'missed';
      s.lastScoreSummary = s.lastScoreSummary ?? 'Skipped — no matching run that day';
    } else {
      s.status = 'scheduled';
    }
  }
}

function readinessFromSignals(signals: PerformanceSignal[]): FitnessReadiness {
  const recent = signals.slice(-6);
  if (recent.length === 0) return 'hold';
  const hard = recent.filter((s) => s === 'too_hard' || s === 'fatigue' || s === 'partial').length;
  const good = recent.filter((s) => s === 'on_track' || s === 'too_easy').length;
  if (hard >= 2) return 'ease';
  if (good >= 2 && hard === 0) return 'progress';
  return 'hold';
}

function rollWeekForward(plan: TrainingPlan): TrainingPlan {
  const thisMonday = mondayOf();
  if (plan.weekOf >= thisMonday) return plan;

  const weekSignals = plan.sessions
    .map((s) => s.lastSignal)
    .filter((s): s is PerformanceSignal => s != null);
  const readiness = readinessFromSignals([...recentSignals, ...weekSignals]);

  const daysRemaining = daysToRace(plan.targetDate);
  const startingPace =
    plan.startingPaceSecPerKm ??
    plan.fitness.avgPaceSecPerKm ??
    plan.paceBands.goalSecPerKm * 1.2;
  const startingDays = plan.startingDaysToRace || daysRemaining + 7;

  const progression = buildWeekTowardGoal({
    currentPaceSecPerKm: plan.fitness.avgPaceSecPerKm ?? startingPace,
    longestRunKm: plan.fitness.longestRunKm,
    typicalSessionKm: plan.fitness.typicalSessionKm ?? 5,
    raceDistanceKm: plan.raceDistanceKm,
    raceGoalTimeSec: plan.raceGoalTimeSec,
    trainingDays: plan.trainingDaysPerWeek,
    daysToRace: daysRemaining,
    startingDaysToRace: startingDays,
    startingPaceSecPerKm: startingPace,
    readiness,
  });

  const week = buildWeeklyPlan({
    weekOf: thisMonday,
    weeklyKm: progression.weeklyKm,
    trainingDays: plan.trainingDaysPerWeek,
    phase: progression.phase,
    paces: progression.paceBands,
    minLongKm: progression.minLongKm,
    minEasyKm: progression.minEasyKm,
  });

  const note =
    readiness === 'progress'
      ? `Last week solid — stepping toward race goal. ${progression.note}`
      : readiness === 'ease'
        ? `Last week hard — easing while staying on the path. ${progression.note}`
        : progression.note;

  const audit = {
    id: `audit-roll-${Date.now()}`,
    at: new Date().toISOString(),
    signal: (readiness === 'ease' ? 'too_hard' : readiness === 'progress' ? 'on_track' : 'partial') as PerformanceSignal,
    rule: `week_roll_${readiness}`,
    summary: note,
    sessionId: null,
    activityId: null,
    mutations: [
      `Rolled week ${plan.weekOf} → ${thisMonday}`,
      `Baseline ${plan.volumeBaselineKm} → ${progression.volumeBaselineKm} km`,
      `Weekly target ${week.weeklyKm} km`,
      `Pace blend ${Math.round(progression.paceBlend * 100)}% toward goal`,
    ],
  };

  return {
    ...plan,
    weekOf: thisMonday,
    focus: `${week.focus} · ${note}`,
    sessions: week.sessions,
    weeklyMileageTargetKm: week.weeklyKm,
    volumeBaselineKm: progression.volumeBaselineKm,
    currentWeeklyMileageKm: 0,
    phase: progression.phase,
    daysToRace: daysRemaining,
    paceBands: progression.paceBands,
    progressiveStreak: readiness === 'progress' ? plan.progressiveStreak + 1 : 0,
    fatigueStreak: readiness === 'ease' ? plan.fatigueStreak + 1 : 0,
    fitness: {
      ...plan.fitness,
      assessedAt: new Date().toISOString(),
      recentWeeklyKm: progression.volumeBaselineKm,
      typicalSessionKm: plan.fitness.typicalSessionKm ?? progression.minEasyKm,
      readiness,
      note,
    },
    audits: [audit, ...plan.audits].slice(0, 50),
  };
}

export function getActivePlan(): TrainingPlan | null {
  return activePlan;
}

export function getRecentSignals(): PerformanceSignal[] {
  return [...recentSignals];
}

export async function createPlan(input: CreatePlanInput): Promise<TrainingPlan> {
  if (activePlan) {
    throw Object.assign(new Error('An active plan already exists. End it before creating another.'), {
      status: 409,
    });
  }

  const title = input.title.trim();
  if (!title) {
    throw Object.assign(new Error('Plan title is required'), { status: 400 });
  }
  if (!input.targetDate) {
    throw Object.assign(new Error('Target race date is required'), { status: 400 });
  }
  if (!(input.raceDistanceKm > 0)) {
    throw Object.assign(new Error('Race distance must be positive'), { status: 400 });
  }
  if (!(input.raceGoalTimeSec > 0)) {
    throw Object.assign(new Error('Race goal time must be positive'), { status: 400 });
  }

  const trainingDays = Number(input.trainingDaysPerWeek);
  if (!Number.isInteger(trainingDays) || trainingDays < 2 || trainingDays > 7) {
    throw Object.assign(new Error('Training days must be an integer between 2 and 7'), {
      status: 400,
    });
  }

  const runs = await loadRecentGarminRuns(true);
  const gate = assertFitnessReady(runs);
  if (!gate.ok) {
    throw Object.assign(new Error(gate.message), { status: 400 });
  }

  const currentPaceSecPerKm = estimateCurrentPaceSecPerKm(runs);
  if (currentPaceSecPerKm == null) {
    throw Object.assign(new Error('Could not read pace from your last 3 runs'), { status: 400 });
  }

  // Seed bands from last-3 pace only (progression may nudge slightly for this week)
  const seedBands = buildPaceBands(
    input.raceDistanceKm,
    input.raceGoalTimeSec,
    currentPaceSecPerKm,
  );
  const fitnessAssess = assessFitness(runs, seedBands, input.raceDistanceKm, trainingDays);
  const daysRemaining = daysToRace(input.targetDate);

  const progression = buildWeekTowardGoal({
    currentPaceSecPerKm,
    longestRunKm: fitnessAssess.longestRunKm,
    typicalSessionKm: fitnessAssess.typicalSessionKm,
    raceDistanceKm: input.raceDistanceKm,
    raceGoalTimeSec: input.raceGoalTimeSec,
    trainingDays,
    daysToRace: daysRemaining,
    startingDaysToRace: daysRemaining,
    startingPaceSecPerKm: currentPaceSecPerKm,
    readiness: fitnessAssess.readiness,
  });

  const weekOf = mondayOf();
  const week = buildWeeklyPlan({
    weekOf,
    weeklyKm: progression.weeklyKm,
    trainingDays,
    phase: progression.phase,
    paces: progression.paceBands,
    minLongKm: progression.minLongKm,
    minEasyKm: progression.minEasyKm,
  });

  const newest = newestRun(runsInWindow(runs));

  activePlan = {
    id: `plan-${Date.now()}`,
    status: 'active',
    createdAt: new Date().toISOString(),
    title,
    raceDistanceKm: input.raceDistanceKm,
    raceGoalTimeSec: Math.round(input.raceGoalTimeSec),
    targetDate: input.targetDate,
    trainingDaysPerWeek: trainingDays,
    weeklyMileageTargetKm: week.weeklyKm,
    currentWeeklyMileageKm: 0,
    focus: `${week.focus} · ${progression.note}`,
    weekOf,
    sessions: week.sessions,
    phase: progression.phase,
    daysToRace: daysRemaining,
    paceBands: progression.paceBands,
    volumeBaselineKm: progression.volumeBaselineKm,
    progressiveStreak: fitnessAssess.readiness === 'progress' ? 1 : 0,
    fatigueStreak: fitnessAssess.readiness === 'ease' ? 1 : 0,
    audits: [],
    adaptationStyle: 'progressive',
    goalModel: 'race_pace',
    syncCursor: {
      activityId: null,
      startTime: null,
    },
    fitness: {
      assessedAt: fitnessAssess.assessedAt,
      qualifyingRunCount: fitnessAssess.qualifyingRunCount,
      recentWeeklyKm: fitnessAssess.recentWeeklyKm,
      typicalSessionKm: fitnessAssess.typicalSessionKm,
      longestRunKm: fitnessAssess.longestRunKm,
      avgPaceSecPerKm: fitnessAssess.avgPaceSecPerKm,
      readiness: fitnessAssess.readiness,
      note: `${fitnessAssess.note} ${progression.note}`,
    },
    startingPaceSecPerKm: currentPaceSecPerKm,
    startingDaysToRace: daysRemaining,
  };

  recentSignals.length = 0;
  // Map only runs that fall inside this calendar week onto their days
  activePlan = mapRunsOntoThisWeek(activePlan, runs);
  applyDayStatuses(activePlan);
  activePlan.currentWeeklyMileageKm = recomputeCompletedKm(activePlan);
  if (newest) {
    activePlan.syncCursor = {
      activityId: newest.id,
      startTime: newest.startTime,
    };
  }
  return activePlan;
}

export function endPlan(): TrainingPlan {
  if (!activePlan) {
    throw Object.assign(new Error('No active plan to end'), { status: 404 });
  }
  const ended = activePlan;
  activePlan = null;
  recentSignals.length = 0;
  return ended;
}

/**
 * Dashboard open: map new/unseen Garmin runs onto this week only, then Monday roll if needed.
 * Runs outside the current week are not added to the board.
 */
export async function syncPlanWithGarmin(): Promise<TrainingPlan | null> {
  if (!activePlan) return null;

  try {
    const runs = await loadRecentGarminRuns(false);
    activePlan = rollWeekForward(activePlan);
    activePlan = mapRunsOntoThisWeek(activePlan, runs);
    applyDayStatuses(activePlan);
    activePlan.currentWeeklyMileageKm = recomputeCompletedKm(activePlan);

    const newest = newestRun(runs);
    if (newest) {
      activePlan.syncCursor = {
        activityId: newest.id,
        startTime: newest.startTime,
      };
    }
  } catch (err) {
    if (
      typeof err === 'object' &&
      err &&
      'status' in err &&
      (err as { status: number }).status === 503
    ) {
      activePlan = rollWeekForward(activePlan);
      applyDayStatuses(activePlan);
    } else {
      throw err;
    }
  }

  return activePlan;
}

export function evaluateAndAdapt(input: EvaluateRunInput): {
  plan: TrainingPlan;
  score: SessionScore;
  matchedSessionId: string;
  fatigueDetected: boolean;
} {
  if (!activePlan) {
    throw Object.assign(new Error('No active plan'), { status: 404 });
  }

  const run: RunActual = {
    activityId: String(input.activityId),
    startTime: String(input.startTime),
    distanceKm: Number(input.distanceKm),
    durationSec: Number(input.durationSec),
    avgPaceSecPerKm:
      input.avgPaceSecPerKm == null || input.avgPaceSecPerKm === undefined
        ? input.distanceKm > 0
          ? input.durationSec / input.distanceKm
          : null
        : Number(input.avgPaceSecPerKm),
    avgHr: input.avgHr == null ? null : Number(input.avgHr),
    lateFadeRatio: input.lateFadeRatio == null ? null : Number(input.lateFadeRatio),
  };

  if (!(run.distanceKm > 0) || !(run.durationSec > 0)) {
    throw Object.assign(new Error('Run distance and duration must be positive'), { status: 400 });
  }

  const matched = matchRunToSession(activePlan.sessions, run);
  if (!matched) {
    throw Object.assign(new Error('No runnable session available to match this run'), {
      status: 400,
    });
  }

  const score = scoreSession(matched, run);
  const fatigueDetected = detectFatigue([...recentSignals, score.signal]);

  const { plan: adapted, entry } = applyProgressiveAdaptation(
    {
      targetDate: activePlan.targetDate,
      trainingDaysPerWeek: activePlan.trainingDaysPerWeek,
      weeklyMileageTargetKm: activePlan.weeklyMileageTargetKm,
      volumeBaselineKm: activePlan.volumeBaselineKm,
      phase: activePlan.phase,
      daysToRace: activePlan.daysToRace,
      paceBands: activePlan.paceBands,
      progressiveStreak: activePlan.progressiveStreak,
      fatigueStreak: activePlan.fatigueStreak,
      weekOf: activePlan.weekOf,
      focus: activePlan.focus,
      sessions: activePlan.sessions,
      audits: activePlan.audits,
    },
    score,
    recentSignals,
  );

  activePlan = {
    ...activePlan,
    ...adapted,
    currentWeeklyMileageKm: recomputeCompletedKm({ ...activePlan, ...adapted }),
    audits: [entry, ...activePlan.audits.filter((a) => a.id !== entry.id)].slice(0, 50),
    syncCursor: activePlan.syncCursor,
    fitness: activePlan.fitness,
  };

  recentSignals.push(score.signal);
  if (recentSignals.length > 12) recentSignals.shift();

  return {
    plan: activePlan,
    score,
    matchedSessionId: matched.id,
    fatigueDetected,
  };
}
