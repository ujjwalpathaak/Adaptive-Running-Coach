/** Estimate late-run fade from lap paces. >1 means second half slower. */
export function lateFadeFromLaps(
  laps: Array<{ durationSec: number; distanceKm: number }>,
): number | null {
  const usable = laps.filter((l) => l.distanceKm >= 0.2 && l.durationSec > 0);
  if (usable.length < 2) return null;

  const paces = usable.map((l) => l.durationSec / l.distanceKm);
  const mid = Math.floor(paces.length / 2);
  const first = paces.slice(0, mid);
  const second = paces.slice(mid);
  if (!first.length || !second.length) return null;

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const a = avg(first);
  const b = avg(second);
  if (!(a > 0)) return null;
  return Math.round((b / a) * 100) / 100;
}
