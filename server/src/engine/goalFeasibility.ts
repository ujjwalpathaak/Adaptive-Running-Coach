import type { GarminRunRow } from '../garmin/client.js';
import { lastCalibrationRuns } from './fitness.js';

export interface GoalFeasibilityInput {
  raceDistanceKm: number;
  raceGoalTimeSec: number;
  targetDate: string;
  daysToRace: number;
  /** Last-3 calibration runs (already gated) */
  calibrationRuns: GarminRunRow[];
  currentPaceSecPerKm: number;
  longestRunKm: number;
}

export interface GoalFeasibilityResult {
  ok: boolean;
  message: string;
  /** Fraction of current pace that must improve (0 = already at/faster than goal) */
  paceGapFraction: number;
  weeksAvailable: number;
  maxPaceGainFraction: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, '0')}/km`;
}

function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}`;
  return `${m} min`;
}

/**
 * Check whether the race goal looks achievable from last-3-run fitness
 * given days remaining. Unrealistic goals fail create with a clear error.
 *
 * Rules (bare V1):
 * - Pace: allow ~1% of current pace improvement per available week (+5% slack).
 * - Distance: if race ≫ longest recent run, require enough weeks to build up.
 * - Goal already slower/easier than current → always OK on pace.
 */
export function assertGoalFeasible(input: GoalFeasibilityInput): GoalFeasibilityResult {
  const goalSecPerKm = input.raceGoalTimeSec / input.raceDistanceKm;
  const weeksAvailable = Math.max(0, input.daysToRace / 7);
  // ~1% pace improvement per week is aggressive for recreational; +5% slack
  const maxPaceGainFraction = weeksAvailable * 0.01 + 0.05;

  const current = input.currentPaceSecPerKm;
  const paceGapFraction =
    current > goalSecPerKm ? (current - goalSecPerKm) / current : 0;

  const reasons: string[] = [];

  if (input.daysToRace < 1) {
    reasons.push('Race date is in the past or today — pick a future race date.');
  }

  if (paceGapFraction > maxPaceGainFraction) {
    const neededWeeks = Math.ceil(Math.max(0, paceGapFraction - 0.05) / 0.01);
    reasons.push(
      `Goal pace ${formatPace(goalSecPerKm)} (${formatDuration(input.raceGoalTimeSec)} for ${round1(input.raceDistanceKm)} km) needs ~${Math.round(paceGapFraction * 100)}% faster running than your last-3 median ${formatPace(current)}. With ${round1(weeksAvailable)} weeks left, a realistic ceiling is ~${Math.round(maxPaceGainFraction * 100)}% improvement (~${neededWeeks}+ weeks would be safer). Soften the goal time or pick a later race.`,
    );
  }

  // Distance build: race much longer than proven longest
  const longest = input.longestRunKm;
  if (longest > 0 && input.raceDistanceKm > longest * 2.2) {
    const ratio = input.raceDistanceKm / longest;
    // Rough: ~0.15–0.2× longest per week of long-run growth toward race
    const minWeeksForDistance = Math.ceil((ratio - 1) * 5);
    if (weeksAvailable < minWeeksForDistance) {
      reasons.push(
        `Race distance ${round1(input.raceDistanceKm)} km is ~${round1(ratio)}× your longest recent run (${round1(longest)} km). Building that safely usually needs ~${minWeeksForDistance}+ weeks; you have ~${round1(weeksAvailable)}. Extend the timeline or choose a shorter race.`,
      );
    }
  }

  // Absolute red flag: goal pace more than 40% faster than current regardless of calendar
  // (still catch absurd goals with a long calendar)
  if (paceGapFraction > 0.4 && weeksAvailable < 20) {
    const already = reasons.some((r) => r.includes('Goal pace'));
    if (!already) {
      reasons.push(
        `Goal pace ${formatPace(goalSecPerKm)} is more than 40% faster than your last-3 pace ${formatPace(current)}. That jump is not realistic before this race date.`,
      );
    }
  }

  if (reasons.length > 0) {
    return {
      ok: false,
      message: `Goal looks unrealistic from your last 3 runs. ${reasons.join(' ')}`,
      paceGapFraction,
      weeksAvailable,
      maxPaceGainFraction,
    };
  }

  return {
    ok: true,
    message: `Goal is within a realistic path from last-3 fitness (${formatPace(current)} → ${formatPace(goalSecPerKm)} over ~${round1(weeksAvailable)} weeks).`,
    paceGapFraction,
    weeksAvailable,
    maxPaceGainFraction,
  };
}

/** Convenience: pull longest from calibration runs. */
export function longestFromRuns(runs: GarminRunRow[]): number {
  const cal = lastCalibrationRuns(runs);
  if (cal.length === 0) return 0;
  return round1(Math.max(...cal.map((r) => r.distanceKm)));
}
