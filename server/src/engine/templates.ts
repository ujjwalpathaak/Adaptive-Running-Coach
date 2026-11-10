import { formatPaceBand } from './paces.js';
import type {
  PaceBands,
  SessionExpectation,
  SessionPrescription,
  SessionType,
  TrainingPhase,
} from './types.js';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function fmtMin(sec: number): string {
  const m = Math.round(sec / 60);
  return `${m} min`;
}

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
      repWorkSec: null,
      repRecoverySec: null,
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
      repWorkSec: null,
      repRecoverySec: null,
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
      repWorkSec: null,
      repRecoverySec: null,
      paceBand: paces.long,
      notes: `Aerobic long run · ${formatPaceBand(paces.long)}`,
    };
  }

  // Quality — structured, rep-based, phase-appropriate (SVGN session formats).
  // Pace band here is the "quality" band (already anchored to current fitness,
  // blended toward race goal over time by the progression engine upstream).
  const warm = Math.min(2, round1(distanceKm * 0.2));
  const cool = Math.min(1.5, round1(distanceKm * 0.15));
  const work = round1(Math.max(1, distanceKm - warm - cool));
  const band = paces.quality;

  if (phase === 'base') {
    // Beginner-friendly fartlek: short strong/easy alternation, builds rhythm
    // without heavy fatigue cost. 8 x 1 min strong / 1 min easy.
    const reps = 8;
    const workSec = 60;
    const recoverySec = 60;
    return {
      structure: 'fartlek',
      warmUpKm: warm,
      coolDownKm: cool,
      workDistanceKm: work,
      reps,
      repWorkSec: workSec,
      repRecoverySec: recoverySec,
      paceBand: band,
      notes: `Fartlek · ${reps} x ${fmtMin(workSec)} strong / ${fmtMin(recoverySec)} easy · strong ≈ ${formatPaceBand(band)}`,
    };
  }

  if (phase === 'build') {
    // Controlled interval session: 5 x 3 min strong / 2 min easy
    const reps = 5;
    const workSec = 180;
    const recoverySec = 120;
    return {
      structure: 'intervals',
      warmUpKm: warm,
      coolDownKm: cool,
      workDistanceKm: work,
      reps,
      repWorkSec: workSec,
      repRecoverySec: recoverySec,
      paceBand: band,
      notes: `Intervals · ${reps} x ${fmtMin(workSec)} strong / ${fmtMin(recoverySec)} easy · ${formatPaceBand(band)}`,
    };
  }

  if (phase === 'peak') {
    // Threshold-style, race-specific: 3 x 8 min controlled hard / 2 min easy
    const reps = 3;
    const workSec = 480;
    const recoverySec = 120;
    return {
      structure: 'threshold',
      warmUpKm: warm,
      coolDownKm: cool,
      workDistanceKm: work,
      reps,
      repWorkSec: workSec,
      repRecoverySec: recoverySec,
      paceBand: band,
      notes: `Threshold (race-specific) · ${reps} x ${fmtMin(workSec)} controlled hard / ${fmtMin(recoverySec)} easy · ${formatPaceBand(band)}`,
    };
  }

  // taper — short sharpeners, hold a little intensity without accumulating fatigue
  const reps = 4;
  const workSec = 120;
  const recoverySec = 120;
  return {
    structure: 'vo2',
    warmUpKm: warm,
    coolDownKm: cool,
    workDistanceKm: work,
    reps,
    repWorkSec: workSec,
    repRecoverySec: recoverySec,
    paceBand: band,
    notes: `Short sharpeners · ${reps} x ${fmtMin(workSec)} race effort / ${fmtMin(recoverySec)} easy · ${formatPaceBand(band)}`,
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
