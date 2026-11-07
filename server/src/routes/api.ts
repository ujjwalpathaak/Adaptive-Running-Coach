import { Router } from 'express';
import { athlete } from '../data/athlete.js';
import { activities } from '../data/activities.js';
import { getCacheMode } from '../cache/redis.js';
import {
  clearGarminCache,
  getCachedGarminRunDetail,
  getCachedGarminRuns,
} from '../garmin/cache.js';
import { isGarminConfigured } from '../garmin/client.js';
import { lateFadeFromLaps } from '../engine/fade.js';
import {
  createPlan,
  endPlan,
  evaluateAndAdapt,
  getActivePlan,
  syncPlanWithGarmin,
} from '../data/planStore.js';
import type { CreatePlanInput, EvaluateRunInput } from '../types.js';

export const apiRouter = Router();

function sendError(res: import('express').Response, err: unknown) {
  const status =
    typeof err === 'object' && err && 'status' in err && typeof (err as { status: unknown }).status === 'number'
      ? (err as { status: number }).status
      : 500;
  const message = err instanceof Error ? err.message : 'Unexpected error';
  res.status(status).json({ error: message });
}

function garminNotConfigured(res: import('express').Response) {
  res.status(503).json({
    configured: false,
    error:
      'GARMIN_PERSONAL_API_KEY is not set. Create a Personal API key in Garmin Connect and add it to server/.env',
    setupUrl: 'https://developer.garmin.com/gc-developer-program/overview/',
  });
}

apiRouter.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'adaptive-running-coach',
    cache: getCacheMode(),
    engine: { goalModel: 'race_pace', adaptationStyle: 'progressive' },
  });
});

apiRouter.get('/athlete', (_req, res) => {
  res.json(athlete);
});

apiRouter.get('/activities', (_req, res) => {
  const sorted = [...activities].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
  );
  res.json(sorted);
});

apiRouter.get('/garmin/status', (_req, res) => {
  res.json({
    configured: isGarminConfigured(),
    program: 'personal',
    cache: getCacheMode(),
    docs: 'https://developer.garmin.com/gc-developer-program/overview/',
  });
});

apiRouter.get('/garmin/runs', async (req, res) => {
  try {
    if (!isGarminConfigured()) {
      garminNotConfigured(res);
      return;
    }

    const startDate =
      typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 50;
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';

    const { runs, cache, store } = await getCachedGarminRuns({
      startDate,
      endDate,
      limit,
      refresh,
    });
    res.json({
      configured: true,
      source: 'garmin-personal-api',
      cache,
      store,
      runs,
    });
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.get('/garmin/runs/:id', async (req, res) => {
  try {
    if (!isGarminConfigured()) {
      garminNotConfigured(res);
      return;
    }

    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const { run, cache, store } = await getCachedGarminRunDetail(String(req.params.id), {
      refresh,
    });
    res.json({
      configured: true,
      source: 'garmin-personal-api',
      cache,
      store,
      run,
    });
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.post('/garmin/cache/clear', async (_req, res) => {
  try {
    const result = await clearGarminCache();
    res.json({ cleared: true, ...result });
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.get('/plan/current', async (_req, res) => {
  try {
    if (getActivePlan()) {
      const plan = await syncPlanWithGarmin();
      res.json({ plan });
      return;
    }
    res.json({ plan: null });
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.post('/plan', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<CreatePlanInput>;
    const plan = await createPlan({
      title: String(body.title ?? ''),
      raceDistanceKm: Number(body.raceDistanceKm),
      raceGoalTimeSec: Number(body.raceGoalTimeSec),
      targetDate: String(body.targetDate ?? ''),
      trainingDaysPerWeek: Number(body.trainingDaysPerWeek),
    });
    res.status(201).json(plan);
  } catch (err) {
    sendError(res, err);
  }
});

apiRouter.post('/plan/end', (_req, res) => {
  try {
    const ended = endPlan();
    res.json({ ended: true, plan: ended });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * Score a completed run against the plan and apply progressive adaptations.
 * Body can be a raw EvaluateRunInput, or { activityId } to load Garmin detail.
 */
apiRouter.post('/plan/evaluate', async (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<EvaluateRunInput> & { activityId?: string };
    let input: EvaluateRunInput;

    if (body.activityId && (body.distanceKm == null || body.durationSec == null)) {
      if (!isGarminConfigured()) {
        garminNotConfigured(res);
        return;
      }
      const { run } = await getCachedGarminRunDetail(String(body.activityId));
      const distanceKm = Number(run.performance.distanceKm ?? 0);
      const durationSec = Number(run.performance.durationSec ?? 0);
      const avgPaceSecPerKm =
        run.performance.avgPaceSecPerKm == null
          ? null
          : Number(run.performance.avgPaceSecPerKm);
      const avgHr = run.heartRate.average == null ? null : Number(run.heartRate.average);
      const lateFadeRatio = lateFadeFromLaps(
        (run.laps ?? []).map((l) => ({
          durationSec: l.durationSec,
          distanceKm: l.distanceKm,
        })),
      );

      input = {
        activityId: String(run.id),
        startTime: String(run.startTimeLocal ?? run.startTimeGmt ?? new Date().toISOString()),
        distanceKm,
        durationSec,
        avgPaceSecPerKm,
        avgHr,
        lateFadeRatio,
      };
    } else {
      input = {
        activityId: String(body.activityId ?? `manual-${Date.now()}`),
        startTime: String(body.startTime ?? new Date().toISOString()),
        distanceKm: Number(body.distanceKm),
        durationSec: Number(body.durationSec),
        avgPaceSecPerKm: body.avgPaceSecPerKm == null ? null : Number(body.avgPaceSecPerKm),
        avgHr: body.avgHr == null ? null : Number(body.avgHr),
        lateFadeRatio: body.lateFadeRatio == null ? null : Number(body.lateFadeRatio),
      };
    }

    const result = evaluateAndAdapt(input);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});
