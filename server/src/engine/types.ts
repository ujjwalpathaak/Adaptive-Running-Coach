export type TrainingPhase = 'base' | 'build' | 'peak' | 'taper';

export type SessionType = 'easy' | 'quality' | 'long' | 'rest';

/** Day outcome on the current week board */
export type SessionDayStatus = 'scheduled' | 'completed' | 'skipped';

export type QualityStructure = 'tempo' | 'intervals' | 'steady';

export type PerformanceSignal =
  | 'on_track'
  | 'too_hard'
  | 'too_easy'
  | 'missed'
  | 'partial'
  | 'fatigue';

export interface PaceBand {
  minSecPerKm: number;
  maxSecPerKm: number;
}

export interface PaceBands {
  goalSecPerKm: number;
  easy: PaceBand;
  long: PaceBand;
  quality: PaceBand;
}

export interface SessionExpectation {
  minDistancePct: number;
  maxDistancePct: number;
  paceBand: PaceBand | null;
  /** Optional soft HR cap (bpm); null = unused in v1 unless provided */
  maxAvgHr: number | null;
  requireComplete: boolean;
}

export interface SessionPrescription {
  structure: QualityStructure | 'continuous' | 'rest';
  warmUpKm: number;
  coolDownKm: number;
  workDistanceKm: number | null;
  reps: number | null;
  paceBand: PaceBand | null;
  notes: string;
}

export interface ExtraRunEntry {
  activityId: string;
  name: string;
  distanceKm: number;
  durationSec: number;
  avgPaceSecPerKm: number | null;
  avgHr: number | null;
  startTime: string;
}

export type FitnessReadiness = 'progress' | 'hold' | 'ease';

export interface PlanFitness {
  assessedAt: string;
  qualifyingRunCount: number;
  recentWeeklyKm: number;
  longestRunKm: number;
  typicalSessionKm: number;
  avgPaceSecPerKm: number | null;
  readiness: FitnessReadiness;
  note: string;
}

export interface SyncCursor {
  activityId: string | null;
  startTime: string | null;
}

export interface EngineSession {
  id: string;
  day: string;
  date: string;
  type: SessionType;
  title: string;
  purpose: string;
  distanceKm: number | null;
  durationSec: number | null;
  completed: boolean;
  /** scheduled | completed | skipped (past incomplete workouts) */
  status: SessionDayStatus;
  prescription: SessionPrescription;
  expectation: SessionExpectation;
  linkedActivityId: string | null;
  lastSignal: PerformanceSignal | null;
  lastScoreSummary: string | null;
  /** Unplanned Garmin runs synced onto this calendar day */
  extras: ExtraRunEntry[];
}

export interface AdaptationAuditEntry {
  id: string;
  at: string;
  signal: PerformanceSignal;
  rule: string;
  summary: string;
  sessionId: string | null;
  activityId: string | null;
  mutations: string[];
}

export interface EnginePlanState {
  phase: TrainingPhase;
  daysToRace: number;
  paceBands: PaceBands;
  volumeBaselineKm: number;
  progressiveStreak: number;
  fatigueStreak: number;
  audits: AdaptationAuditEntry[];
}

export interface RunActual {
  activityId: string;
  startTime: string;
  distanceKm: number;
  durationSec: number;
  avgPaceSecPerKm: number | null;
  avgHr: number | null;
  /** Late-split fade: ratio of last-third pace / first-third pace (>1 = slowed) */
  lateFadeRatio: number | null;
}

export interface SessionScore {
  sessionId: string;
  activityId: string;
  signal: PerformanceSignal;
  summary: string;
  distancePct: number;
  paceDeltaSec: number | null;
  details: string[];
}
