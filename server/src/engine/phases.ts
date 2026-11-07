import type { TrainingPhase } from './types.js';

export function daysBetween(fromIsoDate: string, toIsoDate: string): number {
  const from = new Date(fromIsoDate);
  const to = new Date(toIsoDate);
  from.setHours(0, 0, 0, 0);
  to.setHours(0, 0, 0, 0);
  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

export function daysToRace(targetDate: string, today = new Date()): number {
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return daysBetween(`${y}-${m}-${d}`, targetDate);
}

/**
 * Phase from days remaining (v1 race model).
 * >56 base, 29–56 build, 15–28 peak, ≤14 taper
 */
export function resolvePhase(daysRemaining: number): TrainingPhase {
  if (daysRemaining <= 14) return 'taper';
  if (daysRemaining <= 28) return 'peak';
  if (daysRemaining <= 56) return 'build';
  return 'base';
}

export function phaseFocus(phase: TrainingPhase): string {
  switch (phase) {
    case 'base':
      return 'Build aerobic base; keep quality controlled';
    case 'build':
      return 'Raise volume and sustain quality near goal pace';
    case 'peak':
      return 'Race-specific quality; hold volume or slight cut';
    case 'taper':
      return 'Shed fatigue; shorten volume, keep a little sharpness';
  }
}

/** Volume multiplier vs baseline by phase. */
export function phaseVolumeFactor(phase: TrainingPhase): number {
  switch (phase) {
    case 'base':
      return 0.9;
    case 'build':
      return 1.0;
    case 'peak':
      return 0.95;
    case 'taper':
      return 0.65;
  }
}
