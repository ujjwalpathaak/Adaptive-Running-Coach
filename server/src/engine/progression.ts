import { buildPaceBands } from './paces.js';
import { calculateVolumeBaseline, targetWeeklyKm } from './weeklyBuilder.js';
import { resolvePhase } from './phases.js';
import type { FitnessReadiness, PaceBands, TrainingPhase } from './types.js';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export interface ProgressionInput {
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
  note: string;
}

/**
 * Build this week's targets on a path from last-3-run fitness → race goal.
 * Early weeks stay near current; pace/volume gradually lean toward the goal
 * as race day approaches (never a sudden jump to goal pace).
 */
export function buildWeekTowardGoal(input: ProgressionInput): ProgressionWeek {
  const goalSecPerKm = input.raceGoalTimeSec / input.raceDistanceKm;
  const phase = resolvePhase(input.daysToRace);

  const span = Math.max(14, input.startingDaysToRace - 14);
  const elapsed = Math.max(0, input.startingDaysToRace - input.daysToRace);
  const progressFraction = clamp(elapsed / span, 0, 1);

  // Training paces blend toward goal over time; cap so we never prescribe full race pace in training
  let paceBlend = progressFraction * 0.65;
  if (phase === 'base') paceBlend = Math.min(paceBlend, 0.12);
  if (phase === 'build') paceBlend = Math.min(paceBlend, 0.35);
  if (phase === 'peak') paceBlend = Math.min(Math.max(paceBlend, 0.35), 0.55);
  if (phase === 'taper') paceBlend = Math.min(Math.max(paceBlend, 0.4), 0.5);

  const anchorPace = Math.round(
    input.currentPaceSecPerKm * (1 - paceBlend) + goalSecPerKm * paceBlend,
  );
  const paceBands = buildPaceBands(
    input.raceDistanceKm,
    input.raceGoalTimeSec,
    anchorPace,
  );

  const abilityWeekly = round1(
    input.longestRunKm + input.typicalSessionKm * Math.max(1, input.trainingDays - 1),
  );
  const racePeakWeekly = round1(
    calculateVolumeBaseline(input.raceDistanceKm, input.trainingDays) * 1.15,
  );

  // Volume path: start at ability, rise toward race peak by peak phase, then taper
  let volumeBaselineKm = round1(
    abilityWeekly * (1 - progressFraction * 0.5) + racePeakWeekly * (progressFraction * 0.5),
  );
  volumeBaselineKm = round1(Math.max(abilityWeekly, Math.min(racePeakWeekly, volumeBaselineKm)));

  if (input.readiness === 'progress') {
    volumeBaselineKm = round1(Math.min(racePeakWeekly, volumeBaselineKm * 1.04));
  } else if (input.readiness === 'ease') {
    volumeBaselineKm = round1(Math.max(abilityWeekly * 0.95, volumeBaselineKm * 0.96));
  }

  let weeklyKm = targetWeeklyKm(volumeBaselineKm, phase);
  // Never prescribe a long below ~90% of what last-3 already showed
  const minLongKm = round1(Math.max(6, input.longestRunKm * (0.9 + progressFraction * 0.08)));
  const minEasyKm = round1(Math.max(4, input.typicalSessionKm * 0.9));

  // Ensure weekly can fit floors
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

  const note = `Last 3 runs → now ~${curMin}:${curSec}/km, longest ${input.longestRunKm} km. Path to race goal ${goalPaceMin}:${goalPaceSec}/km · ${input.raceDistanceKm} km (${input.daysToRace}d out, blend ${Math.round(paceBlend * 100)}%).`;

  return {
    paceBands,
    progressFraction,
    paceBlend,
    volumeBaselineKm,
    weeklyKm,
    minLongKm,
    minEasyKm,
    phase,
    note,
  };
}
