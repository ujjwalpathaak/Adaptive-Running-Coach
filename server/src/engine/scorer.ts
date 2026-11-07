import type { EngineSession, PerformanceSignal, RunActual, SessionScore } from './types.js';

function midPace(band: { minSecPerKm: number; maxSecPerKm: number }): number {
  return (band.minSecPerKm + band.maxSecPerKm) / 2;
}

/**
 * Score actual Garmin execution against the session expectation.
 * Progressive-friendly: slightly fast easy pace with controlled effort → on_track / too_easy,
 * not automatically too_hard.
 */
export function scoreSession(session: EngineSession, run: RunActual): SessionScore {
  const details: string[] = [];
  const expectedDistance = session.distanceKm ?? 0;
  const distancePct = expectedDistance > 0 ? run.distanceKm / expectedDistance : 1;
  details.push(`Distance ${run.distanceKm.toFixed(2)} km vs planned ${expectedDistance || '—'} km (${Math.round(distancePct * 100)}%)`);

  const band = session.expectation.paceBand;
  let paceDeltaSec: number | null = null;
  if (band && run.avgPaceSecPerKm != null) {
    const mid = midPace(band);
    paceDeltaSec = Math.round(run.avgPaceSecPerKm - mid);
    details.push(
      `Pace ${formatPace(run.avgPaceSecPerKm)} vs band ${formatPace(band.minSecPerKm)}–${formatPace(band.maxSecPerKm)} (Δ ${paceDeltaSec}s/km vs mid)`,
    );
  }

  if (run.avgHr != null) details.push(`Avg HR ${run.avgHr}`);
  if (run.lateFadeRatio != null) {
    details.push(`Late-split fade ratio ${run.lateFadeRatio.toFixed(2)}`);
  }

  let signal: PerformanceSignal;

  if (distancePct < 0.5) {
    signal = 'missed';
  } else if (distancePct < session.expectation.minDistancePct) {
    signal = 'partial';
  } else {
    const inBand =
      !band ||
      run.avgPaceSecPerKm == null ||
      (run.avgPaceSecPerKm >= band.minSecPerKm && run.avgPaceSecPerKm <= band.maxSecPerKm);

    const clearlyTooFast =
      band &&
      run.avgPaceSecPerKm != null &&
      run.avgPaceSecPerKm < band.minSecPerKm - 15;

    const clearlyTooSlow =
      band &&
      run.avgPaceSecPerKm != null &&
      run.avgPaceSecPerKm > band.maxSecPerKm + 20;

    const faded = run.lateFadeRatio != null && run.lateFadeRatio >= 1.08;
    const hrHigh =
      session.expectation.maxAvgHr != null &&
      run.avgHr != null &&
      run.avgHr > session.expectation.maxAvgHr;

    if ((clearlyTooFast && (faded || hrHigh)) || (faded && !inBand)) {
      signal = 'too_hard';
    } else if (clearlyTooSlow && !faded) {
      signal = 'too_easy';
    } else if (inBand || (!clearlyTooFast && !clearlyTooSlow)) {
      // Slightly faster than band without fade → progressive "too_easy" for easy/long only
      if (
        band &&
        run.avgPaceSecPerKm != null &&
        run.avgPaceSecPerKm < band.minSecPerKm &&
        !faded &&
        (session.type === 'easy' || session.type === 'long')
      ) {
        signal = 'too_easy';
      } else {
        signal = 'on_track';
      }
    } else {
      signal = 'on_track';
    }
  }

  const summary = signalLabel(signal, session.type);

  return {
    sessionId: session.id,
    activityId: run.activityId,
    signal,
    summary,
    distancePct,
    paceDeltaSec,
    details,
  };
}

function signalLabel(signal: PerformanceSignal, type: string): string {
  switch (signal) {
    case 'on_track':
      return `On track for ${type}`;
    case 'too_hard':
      return `${type} looked too hard vs prescription`;
    case 'too_easy':
      return `${type} left room — candidate for progressive load`;
    case 'missed':
      return `${type} largely missed`;
    case 'partial':
      return `${type} only partially completed`;
    case 'fatigue':
      return `Fatigue pattern on ${type}`;
  }
}

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, '0')}/km`;
}

/** Detect fatigue across recent scores (v1): consecutive too_hard/partial). */
export function detectFatigue(signals: PerformanceSignal[]): boolean {
  if (signals.length < 2) return false;
  const last = signals.slice(-3);
  const bad = last.filter((s) => s === 'too_hard' || s === 'partial' || s === 'fatigue');
  return bad.length >= 2;
}
