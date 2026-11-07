import { formatPaceBand } from './paces.js';
import type {
  PaceBands,
  SessionExpectation,
  SessionPrescription,
  SessionType,
  TrainingPhase,
} from './types.js';

export function buildPrescription(
  type: SessionType,
  distanceKm: number | null,
  phase: TrainingPhase,
  paces: PaceBands,
): SessionPrescription {
  if (type === 'rest' || distanceKm == null) {
    return {
      structure: 'rest',
      warmUpKm: 0,
      coolDownKm: 0,
      workDistanceKm: null,
      reps: null,
      paceBand: null,
      notes: 'Full rest or light mobility only',
    };
  }

  if (type === 'easy') {
    const warm = Math.min(1, round1(distanceKm * 0.1));
    const cool = warm;
    const work = round1(Math.max(0, distanceKm - warm - cool));
    return {
      structure: 'continuous',
      warmUpKm: warm,
      coolDownKm: cool,
      workDistanceKm: work,
      reps: null,
      paceBand: paces.easy,
      notes: `Conversational effort · ${formatPaceBand(paces.easy)}`,
    };
  }

  if (type === 'long') {
    const warm = Math.min(1.5, round1(distanceKm * 0.08));
    const cool = warm;
    const work = round1(Math.max(0, distanceKm - warm - cool));
    return {
      structure: 'continuous',
      warmUpKm: warm,
      coolDownKm: cool,
      workDistanceKm: work,
      reps: null,
      paceBand: paces.long,
      notes: `Aerobic long run · ${formatPaceBand(paces.long)}`,
    };
  }

  // quality
  const warm = Math.min(2, round1(distanceKm * 0.2));
  const cool = Math.min(1.5, round1(distanceKm * 0.15));
  const work = round1(Math.max(1, distanceKm - warm - cool));

  if (phase === 'base') {
    return {
      structure: 'steady',
      warmUpKm: warm,
      coolDownKm: cool,
      workDistanceKm: work,
      reps: 1,
      paceBand: paces.quality,
      notes: `Steady quality block · ${formatPaceBand(paces.quality)}`,
    };
  }

  if (phase === 'taper') {
    return {
      structure: 'tempo',
      warmUpKm: warm,
      coolDownKm: cool,
      workDistanceKm: work,
      reps: 1,
      paceBand: paces.quality,
      notes: `Short race-pace reminder · ${formatPaceBand(paces.quality)}`,
    };
  }

  // build / peak → tempo as continuous quality
  return {
    structure: 'tempo',
    warmUpKm: warm,
    coolDownKm: cool,
    workDistanceKm: work,
    reps: 1,
    paceBand: paces.quality,
    notes: `Tempo near goal pace · ${formatPaceBand(paces.quality)}`,
  };
}

export function buildExpectation(
  type: SessionType,
  prescription: SessionPrescription,
): SessionExpectation {
  if (type === 'rest') {
    return {
      minDistancePct: 0,
      maxDistancePct: 0,
      paceBand: null,
      maxAvgHr: null,
      requireComplete: false,
    };
  }

  if (type === 'easy') {
    return {
      minDistancePct: 0.85,
      maxDistancePct: 1.2,
      paceBand: prescription.paceBand,
      maxAvgHr: null,
      requireComplete: true,
    };
  }

  if (type === 'long') {
    return {
      minDistancePct: 0.85,
      maxDistancePct: 1.15,
      paceBand: prescription.paceBand,
      maxAvgHr: null,
      requireComplete: true,
    };
  }

  return {
    minDistancePct: 0.9,
    maxDistancePct: 1.15,
    paceBand: prescription.paceBand,
    maxAvgHr: null,
    requireComplete: true,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
