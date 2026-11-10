import { resolvePhase, daysToRace } from './phases.js';
import { buildWeeklyPlan, targetWeeklyKm } from './weeklyBuilder.js';
import type {
  AdaptationAuditEntry,
  EngineSession,
  PaceBands,
  PerformanceSignal,
  SessionScore,
  TrainingPhase,
} from './types.js';

export interface ProgressivePlanMutable {
  targetDate: string;
  trainingDaysPerWeek: number;
  weeklyMileageTargetKm: number;
  volumeBaselineKm: number;
  phase: TrainingPhase;
  daysToRace: number;
  paceBands: PaceBands;
  progressiveStreak: number;
  fatigueStreak: number;
  weekOf: string;
  focus: string;
  sessions: EngineSession[];
  audits: AdaptationAuditEntry[];
}

const MAX_WEEKLY_BUMP = 0.08;
const HARD_CAP_WEEKLY_GROWTH = 0.1;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function audit(
  signal: PerformanceSignal,
  rule: string,
  summary: string,
  sessionId: string | null,
  activityId: string | null,
  mutations: string[],
): AdaptationAuditEntry {
  return {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    signal,
    rule,
    summary,
    sessionId,
    activityId,
    mutations,
  };
}

/**
 * Progressive adapter: nudge load up when on track / too easy;
 * soften next quality or long when too hard / partial; deload on fatigue streak.
 * Only future sessions / next-week volume are mutated.
 */
export function applyProgressiveAdaptation(
  plan: ProgressivePlanMutable,
  score: SessionScore,
  recentSignals: PerformanceSignal[],
): { plan: ProgressivePlanMutable; entry: AdaptationAuditEntry } {
  const mutations: string[] = [];
  const next: ProgressivePlanMutable = {
    ...plan,
    sessions: plan.sessions.map((s) => ({ ...s })),
    audits: [...plan.audits],
  };

  // Mark scored session
  next.sessions = next.sessions.map((s) =>
    s.id === score.sessionId
      ? {
          ...s,
          completed: score.signal !== 'missed',
          status: score.signal === 'missed' ? 'skipped' : 'completed',
          linkedActivityId: score.activityId,
          lastSignal: score.signal,
          lastScoreSummary: score.summary,
          lastActualPaceSecPerKm: score.actualPaceSecPerKm,
        }
      : s,
  );

  const session = next.sessions.find((s) => s.id === score.sessionId) ?? null;
  let progressiveStreak = next.progressiveStreak;
  let fatigueStreak = next.fatigueStreak;

  const signals = [...recentSignals, score.signal];
  const fatigueNow =
    signals.slice(-3).filter((s) => s === 'too_hard' || s === 'partial' || s === 'fatigue')
      .length >= 2;

  if (fatigueNow) {
    fatigueStreak += 1;
    progressiveStreak = 0;
  } else if (score.signal === 'on_track' || score.signal === 'too_easy') {
    progressiveStreak += 1;
    fatigueStreak = 0;
  } else if (score.signal === 'too_hard' || score.signal === 'partial') {
    progressiveStreak = 0;
    fatigueStreak += 1;
  } else if (score.signal === 'missed') {
    progressiveStreak = 0;
  }

  next.progressiveStreak = progressiveStreak;
  next.fatigueStreak = fatigueStreak;

  // Refresh phase from calendar
  next.daysToRace = daysToRace(next.targetDate);
  next.phase = resolvePhase(next.daysToRace);

  let rule = 'record_only';
  let summary = score.summary;

  if (fatigueStreak >= 2) {
    rule = 'deload_week';
    const before = next.weeklyMileageTargetKm;
    const deloadKm = round1(Math.max(next.volumeBaselineKm * 0.7, before * 0.78));
    next.weeklyMileageTargetKm = deloadKm;
    next.volumeBaselineKm = round1(Math.min(next.volumeBaselineKm, deloadKm / 0.9));
    rebuildWeek(next);
    softenUpcomingQuality(next, 0.85, mutations);
    mutations.push(`Deload weekly volume ${before} → ${deloadKm} km`);
    next.fatigueStreak = 0;
    summary = 'Fatigue pattern → deload week, then resume progression from new base';
  } else if (score.signal === 'on_track' || score.signal === 'too_easy') {
    if (progressiveStreak >= 1 && (session?.type === 'quality' || session?.type === 'long' || score.signal === 'too_easy')) {
      rule = 'progressive_volume_bump';
      const before = next.weeklyMileageTargetKm;
      const bump = Math.min(MAX_WEEKLY_BUMP, HARD_CAP_WEEKLY_GROWTH);
      const phaseTarget = targetWeeklyKm(next.volumeBaselineKm, next.phase);
      const bumped = round1(Math.min(before * (1 + bump), phaseTarget * 1.12, before * (1 + HARD_CAP_WEEKLY_GROWTH)));
      if (bumped > before) {
        next.weeklyMileageTargetKm = bumped;
        next.volumeBaselineKm = round1(Math.max(next.volumeBaselineKm, bumped / phaseVolumeSafe(next.phase)));
        rebuildWeek(next, /*preserveCompleted*/ true);
        mutations.push(`Progressive volume ${before} → ${bumped} km (+${Math.round(bump * 100)}%)`);
        summary = `${score.summary} → next week volume nudged up`;
      } else {
        rule = 'progressive_hold';
        mutations.push('Already at progressive cap for this phase');
      }
    } else {
      rule = 'bank_on_track';
      mutations.push('Logged on-track execution; waiting for quality/long confirmation to bump');
    }
  } else if (score.signal === 'too_hard') {
    rule = 'soften_next_quality';
    softenUpcomingQuality(next, 0.85, mutations);
    summary = `${score.summary} → next quality shortened`;
  } else if (score.signal === 'partial') {
    rule = 'reduce_next_like_session';
    reduceNextLikeSession(next, session?.type ?? 'quality', 0.9, mutations);
    summary = `${score.summary} → similar upcoming session reduced`;
  } else if (score.signal === 'missed') {
    rule = 'shrink_next_long_or_quality';
    if (session?.type === 'long') {
      reduceNextLikeSession(next, 'long', 0.85, mutations);
    } else {
      softenUpcomingQuality(next, 0.9, mutations);
    }
    summary = `${score.summary} → future load eased once`;
  }

  const entry = audit(score.signal, rule, summary, score.sessionId, score.activityId, mutations);
  next.audits = [entry, ...next.audits].slice(0, 50);
  next.focus = `${next.focus.split('·')[0]?.trim() ?? next.phase} · ${next.trainingDaysPerWeek} days · ${next.weeklyMileageTargetKm} km`;

  return { plan: next, entry };
}

function phaseVolumeSafe(phase: TrainingPhase): number {
  switch (phase) {
    case 'base':
      return 0.9;
    case 'build':
      return 1;
    case 'peak':
      return 0.95;
    case 'taper':
      return 0.65;
  }
}

function rebuildWeek(plan: ProgressivePlanMutable, preserveCompleted = false) {
  // Soft floors from current week sessions so mid-week rebuilds don't collapse distances
  const longs = plan.sessions.filter((s) => s.type === 'long' && s.distanceKm != null);
  const easies = plan.sessions.filter(
    (s) => (s.type === 'easy' || s.type === 'quality') && s.distanceKm != null,
  );
  const minLongKm = longs[0]?.distanceKm ?? 0;
  const minEasyKm =
    easies.length > 0
      ? Math.min(...easies.map((s) => s.distanceKm as number))
      : 0;

  const built = buildWeeklyPlan({
    weekOf: plan.weekOf,
    weeklyKm: plan.weeklyMileageTargetKm,
    trainingDays: plan.trainingDaysPerWeek,
    phase: plan.phase,
    paces: plan.paceBands,
    minLongKm,
    minEasyKm,
  });

  if (!preserveCompleted) {
    plan.sessions = built.sessions;
    plan.focus = built.focus;
    return;
  }

  // Keep completed session outcomes; replace future incomplete prescriptions.
  const byDate = new Map(plan.sessions.map((s) => [s.date, s]));
  plan.sessions = built.sessions.map((fresh) => {
    const prev = byDate.get(fresh.date);
    if (prev && (prev.completed || prev.linkedActivityId)) {
      return {
        ...fresh,
        completed: prev.completed,
        status: prev.status ?? (prev.completed ? 'completed' : 'scheduled'),
        linkedActivityId: prev.linkedActivityId,
        lastSignal: prev.lastSignal,
        lastScoreSummary: prev.lastScoreSummary,
        lastActualPaceSecPerKm: prev.lastActualPaceSecPerKm ?? null,
        extras: prev.extras ?? [],
        // keep original prescribed distance if already done
        distanceKm: prev.distanceKm,
        durationSec: prev.durationSec,
        title: prev.title,
        purpose: prev.purpose,
        prescription: prev.prescription,
        expectation: prev.expectation,
        type: prev.type,
      };
    }
    return {
      ...fresh,
      extras: prev?.extras ?? [],
    };
  });
  plan.focus = built.focus;
}

function softenUpcomingQuality(
  plan: ProgressivePlanMutable,
  factor: number,
  mutations: string[],
) {
  const next = plan.sessions.find((s) => !s.completed && s.type === 'quality' && s.distanceKm != null);
  if (!next || next.distanceKm == null) {
    mutations.push('No upcoming quality session to soften');
    return;
  }
  const before = next.distanceKm;
  const after = round1(Math.max(3, before * factor));
  next.distanceKm = after;
  next.title = `Quality ${after} km`;
  next.prescription = {
    ...next.prescription,
    workDistanceKm: round1(
      Math.max(1, (next.prescription.workDistanceKm ?? after) * factor),
    ),
    notes: `${next.prescription.notes} (softened after hard session)`,
  };
  mutations.push(`Softened upcoming quality ${before} → ${after} km`);
}

function reduceNextLikeSession(
  plan: ProgressivePlanMutable,
  type: EngineSession['type'],
  factor: number,
  mutations: string[],
) {
  const next = plan.sessions.find((s) => !s.completed && s.type === type && s.distanceKm != null);
  if (!next || next.distanceKm == null) {
    mutations.push(`No upcoming ${type} session to reduce`);
    return;
  }
  const before = next.distanceKm;
  const after = round1(Math.max(type === 'long' ? 5 : 3, before * factor));
  next.distanceKm = after;
  const label = type === 'long' ? 'Long run' : type === 'quality' ? 'Quality' : 'Easy';
  next.title = `${label} ${after} km`;
  mutations.push(`Reduced upcoming ${type} ${before} → ${after} km`);
}
