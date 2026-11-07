import { createRequire } from 'node:module';
import { Buffer } from 'node:buffer';
import JSZip from 'jszip';

export interface FitLap {
  index: number;
  distanceKm: number;
  durationSec: number;
  movingDurationSec: number | null;
  avgPaceSecPerKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgCadence: number | null;
  elevationGainM: number | null;
  elevationLossM: number | null;
  calories: number | null;
  startTime: string | null;
  intensity: string | null;
  trigger: string | null;
}

export interface DerivedKmSplit {
  index: number;
  label: string;
  distanceKm: number;
  durationSec: number;
  avgPaceSecPerKm: number | null;
  avgHr: number | null;
  avgCadence: number | null;
}

type FitLapRaw = {
  total_distance?: number;
  total_elapsed_time?: number;
  total_timer_time?: number;
  enhanced_avg_speed?: number;
  avg_speed?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  avg_cadence?: number;
  total_ascent?: number;
  total_descent?: number;
  total_calories?: number;
  start_time?: Date | string;
  intensity?: string;
  lap_trigger?: string;
};

type FitParserCtor = new (opts: Record<string, unknown>) => {
  parse: (
    content: Buffer,
    cb: (error: Error | null, data: { laps?: FitLapRaw[] }) => void,
  ) => void;
};

const require = createRequire(import.meta.url);
const FitParserModule = require('fit-file-parser') as { default?: FitParserCtor } & FitParserCtor;
const FitParser = (FitParserModule.default ?? FitParserModule) as FitParserCtor;

function round(n: unknown, digits = 1): number | null {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function paceFromDistanceTime(distanceKm: number, durationSec: number): number | null {
  if (!(distanceKm > 0) || !(durationSec > 0)) return null;
  return Math.round(durationSec / distanceKm);
}

function paceFromSpeedMps(mps: unknown): number | null {
  const speed = Number(mps);
  if (!Number.isFinite(speed) || speed <= 0) return null;
  return Math.round(1000 / speed);
}

/** Garmin returns a ZIP containing one .fit file when Accept is star/star. */
export async function extractFitBuffer(zipOrFit: ArrayBuffer | Buffer): Promise<Buffer> {
  const buf = Buffer.isBuffer(zipOrFit) ? zipOrFit : Buffer.from(zipOrFit);
  if (!(buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b)) {
    return buf;
  }

  const zip = await JSZip.loadAsync(buf);
  const fitEntry = Object.values(zip.files).find(
    (f) => !f.dir && f.name.toLowerCase().endsWith('.fit'),
  );
  if (!fitEntry) {
    throw new Error('No .fit file found inside Garmin activity ZIP');
  }
  const content = await fitEntry.async('nodebuffer');
  return Buffer.from(content);
}

export async function parseFitLaps(fitBuffer: Buffer): Promise<FitLap[]> {
  const parser = new FitParser({
    force: true,
    speedUnit: 'm/s',
    lengthUnit: 'm',
    temperatureUnit: 'celsius',
  });

  const data = await new Promise<{ laps?: FitLapRaw[] }>((resolve, reject) => {
    parser.parse(fitBuffer, (error, parsed) => {
      if (error) reject(error);
      else resolve(parsed);
    });
  });

  const laps = Array.isArray(data.laps) ? data.laps : [];
  return laps
    .map((lap, index) => {
      const distanceM = Number(lap.total_distance ?? 0);
      const distanceKm = distanceM > 0 ? Math.round((distanceM / 1000) * 100) / 100 : 0;
      const durationSec = Math.round(Number(lap.total_elapsed_time ?? lap.total_timer_time ?? 0));
      const moving = lap.total_timer_time == null ? null : Math.round(Number(lap.total_timer_time));
      const start =
        lap.start_time instanceof Date
          ? lap.start_time.toISOString()
          : lap.start_time
            ? String(lap.start_time)
            : null;

      return {
        index: index + 1,
        distanceKm,
        durationSec,
        movingDurationSec: moving,
        avgPaceSecPerKm:
          paceFromSpeedMps(lap.enhanced_avg_speed ?? lap.avg_speed) ??
          paceFromDistanceTime(distanceKm, durationSec),
        avgHr: round(lap.avg_heart_rate, 0),
        maxHr: round(lap.max_heart_rate, 0),
        avgCadence: round(lap.avg_cadence, 1),
        elevationGainM: round(lap.total_ascent, 1),
        elevationLossM: round(lap.total_descent, 1),
        calories: round(lap.total_calories, 0),
        startTime: start,
        intensity: lap.intensity == null ? null : String(lap.intensity),
        trigger: lap.lap_trigger == null ? null : String(lap.lap_trigger),
      };
    })
    // Drop tiny end-of-session marker laps (e.g. 10 m session_end).
    .filter((lap) => lap.distanceKm >= 0.05 || lap.durationSec >= 20)
    .map((lap, index) => ({ ...lap, index: index + 1 }));
}

export async function fetchFitLaps(activityId: string, token: string): Promise<FitLap[]> {
  const res = await fetch(
    `https://personal.connectapi.garmin.com/download-service/files/activity/${encodeURIComponent(activityId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: '*/*',
      },
    },
  );
  if (!res.ok) {
    throw Object.assign(new Error(`FIT download failed (${res.status})`), {
      status: res.status,
    });
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const fit = await extractFitBuffer(bytes);
  return parseFitLaps(fit);
}

/** Build 1 km splits from details metric stream when FIT laps are unavailable. */
export function deriveKmSplitsFromMetrics(details: Record<string, unknown> | null): DerivedKmSplit[] {
  if (!details) return [];
  const descriptors = Array.isArray(details.metricDescriptors) ? details.metricDescriptors : [];
  const indexOf = (key: string) =>
    descriptors.findIndex((d) => String((d as { key?: string }).key ?? '') === key);
  const distanceIdx = indexOf('sumDistance');
  const durationIdx =
    indexOf('sumDuration') >= 0 ? indexOf('sumDuration') : indexOf('sumElapsedDuration');
  const hrIdx = indexOf('directHeartRate');
  const cadenceIdx = indexOf('directRunCadence');
  if (distanceIdx < 0 || durationIdx < 0) return [];

  const samples = Array.isArray(details.activityDetailMetrics) ? details.activityDetailMetrics : [];
  const points: Array<{
    distanceM: number;
    durationSec: number;
    hr: number | null;
    cadence: number | null;
  }> = [];

  for (const sample of samples) {
    const metrics = Array.isArray(sample)
      ? sample
      : Array.isArray((sample as { metrics?: unknown[] }).metrics)
        ? ((sample as { metrics: unknown[] }).metrics)
        : null;
    if (!metrics) continue;
    const distanceM = Number(metrics[distanceIdx]);
    const durationSec = Number(metrics[durationIdx]);
    if (!Number.isFinite(distanceM) || !Number.isFinite(durationSec)) continue;
    points.push({
      distanceM,
      durationSec,
      hr: hrIdx >= 0 && metrics[hrIdx] != null ? Number(metrics[hrIdx]) : null,
      cadence: cadenceIdx >= 0 && metrics[cadenceIdx] != null ? Number(metrics[cadenceIdx]) : null,
    });
  }

  if (points.length < 2) return [];

  const totalKm = points[points.length - 1].distanceM / 1000;
  const splits: DerivedKmSplit[] = [];
  let prevIdx = 0;

  const avgBetween = (from: number, to: number, field: 'hr' | 'cadence') => {
    let sum = 0;
    let count = 0;
    for (let i = from; i <= to; i += 1) {
      const v = points[i][field];
      if (v != null && Number.isFinite(v)) {
        sum += v;
        count += 1;
      }
    }
    return count ? Math.round((sum / count) * (field === 'cadence' ? 10 : 1)) / (field === 'cadence' ? 10 : 1) : null;
  };

  const fullKm = Math.floor(totalKm);
  for (let km = 1; km <= fullKm; km += 1) {
    const target = km * 1000;
    let at = prevIdx;
    while (at < points.length - 1 && points[at].distanceM < target) at += 1;
    const durationSec = Math.max(0, Math.round(points[at].durationSec - points[prevIdx].durationSec));
    splits.push({
      index: km,
      label: `${km} km`,
      distanceKm: 1,
      durationSec,
      avgPaceSecPerKm: paceFromDistanceTime(1, durationSec),
      avgHr: avgBetween(prevIdx, at, 'hr'),
      avgCadence: avgBetween(prevIdx, at, 'cadence'),
    });
    prevIdx = at;
  }

  const remM = points[points.length - 1].distanceM - fullKm * 1000;
  if (remM > 50) {
    const last = points.length - 1;
    const durationSec = Math.max(0, Math.round(points[last].durationSec - points[prevIdx].durationSec));
    const distanceKm = Math.round((remM / 1000) * 100) / 100;
    splits.push({
      index: fullKm + 1,
      label: `${distanceKm.toFixed(2)} km (final)`,
      distanceKm,
      durationSec,
      avgPaceSecPerKm: paceFromDistanceTime(distanceKm, durationSec),
      avgHr: avgBetween(prevIdx, last, 'hr'),
      avgCadence: avgBetween(prevIdx, last, 'cadence'),
    });
  }

  return splits;
}
