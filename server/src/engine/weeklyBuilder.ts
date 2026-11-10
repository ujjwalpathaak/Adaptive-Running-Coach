import { phaseFocus, phaseVolumeFactor } from './phases.js';
import { buildExpectation, buildPrescription } from './templates.js';
import type { EngineSession, PaceBands, SessionType, TrainingPhase } from './types.js';

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function mondayOf(date = new Date()): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayNum = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayNum}`;
}

/** Baseline weekly km from race distance + frequency (before phase factor). */
export function calculateVolumeBaseline(raceDistanceKm: number, trainingDays: number): number {
  const factor = 1.25 + trainingDays * 0.12;
  return round1(Math.max(raceDistanceKm * factor, trainingDays * 5));
}

function trainingDayIndexes(count: number): number[] {
  if (count >= 7) return [0, 1, 2, 3, 4, 5, 6];
  const indexes: number[] = [];
  for (let i = 0; i < count; i += 1) {
    indexes.push(Math.round((i * 6) / Math.max(1, count - 1)));
  }
  return [...new Set(indexes)].slice(0, count);
}

function splitDistances(weeklyKm: number, trainingDays: number, phase: TrainingPhase): number[] {
  if (trainingDays === 2) {
    // easy + long
    return [round1(weeklyKm * 0.4), round1(weeklyKm * 0.6)];
  }

  const longShare = phase === 'taper' ? 0.32 : 0.36;
  const qualityShare = trainingDays >= 3 ? (phase === 'taper' ? 0.18 : 0.22) : 0;
  const remainingShare = 1 - longShare - qualityShare;
  const easyCount = trainingDays - 1 - (qualityShare > 0 ? 1 : 0);
  const easyEach = easyCount > 0 ? remainingShare / easyCount : 0;

  const distances: number[] = [];
  for (let i = 0; i < easyCount; i += 1) distances.push(round1(weeklyKm * easyEach));
  if (qualityShare > 0) distances.push(round1(weeklyKm * qualityShare));
  distances.push(round1(weeklyKm * longShare));

  const drift = round1(weeklyKm - distances.reduce((s, d) => s + d, 0));
  distances[distances.length - 1] = round1(distances[distances.length - 1] + drift);
  return distances;
}

function classify(
  distanceKm: number,
  maxDistance: number,
  isQualitySlot: boolean,
  trainingDays: number,
): SessionType {
  if (distanceKm === maxDistance) return 'long';
  if (isQualitySlot && trainingDays >= 3) return 'quality';
  return 'easy';
}

export interface WeeklyBuildInput {
  weekOf: string;
  weeklyKm: number;
  trainingDays: number;
  phase: TrainingPhase;
  paces: PaceBands;
  /** Floor long run near what the athlete already completes */
  minLongKm?: number;
  /** Floor easy/quality near typical recent session distance */
  minEasyKm?: number;
}

export interface WeeklyBuildResult {
  weekOf: string;
  weeklyKm: number;
  focus: string;
  sessions: EngineSession[];
}

/**
 * Raise split distances so long/easy are not below recent capability.
 * Returns updated distance list; caller should use sum as weeklyKm.
 */
function enforceDistanceFloors(
  distances: number[],
  trainingDays: number,
  minLongKm: number,
  minEasyKm: number,
): number[] {
  if (distances.length === 0) return distances;
  const out = [...distances];
  const longIdx = out.length - 1;
  out[longIdx] = round1(Math.max(out[longIdx], minLongKm));

  for (let i = 0; i < longIdx; i += 1) {
    const isQuality = trainingDays >= 3 && i === longIdx - 1;
    const floor = isQuality ? round1(Math.max(4, minEasyKm * 0.85)) : minEasyKm;
    out[i] = round1(Math.max(out[i], floor));
  }
  return out;
}

export function buildWeeklyPlan(input: WeeklyBuildInput): WeeklyBuildResult {
  let distances = splitDistances(input.weeklyKm, input.trainingDays, input.phase);
  const minLongKm = input.minLongKm ?? 0;
  const minEasyKm = input.minEasyKm ?? 0;
  if (minLongKm > 0 || minEasyKm > 0) {
    distances = enforceDistanceFloors(
      distances,
      input.trainingDays,
      minLongKm,
      minEasyKm,
    );
  }
  const weeklyKm = round1(distances.reduce((s, d) => s + d, 0));
  const maxDistance = Math.max(...distances);
  const dayIndexes = trainingDayIndexes(input.trainingDays);
  const byDay = new Map<number, number>();
  dayIndexes.forEach((dayIndex, i) => byDay.set(dayIndex, distances[i]));

  const qualityDayIndex =
    input.trainingDays >= 3
      ? dayIndexes[Math.max(0, Math.floor(dayIndexes.length / 2) - (dayIndexes.length > 3 ? 1 : 0))]
      : -1;

  const sessions: EngineSession[] = WEEK_DAYS.map((day, index) => {
    const date = addDays(input.weekOf, index);
    const distanceKm = byDay.get(index) ?? null;

    if (distanceKm == null) {
      const prescription = buildPrescription('rest', null, input.phase, input.paces);
      return {
        id: `ses-${input.weekOf}-${index + 1}`,
        day,
        date,
        type: 'rest',
        title: 'Rest',
        purpose: 'Recovery day',
        distanceKm: null,
        durationSec: null,
        completed: false,
        status: 'scheduled',
        prescription,
        expectation: buildExpectation('rest', prescription),
        linkedActivityId: null,
        lastSignal: null,
        lastScoreSummary: null,
        lastActualPaceSecPerKm: null,
        extras: [],
      };
    }

    const type = classify(distanceKm, maxDistance, index === qualityDayIndex, input.trainingDays);
    const prescription = buildPrescription(type, distanceKm, input.phase, input.paces);
    const centerPace =
      type === 'easy'
        ? (input.paces.easy.minSecPerKm + input.paces.easy.maxSecPerKm) / 2
        : type === 'long'
          ? (input.paces.long.minSecPerKm + input.paces.long.maxSecPerKm) / 2
          : (input.paces.quality.minSecPerKm + input.paces.quality.maxSecPerKm) / 2;
    const durationSec = Math.round(distanceKm * centerPace);
    const label = type === 'long' ? 'Long run' : type === 'quality' ? 'Quality' : 'Easy';

    return {
      id: `ses-${input.weekOf}-${index + 1}`,
      day,
      date,
      type,
      title: `${label} ${distanceKm} km`,
      purpose: prescription.notes,
      distanceKm,
      durationSec,
      completed: false,
      status: 'scheduled',
      prescription,
      expectation: buildExpectation(type, prescription),
      linkedActivityId: null,
      lastSignal: null,
      lastScoreSummary: null,
      lastActualPaceSecPerKm: null,
      extras: [],
    };
  });

  return {
    weekOf: input.weekOf,
    weeklyKm,
    focus: `${phaseFocus(input.phase)} · ${input.trainingDays} days · ${weeklyKm} km`,
    sessions,
  };
}

export function targetWeeklyKm(volumeBaselineKm: number, phase: TrainingPhase): number {
  return round1(volumeBaselineKm * phaseVolumeFactor(phase));
}
