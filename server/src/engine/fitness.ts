import type { GarminRunRow } from '../garmin/client.js';
import type { PaceBands } from './types.js';

export const FITNESS_WINDOW_DAYS = 14;
export const MIN_QUALIFYING_RUNS = 3;
export const MIN_RUN_DURATION_SEC = 30 * 60;
/** How many most-recent qualifying runs calibrate “current fitness” at plan start */
export const CALIBRATION_RUN_COUNT = 3;
/** Minimum days between "today" and the race date, so there's a real week to build */
export const MIN_LEAD_DAYS_TO_RACE = 7;
export const MIN_TRAINING_DAYS_PER_WEEK = 2;
export const MAX_TRAINING_DAYS_PER_WEEK = 7;
export const MIN_RACE_DISTANCE_KM = 1;

export type FitnessReadiness = 'progress' | 'hold' | 'ease';

export interface FitnessSnapshot {
  assessedAt: string;
  qualifyingRunCount: number;
  recentWeeklyKm: number;
  longestRunKm: number;
  /** Typical non-long session distance from calibration runs */
  typicalSessionKm: number;
  avgPaceSecPerKm: number | null;
  readiness: FitnessReadiness;
  note: string;
  volumeBaselineKm: number;
}

export interface FitnessGateResult {
  ok: boolean;
  qualifyingRuns: GarminRunRow[];
  message: string;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function runStartMs(run: GarminRunRow): number {
  const t = new Date(run.startTime).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Runs whose start time falls within the last `windowDays` days. */
export function runsInWindow(runs: GarminRunRow[], windowDays = FITNESS_WINDOW_DAYS): GarminRunRow[] {
  const cutoff = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  return runs
    .filter((r) => runStartMs(r) >= cutoff)
    .sort((a, b) => runStartMs(a) - runStartMs(b));
}

export function qualifyingRuns(runs: GarminRunRow[]): GarminRunRow[] {
  return [...runs]
    .filter((r) => r.durationSec >= MIN_RUN_DURATION_SEC && r.distanceKm > 0)
    .sort((a, b) => runStartMs(a) - runStartMs(b));
}

/**
 * Last N qualifying runs (newest first), used to calibrate current fitness.
 */
export function lastCalibrationRuns(
  runs: GarminRunRow[],
  count = CALIBRATION_RUN_COUNT,
): GarminRunRow[] {
  return [...qualifyingRuns(runs)]
    .sort((a, b) => runStartMs(b) - runStartMs(a))
    .slice(0, count);
}

/**
 * Gate: need ≥3 runs of ≥30 minutes (uses the most recent ones for calibration).
 */
export function assertFitnessReady(runs: GarminRunRow[]): FitnessGateResult {
  const last3 = lastCalibrationRuns(runs, CALIBRATION_RUN_COUNT);
  if (last3.length >= MIN_QUALIFYING_RUNS) {
    return {
      ok: true,
      qualifyingRuns: last3,
      message: `Fitness calibrated from your last ${last3.length} runs of 30+ minutes.`,
    };
  }

  const have = last3.length;
  const need = MIN_QUALIFYING_RUNS - have;
  return {
    ok: false,
    qualifyingRuns: last3,
    message: `Need at least ${MIN_QUALIFYING_RUNS} runs of 30+ minutes to calibrate fitness from your last runs. You have ${have} — add ${need} more before starting a plan.`,
  };
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Median pace from the last 3 calibration runs. */
export function estimateCurrentPaceSecPerKm(runs: GarminRunRow[]): number | null {
  const paces = lastCalibrationRuns(runs)
    .map((r) => r.avgPaceSecPerKm)
    .filter((p): p is number => p != null && p > 0);
  const m = median(paces);
  return m == null ? null : Math.round(m);
}

/**
 * Calibrate current fitness from the last 3 qualifying runs only.
 * Volume/pace floors come from those runs; path to race goal is handled by progression.
 */
export function assessFitness(
  runs: GarminRunRow[],
  paceBands: PaceBands,
  raceDistanceKm: number,
  trainingDays: number,
): FitnessSnapshot {
  const gate = assertFitnessReady(runs);
  if (!gate.ok) {
    throw Object.assign(new Error(gate.message), { status: 400 });
  }

  const calibration = gate.qualifyingRuns;
  const distances = calibration.map((r) => r.distanceKm).sort((a, b) => a - b);
  const longestRunKm = round1(distances[distances.length - 1] ?? 0);
  const withoutLongest = distances.length > 1 ? distances.slice(0, -1) : distances;
  const typicalSessionKm = round1(
    Math.max(4, median(withoutLongest) ?? median(distances) ?? 5),
  );

  const abilityWeeklyKm = round1(
    longestRunKm + typicalSessionKm * Math.max(1, trainingDays - 1),
  );
  const sumLast3Km = round1(calibration.reduce((s, r) => s + r.distanceKm, 0));
  // Approximate a week from last-3 total (spread across training days)
  const recentWeeklyKm = round1(Math.max(abilityWeeklyKm * 0.92, sumLast3Km));

  const paces = calibration
    .map((r) => r.avgPaceSecPerKm)
    .filter((p): p is number => p != null && p > 0);
  const avgPaceSecPerKm = median(paces);

  const easyMid = (paceBands.easy.minSecPerKm + paceBands.easy.maxSecPerKm) / 2;
  const highHrCount = calibration.filter((r) => r.avgHr != null && r.avgHr >= 165).length;

  let readiness: FitnessReadiness = 'hold';
  let note = `Calibrated on last ${calibration.length} runs (longest ${longestRunKm} km, typical ~${typicalSessionKm} km).`;

  if (highHrCount >= 2) {
    readiness = 'ease';
    note = `Last ${calibration.length} runs show elevated HR — start conservatively near your ${longestRunKm} km capability, then progress toward the race goal.`;
  } else if (
    avgPaceSecPerKm != null &&
    avgPaceSecPerKm <= easyMid + 10 &&
    highHrCount <= 1
  ) {
    readiness = 'progress';
    note = `Last ${calibration.length} runs look sustainable at ~${longestRunKm}/${typicalSessionKm} km — begin the path toward race goal.`;
  } else {
    readiness = 'hold';
    note = `Last ${calibration.length} runs set your starting point (~${longestRunKm} km long, ~${typicalSessionKm} km typical). Plan builds from here toward the race goal.`;
  }

  // Starting volume = what last-3 prove you can do (progression lifts this later)
  let volumeBaselineKm = abilityWeeklyKm;
  if (readiness === 'progress') volumeBaselineKm = round1(volumeBaselineKm * 1.03);
  if (readiness === 'ease') volumeBaselineKm = round1(volumeBaselineKm * 0.95);

  return {
    assessedAt: new Date().toISOString(),
    qualifyingRunCount: calibration.length,
    recentWeeklyKm,
    longestRunKm,
    typicalSessionKm,
    avgPaceSecPerKm: avgPaceSecPerKm == null ? null : Math.round(avgPaceSecPerKm),
    readiness,
    note,
    volumeBaselineKm,
  };
}

export function newestRun(runs: GarminRunRow[]): GarminRunRow | null {
  if (runs.length === 0) return null;
  return [...runs].sort((a, b) => runStartMs(b) - runStartMs(a))[0] ?? null;
}
