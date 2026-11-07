import type { EngineSession, RunActual } from './types.js';

export function dayStamp(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Match a Garmin run to a planned (incomplete) session when it looks intentional.
 * Same calendar day + distance within 50% of planned → planned match.
 * Otherwise return null so the sync layer can label it Extra.
 */
export function matchRunToSession(
  sessions: EngineSession[],
  run: RunActual,
): EngineSession | null {
  const runDay = dayStamp(run.startTime);
  const sameDayRunnable = sessions.filter(
    (s) =>
      s.date === runDay &&
      s.type !== 'rest' &&
      s.distanceKm != null &&
      !s.completed &&
      !s.linkedActivityId,
  );

  if (sameDayRunnable.length === 0) return null;

  const candidates = [...sameDayRunnable].sort((a, b) => {
    const aDist = Math.abs((a.distanceKm ?? 0) - run.distanceKm);
    const bDist = Math.abs((b.distanceKm ?? 0) - run.distanceKm);
    return aDist - bDist;
  });

  const best = candidates[0];
  if (!best || best.distanceKm == null) return null;

  const ratio =
    best.distanceKm > 0 ? run.distanceKm / best.distanceKm : 1;
  // Too far from prescription → treat as extra on that day
  if (ratio < 0.5 || ratio > 1.6) return null;

  return best;
}

/** Find the calendar-day session row (rest or workout) for attaching extras. */
export function sessionForDate(
  sessions: EngineSession[],
  isoOrDate: string,
): EngineSession | null {
  const stamp = dayStamp(isoOrDate);
  return sessions.find((s) => s.date === stamp) ?? null;
}
