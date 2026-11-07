import type { PaceBand, PaceBands } from './types.js';

function roundPace(sec: number): number {
  return Math.max(1, Math.round(sec));
}

function band(center: number, minusPct: number, plusPct: number): PaceBand {
  return {
    minSecPerKm: roundPace(center * (1 - minusPct)),
    maxSecPerKm: roundPace(center * (1 + plusPct)),
  };
}

/**
 * Training pace bands.
 * When `currentPaceSecPerKm` is provided (from recent Garmin), bands are anchored
 * there — not to race goal — so prescriptions don't jump to race pace overnight.
 * Race goal remains stored as `goalSecPerKm` for the target.
 *
 * - Easy: slower than current (~+8–16%)
 * - Long: around current (~±5%)
 * - Quality: modest pickup only (~3–8% faster than current), never a leap to goal
 */
export function buildPaceBands(
  raceDistanceKm: number,
  raceGoalTimeSec: number,
  currentPaceSecPerKm?: number | null,
): PaceBands {
  if (!(raceDistanceKm > 0) || !(raceGoalTimeSec > 0)) {
    throw new Error('Race distance and goal time must be positive');
  }
  const goalSecPerKm = roundPace(raceGoalTimeSec / raceDistanceKm);

  const hasCurrent =
    currentPaceSecPerKm != null &&
    Number.isFinite(currentPaceSecPerKm) &&
    currentPaceSecPerKm > 0;

  if (!hasCurrent) {
    // Fallback when Garmin pace unknown: conservative estimate slower than goal
    return {
      goalSecPerKm,
      easy: band(goalSecPerKm * 1.28, 0.04, 0.06),
      long: band(goalSecPerKm * 1.22, 0.04, 0.06),
      quality: band(goalSecPerKm * 1.12, 0.03, 0.05),
    };
  }

  const current = roundPace(currentPaceSecPerKm as number);

  // If already at/faster than goal, train around goal bands
  if (current <= goalSecPerKm * 1.05) {
    return {
      goalSecPerKm,
      easy: band(goalSecPerKm * 1.16, 0.04, 0.06),
      long: band(goalSecPerKm * 1.1, 0.04, 0.06),
      quality: band(goalSecPerKm * 1.02, 0.03, 0.05),
    };
  }

  // Cap quality pickup: at most ~8% faster than current (never jump to race goal)
  const qualityCenter = roundPace(current * 0.95);
  const longCenter = roundPace(current * 1.02);
  const easyCenter = roundPace(current * 1.1);

  return {
    goalSecPerKm,
    easy: band(easyCenter, 0.04, 0.06),
    long: band(longCenter, 0.04, 0.05),
    quality: band(qualityCenter, 0.03, 0.04),
  };
}

export function formatPaceBand(band: PaceBand): string {
  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.round(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };
  return `${fmt(band.minSecPerKm)}–${fmt(band.maxSecPerKm)}/km`;
}
