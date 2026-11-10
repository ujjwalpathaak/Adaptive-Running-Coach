import { buildPaceBands } from './paces.js';
import { calculateVolumeBaseline, targetWeeklyKm } from './weeklyBuilder.js';
import { resolvePhase } from './phases.js';
import type { FitnessReadiness, PaceBands, ProgressionFocus, TrainingPhase } from './types.js';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export interface ProgressionInput {
  /** Live-recalibrated pace from recent executed runs (sec/km) — "where you are now" */
  currentPaceSecPerKm: number;
  longestRunKm: number;
  typicalSessionKm: number;
  raceDistanceKm: number;
  raceGoalTimeSec: number;
  trainingDays: number;
  daysToRace: number;
  /** Frozen at plan create — used to measure path toward race */
  startingDaysToRace: number;
  startingPaceSecPerKm: number;
  readiness: FitnessReadiness;
  /**
   * One-variable-at-a-time rhythm (SVGN guide): alternate which lever moves,
   * and force an intentional deload every 4th week regardless of signals.
   */
  focus: ProgressionFocus;
  /** Previous week's volume baseline — held steady unless focus === 'volume'/'deload' */
  previousVolumeBaselineKm: number;
  /** Previous week's pace blend — held steady unless focus === 'pace' (or eased on deload) */
  previousPaceBlend: number;
}

export interface ProgressionWeek {
  paceBands: PaceBands;
  /** How far along the calendar path to race (0 = start, 1 = race week) */
  progressFraction: number;
  /** 0 = pure current fitness paces, 1 = fully at race-goal training paces */
  paceBlend: number;
  volumeBaselineKm: number;
  weeklyKm: number;
  minLongKm: number;
  minEasyKm: number;
  phase: TrainingPhase;
  focus: ProgressionFocus;
  note: string;
}

/**
 * Decide this week's single lever (SVGN: "change one main variable at a time",
 * plus intentional lower-volume weeks every ~4th week).
 *   weeksSinceStart % 4 → 0: volume, 1: pace, 2: volume, 3: deload
 */
export function resolveProgressionFocus(weeksSinceStart: number): ProgressionFocus {
  const cycle = ((weeksSinceStart % 4) + 4) % 4;
  if (cycle === 3) return 'deload';
  if (cycle === 1) return 'pace';
  return 'volume';
}

/**
 * Build this week's targets on a path from current fitness → race goal.
 * Early weeks stay near current; pace/volume gradually lean toward the goal
 * as race day approaches (never a sudden jump to goal pace). Only one of
 * {volume, pace} is allowed to step forward per week; deload weeks pull both back.
 */
export function buildWeekTowardGoal(input: ProgressionInput): ProgressionWeek {
  const goalSecPerKm = input.raceGoalTimeSec / input.raceDistanceKm;
  const phase = resolvePhase(input.daysToRace);

  const span = Math.max(14, input.startingDaysToRace - 14);
  const elapsed = Math.max(0, input.startingDaysToRace - input.daysToRace);
  const progressFraction = clamp(elapsed / span, 0, 1);

  // Aspirational pace blend if this were a "pace" week (capped by phase)
  let aspirationalBlend = progressFraction * 0.65;
  if (phase === 'base') aspirationalBlend = Math.min(aspirationalBlend, 0.12);
  if (phase === 'build') aspirationalBlend = Math.min(aspirationalBlend, 0.35);
  if (phase === 'peak') aspirationalBlend = Math.min(Math.max(aspirationalBlend, 0.35), 0.55);
  if (phase === 'taper') aspirationalBlend = Math.min(Math.max(aspirationalBlend, 0.4), 0.5);

  const abilityWeekly = round1(
    input.longestRunKm + input.typicalSessionKm * Math.max(1, input.trainingDays - 1),
  );
  const racePeakWeekly = round1(
    calculateVolumeBaseline(input.raceDistanceKm, input.trainingDays) * 1.15,
  );

  // Aspirational volume if this were a "volume" week
  let aspirationalVolume = round1(
    abilityWeekly * (1 - progressFraction * 0.5) + racePeakWeekly * (progressFraction * 0.5),
  );
  aspirationalVolume = round1(
    Math.max(abilityWeekly, Math.min(racePeakWeekly, aspirationalVolume)),
  );

  let paceBlend: number;
  let volumeBaselineKm: number;
  let focusNote: string;

  if (input.focus === 'deload') {
    // Intentional lower-volume week: pull both back, never push either forward.
    paceBlend = Math.min(input.previousPaceBlend, aspirationalBlend);
    volumeBaselineKm = round1(
      Math.max(abilityWeekly * 0.8, input.previousVolumeBaselineKm * 0.8),
    );
    focusNote = 'Deload week — holding pace, cutting volume to freshen up';
  } else if (input.focus === 'pace') {
    // Move pace only; volume holds at (or slightly below) last week's level.
    paceBlend = Math.max(input.previousPaceBlend, aspirationalBlend);
    volumeBaselineKm = round1(Math.max(abilityWeekly, input.previousVolumeBaselineKm));
    focusNote = 'Pace week — holding volume steady, nudging training pace toward goal';
  } else {
    // 'volume': move volume only; pace holds at last week's level.
    paceBlend = input.previousPaceBlend;
    volumeBaselineKm = aspirationalVolume;
    focusNote = 'Volume week — holding pace steady, building weekly mileage';
  }

  // Safety override: readiness 'ease' always wins, regardless of cycle focus.
  if (input.readiness === 'ease') {
    volumeBaselineKm = round1(
      Math.min(volumeBaselineKm, Math.max(abilityWeekly * 0.95, input.previousVolumeBaselineKm * 0.95)),
    );
    paceBlend = Math.min(paceBlend, input.previousPaceBlend);
    focusNote += ' · eased further on fatigue signal';
  } else if (input.readiness === 'progress' && input.focus === 'volume') {
    volumeBaselineKm = round1(Math.min(racePeakWeekly, volumeBaselineKm * 1.02));
  }

  const anchorPace = Math.round(
    input.currentPaceSecPerKm * (1 - paceBlend) + goalSecPerKm * paceBlend,
  );
  const paceBands = buildPaceBands(input.raceDistanceKm, input.raceGoalTimeSec, anchorPace);

  let weeklyKm = targetWeeklyKm(volumeBaselineKm, phase);
  // Never prescribe a long below ~90% of what's already been shown
  const minLongKm = round1(Math.max(6, input.longestRunKm * (0.9 + progressFraction * 0.08)));
  const minEasyKm = round1(Math.max(4, input.typicalSessionKm * 0.9));

  const floorWeekly = round1(minLongKm + minEasyKm * Math.max(1, input.trainingDays - 1));
  weeklyKm = round1(Math.max(weeklyKm, floorWeekly));

  const goalPaceMin = Math.floor(goalSecPerKm / 60);
  const goalPaceSec = Math.round(goalSecPerKm % 60)
    .toString()
    .padStart(2, '0');
  const curMin = Math.floor(input.currentPaceSecPerKm / 60);
  const curSec = Math.round(input.currentPaceSecPerKm % 60)
    .toString()
    .padStart(2, '0');

  const note = `${focusNote}. Current ~${curMin}:${curSec}/km, longest ${input.longestRunKm} km → race goal ${goalPaceMin}:${goalPaceSec}/km over ${input.raceDistanceKm} km (${input.daysToRace}d out, blend ${Math.round(paceBlend * 100)}%).`;

  return {
    paceBands,
    progressFraction,
    paceBlend,
    volumeBaselineKm,
    weeklyKm,
    minLongKm,
    minEasyKm,
    phase,
    focus: input.focus,
    note,
  };
}
