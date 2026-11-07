import {
  deriveKmSplitsFromMetrics,
  fetchFitLaps,
  type DerivedKmSplit,
  type FitLap,
} from './fitLaps.js';

const TOKEN_URL =
  'https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token';
const ACTIVITIES_URL =
  'https://personal.connectapi.garmin.com/activitylist-service/activities/search/activities';
const ACTIVITY_BASE = 'https://personal.connectapi.garmin.com/activity-service/activity';

export interface GarminRunRow {
  id: string;
  name: string;
  startTime: string;
  distanceKm: number;
  durationSec: number;
  avgPaceSecPerKm: number | null;
  avgHr: number | null;
  activityType: string;
}

export interface GarminRunDetail {
  id: string;
  name: string;
  activityType: string;
  eventType: string | null;
  locationName: string | null;
  startTimeLocal: string | null;
  startTimeGmt: string | null;
  overview: Record<string, string | number | boolean | null>;
  performance: Record<string, string | number | null>;
  heartRate: Record<string, string | number | null>;
  elevation: Record<string, string | number | null>;
  training: Record<string, string | number | null>;
  /** Official lap/split rows from the activity FIT file (preferred). */
  laps: FitLap[];
  lapsSource: 'fit' | 'metrics' | 'none';
  /** 1 km splits derived from the details metric stream (fallback / extra view). */
  kmSplits: DerivedKmSplit[];
  /** Aggregate run/walk/stand summaries from activity JSON. */
  splitSummaries: Array<Record<string, string | number | null>>;
  workout: {
    name: string | null;
    phrase: string | null;
    sport: string | null;
    steps: Array<Record<string, string | number | boolean | null>>;
  } | null;
  metadata: Record<string, string | number | boolean | null>;
  series: {
    descriptors: Array<{ key: string; unit: string | null }>;
    sampleCount: number;
    heartRate: number[];
    speedMps: number[];
    cadence: number[];
  };
  availableEndpoints: Record<string, 'ok' | 'missing' | 'error'>;
}

interface TokenCache {
  token: string;
  expiresAtMs: number;
}

let tokenCache: TokenCache | null = null;

export function isGarminConfigured(): boolean {
  return Boolean(process.env.GARMIN_PERSONAL_API_KEY?.trim());
}

function requireApiKey(): string {
  const apiKey = process.env.GARMIN_PERSONAL_API_KEY?.trim();
  if (!apiKey) {
    throw Object.assign(
      new Error(
        'GARMIN_PERSONAL_API_KEY is not set. Create a Personal API key in Garmin Connect and add it to server/.env',
      ),
      { status: 503 },
    );
  }
  return apiKey;
}

async function obtainAccessToken(apiKey: string): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAtMs > now + 60_000) {
    return tokenCache.token;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `ApiKey ${apiKey}` },
  });

  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(
      new Error(`Garmin token request failed (${res.status}): ${body || res.statusText}`),
      { status: res.status === 401 || res.status === 403 ? 401 : 502 },
    );
  }

  const raw = (await res.text()).trim();
  let token = raw;
  try {
    const parsed = JSON.parse(raw) as { access_token?: string; accessToken?: string };
    token = parsed.access_token ?? parsed.accessToken ?? raw.replace(/^"|"$/g, '');
  } catch {
    token = raw.replace(/^"|"$/g, '');
  }

  if (!token) {
    throw Object.assign(new Error('Garmin token response was empty'), { status: 502 });
  }

  tokenCache = {
    token,
    expiresAtMs: now + 23 * 60 * 60 * 1000,
  };
  return token;
}

async function garminFetch(path: string, token: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const res = await fetch(path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401 || res.status === 403) {
    tokenCache = null;
  }
  if (!res.ok) {
    return { ok: false, status: res.status, data: null };
  }
  return { ok: true, status: res.status, data: await res.json() };
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isRunningType(typeKey: string): boolean {
  const key = typeKey.toLowerCase();
  return (
    key.includes('run') ||
    key.includes('trail') ||
    key === 'treadmill_running' ||
    key === 'indoor_running'
  );
}

function metersToKm(meters: unknown): number | null {
  const n = Number(meters);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((n / 1000) * 100) / 100;
}

function mpsToPaceSecPerKm(mps: unknown): number | null {
  const speed = Number(mps);
  if (!Number.isFinite(speed) || speed <= 0) return null;
  return Math.round(1000 / speed);
}

function round(n: unknown, digits = 1): number | null {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

function mapActivity(raw: Record<string, unknown>): GarminRunRow | null {
  const typeObj = raw.activityType as { typeKey?: string; typeId?: number } | undefined;
  const typeKey = String(typeObj?.typeKey ?? raw.activityType ?? 'unknown');
  if (!isRunningType(typeKey) && typeKey !== 'unknown') {
    const name = String(raw.activityName ?? '');
    if (!/run/i.test(name)) return null;
  }

  const distanceMeters = Number(raw.distance ?? raw.distanceInMeters ?? 0);
  const durationSec = Math.round(Number(raw.duration ?? raw.elapsedDuration ?? 0));
  const distanceKm = distanceMeters > 0 ? Math.round((distanceMeters / 1000) * 100) / 100 : 0;
  const avgHrRaw = raw.averageHR ?? raw.avgHR ?? null;
  const avgHr = avgHrRaw == null ? null : Number(avgHrRaw);
  const startTime = String(
    raw.startTimeLocal ?? raw.startTimeGMT ?? raw.beginTimestamp ?? new Date().toISOString(),
  );

  return {
    id: String(raw.activityId ?? raw.activityIdEncoded ?? crypto.randomUUID()),
    name: String(raw.activityName ?? 'Untitled activity'),
    startTime,
    distanceKm,
    durationSec,
    avgPaceSecPerKm: distanceKm > 0 && durationSec > 0 ? Math.round(durationSec / distanceKm) : null,
    avgHr: Number.isFinite(avgHr as number) ? (avgHr as number) : null,
    activityType: typeKey,
  };
}

function extractSeries(details: Record<string, unknown> | null): GarminRunDetail['series'] {
  if (!details) {
    return { descriptors: [], sampleCount: 0, heartRate: [], speedMps: [], cadence: [] };
  }

  const descriptorsRaw = Array.isArray(details.metricDescriptors) ? details.metricDescriptors : [];
  const descriptors = descriptorsRaw.map((d) => {
    const row = (d ?? {}) as { key?: string; unit?: { key?: string } };
    return { key: String(row.key ?? 'unknown'), unit: row.unit?.key ?? null };
  });

  const indexOf = (key: string) => descriptors.findIndex((d) => d.key === key);
  const hrIdx = indexOf('directHeartRate');
  const speedIdx = indexOf('directSpeed');
  const cadenceIdx = indexOf('directRunCadence');

  const metrics = Array.isArray(details.activityDetailMetrics) ? details.activityDetailMetrics : [];
  const heartRate: number[] = [];
  const speedMps: number[] = [];
  const cadence: number[] = [];

  for (const sample of metrics) {
    const metricsArr = Array.isArray(sample)
      ? sample
      : Array.isArray((sample as { metrics?: unknown[] }).metrics)
        ? ((sample as { metrics: unknown[] }).metrics)
        : null;
    if (!metricsArr) continue;
    if (hrIdx >= 0 && metricsArr[hrIdx] != null) heartRate.push(Number(metricsArr[hrIdx]));
    if (speedIdx >= 0 && metricsArr[speedIdx] != null) speedMps.push(Number(metricsArr[speedIdx]));
    if (cadenceIdx >= 0 && metricsArr[cadenceIdx] != null) cadence.push(Number(metricsArr[cadenceIdx]));
  }

  return {
    descriptors,
    sampleCount: metrics.length,
    heartRate: heartRate.filter((n) => Number.isFinite(n)),
    speedMps: speedMps.filter((n) => Number.isFinite(n)),
    cadence: cadence.filter((n) => Number.isFinite(n)),
  };
}

export async function fetchGarminRuns(options?: {
  startDate?: string;
  endDate?: string;
  limit?: number;
}): Promise<GarminRunRow[]> {
  const apiKey = requireApiKey();
  const end = options?.endDate ? new Date(options.endDate) : new Date();
  const start = options?.startDate
    ? new Date(options.startDate)
    : new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
  const limit = options?.limit ?? 50;

  const token = await obtainAccessToken(apiKey);
  const url = new URL(ACTIVITIES_URL);
  url.searchParams.set('startDate', isoDate(start));
  url.searchParams.set('endDate', isoDate(end));
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('start', '0');

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) tokenCache = null;
    const body = await res.text();
    throw Object.assign(
      new Error(`Garmin activities request failed (${res.status}): ${body || res.statusText}`),
      { status: res.status === 401 || res.status === 403 ? 401 : 502 },
    );
  }

  const payload = (await res.json()) as unknown;
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { activities?: unknown[] }).activities)
      ? ((payload as { activities: unknown[] }).activities)
      : [];

  return list
    .map((item) => mapActivity((item ?? {}) as Record<string, unknown>))
    .filter((row): row is GarminRunRow => row != null)
    .sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
}

export async function fetchGarminRunDetail(activityId: string): Promise<GarminRunDetail> {
  const apiKey = requireApiKey();
  const token = await obtainAccessToken(apiKey);
  const id = encodeURIComponent(activityId);

  const [activityRes, detailsRes, workoutsRes, splitsRes, weatherRes, hrZonesRes, gearRes, fitLapsResult] =
    await Promise.all([
      garminFetch(`${ACTIVITY_BASE}/${id}`, token),
      garminFetch(
        `${ACTIVITY_BASE}/${id}/details?maxChartSize=5000&maxPolylineSize=4000`,
        token,
      ),
      garminFetch(`${ACTIVITY_BASE}/${id}/workouts`, token),
      garminFetch(`${ACTIVITY_BASE}/${id}/splits`, token),
      garminFetch(`${ACTIVITY_BASE}/${id}/weather`, token),
      garminFetch(`${ACTIVITY_BASE}/${id}/hrTimeInZones`, token),
      garminFetch(`${ACTIVITY_BASE}/${id}/gear`, token),
      fetchFitLaps(activityId, token)
        .then((laps) => ({ ok: true as const, laps }))
        .catch((err: unknown) => ({
          ok: false as const,
          laps: [] as FitLap[],
          error: err instanceof Error ? err.message : 'FIT parse failed',
        })),
    ]);

  if (!activityRes.ok || !activityRes.data) {
    throw Object.assign(
      new Error(
        activityRes.status === 404
          ? 'Garmin activity not found'
          : `Garmin activity request failed (${activityRes.status})`,
      ),
      { status: activityRes.status === 404 ? 404 : 502 },
    );
  }

  const activity = activityRes.data as Record<string, unknown>;
  const summary = (activity.summaryDTO ?? {}) as Record<string, unknown>;
  const metadata = (activity.metadataDTO ?? {}) as Record<string, unknown>;
  const typeKey = String(
    (activity.activityTypeDTO as { typeKey?: string } | undefined)?.typeKey ?? 'unknown',
  );
  const eventType =
    (activity.eventTypeDTO as { typeKey?: string } | undefined)?.typeKey ?? null;
  const distanceKm = metersToKm(summary.distance);
  const durationSec = round(summary.duration, 0);
  const movingSec = round(summary.movingDuration, 0);

  const splitSummaries = Array.isArray(activity.splitSummaries)
    ? activity.splitSummaries.map((s) => {
        const row = (s ?? {}) as Record<string, unknown>;
        return {
          splitType: String(row.splitType ?? 'UNKNOWN'),
          count: round(row.noOfSplits, 0),
          distanceKm: metersToKm(row.distance),
          durationSec: round(row.duration, 0),
          avgHr: round(row.averageHR, 0),
          maxHr: round(row.maxHR, 0),
          avgPaceSecPerKm: mpsToPaceSecPerKm(row.averageMovingSpeed ?? row.averageSpeed),
          avgCadence: round(row.averageRunCadence, 1),
          strideLengthCm: round(row.strideLength, 1),
          calories: round(row.calories, 0),
        };
      })
    : [];

  let workout: GarminRunDetail['workout'] = null;
  if (workoutsRes.ok && Array.isArray(workoutsRes.data) && workoutsRes.data.length > 0) {
    const first = (workoutsRes.data[0] ?? {}) as Record<string, unknown>;
    const stepsRaw = Array.isArray(first.steps) ? first.steps : [];
    workout = {
      name: first.workoutName == null ? null : String(first.workoutName),
      phrase: first.workoutPhrase == null ? null : String(first.workoutPhrase),
      sport: first.sport == null ? null : String(first.sport),
      steps: stepsRaw.map((step) => {
        const s = (step ?? {}) as Record<string, unknown>;
        return {
          type: s.type == null ? null : String(s.type),
          intensity: s.intensity == null ? null : String(s.intensity),
          durationType: s.durationType == null ? null : String(s.durationType),
          durationValue: round(s.durationValue, 2),
          targetType: s.targetType == null ? null : String(s.targetType),
          targetValue: round(s.targetValue, 2),
          description: s.description == null ? null : String(s.description),
        };
      }),
    };
  }

  const details = detailsRes.ok ? ((detailsRes.data ?? null) as Record<string, unknown> | null) : null;
  const series = extractSeries(details);
  const kmSplits = deriveKmSplitsFromMetrics(details);
  const fitLaps = fitLapsResult.ok ? fitLapsResult.laps : [];
  const laps = fitLaps.length > 0 ? fitLaps : kmSplits.map((s) => ({
    index: s.index,
    distanceKm: s.distanceKm,
    durationSec: s.durationSec,
    movingDurationSec: s.durationSec,
    avgPaceSecPerKm: s.avgPaceSecPerKm,
    avgHr: s.avgHr,
    maxHr: null,
    avgCadence: s.avgCadence,
    elevationGainM: null,
    elevationLossM: null,
    calories: null,
    startTime: null,
    intensity: null,
    trigger: 'distance',
  }));
  const lapsSource: GarminRunDetail['lapsSource'] =
    fitLaps.length > 0 ? 'fit' : kmSplits.length > 0 ? 'metrics' : 'none';

  const availableEndpoints: GarminRunDetail['availableEndpoints'] = {
    activity: activityRes.ok ? 'ok' : 'error',
    details: detailsRes.ok ? 'ok' : detailsRes.status === 404 ? 'missing' : 'error',
    workouts: workoutsRes.ok ? 'ok' : workoutsRes.status === 404 ? 'missing' : 'error',
    splits: splitsRes.ok ? 'ok' : splitsRes.status === 404 ? 'missing' : 'error',
    fitDownload: fitLapsResult.ok ? 'ok' : 'error',
    weather: weatherRes.ok ? 'ok' : weatherRes.status === 404 ? 'missing' : 'error',
    hrTimeInZones: hrZonesRes.ok ? 'ok' : hrZonesRes.status === 404 ? 'missing' : 'error',
    gear: gearRes.ok ? 'ok' : gearRes.status === 404 ? 'missing' : 'error',
  };

  return {
    id: String(activity.activityId ?? activityId),
    name: String(activity.activityName ?? 'Untitled activity'),
    activityType: typeKey,
    eventType,
    locationName: activity.locationName == null ? null : String(activity.locationName),
    startTimeLocal: summary.startTimeLocal == null ? null : String(summary.startTimeLocal),
    startTimeGmt: summary.startTimeGMT == null ? null : String(summary.startTimeGMT),
    overview: {
      activityType: typeKey,
      eventType,
      locationName: activity.locationName == null ? null : String(activity.locationName),
      startTimeLocal: summary.startTimeLocal == null ? null : String(summary.startTimeLocal),
      startTimeGmt: summary.startTimeGMT == null ? null : String(summary.startTimeGMT),
      manufacturer: metadata.manufacturer == null ? null : String(metadata.manufacturer),
      lapCount: round(metadata.lapCount, 0),
      favorite: metadata.favorite == null ? null : Boolean(metadata.favorite),
      personalRecord: metadata.personalRecord == null ? null : Boolean(metadata.personalRecord),
    },
    performance: {
      distanceKm,
      durationSec,
      movingDurationSec: movingSec,
      elapsedDurationSec: round(summary.elapsedDuration, 0),
      avgPaceSecPerKm: mpsToPaceSecPerKm(summary.averageMovingSpeed ?? summary.averageSpeed),
      avgSpeedMps: round(summary.averageMovingSpeed ?? summary.averageSpeed, 3),
      maxSpeedMps: round(summary.maxSpeed, 3),
      calories: round(summary.calories, 0),
      bmrCalories: round(summary.bmrCalories, 0),
      steps: round(summary.steps, 0),
      avgCadence: round(summary.averageRunCadence, 1),
      maxCadence: round(summary.maxRunCadence, 1),
      strideLengthCm: round(summary.strideLength, 1),
      waterEstimatedMl: round(summary.waterEstimated, 0),
    },
    heartRate: {
      average: round(summary.averageHR, 0),
      max: round(summary.maxHR, 0),
      min: round(summary.minHR, 0),
    },
    elevation: {
      gainM: round(summary.elevationGain, 1),
      lossM: round(summary.elevationLoss, 1),
      minM: round(summary.minElevation, 1),
      maxM: round(summary.maxElevation, 1),
      avgM: round(summary.avgElevation, 1),
      maxVerticalSpeed: round(summary.maxVerticalSpeed, 2),
    },
    training: {
      label: summary.trainingEffectLabel == null ? null : String(summary.trainingEffectLabel),
      aerobicMessage:
        summary.aerobicTrainingEffectMessage == null
          ? null
          : String(summary.aerobicTrainingEffectMessage),
      anaerobicMessage:
        summary.anaerobicTrainingEffectMessage == null
          ? null
          : String(summary.anaerobicTrainingEffectMessage),
      moderateIntensityMinutes: round(summary.moderateIntensityMinutes, 0),
      vigorousIntensityMinutes: round(summary.vigorousIntensityMinutes, 0),
      bodyBatteryChange: round(summary.differenceBodyBattery, 0),
    },
    laps,
    lapsSource,
    kmSplits,
    splitSummaries,
    workout,
    metadata: {
      uploadedDate: metadata.uploadedDate == null ? null : String(metadata.uploadedDate),
      lastUpdateDate: metadata.lastUpdateDate == null ? null : String(metadata.lastUpdateDate),
      fileFormat:
        metadata.fileFormat == null
          ? null
          : String((metadata.fileFormat as { formatKey?: string }).formatKey ?? metadata.fileFormat),
      sensors: Array.isArray(metadata.sensors)
        ? metadata.sensors.map((s) => String(s)).join(', ')
        : metadata.sensors == null
          ? null
          : String(metadata.sensors),
      elevationCorrected:
        metadata.elevationCorrected == null ? null : Boolean(metadata.elevationCorrected),
      manualActivity: metadata.manualActivity == null ? null : Boolean(metadata.manualActivity),
    },
    series,
    availableEndpoints,
  };
}
