import type {
  AdaptationAuditEntry,
  EngineSession,
  ExtraRunEntry,
  PaceBands,
  PerformanceSignal,
  PlanFitness,
  ProgressionFocus,
  SyncCursor,
  TrainingPhase,
} from './engine/types.js';

export type {
  AdaptationAuditEntry,
  EngineSession,
  ExtraRunEntry,
  PaceBands,
  PerformanceSignal,
  PlanFitness,
  ProgressionFocus,
  SyncCursor,
  TrainingPhase,
};

export interface Athlete {
  id: string;
  name: string;
}

export interface Activity {
  id: string;
  name: string;
  sport: 'running';
  distanceKm: number;
  durationSec: number;
  avgPaceSecPerKm: number;
  avgHr: number;
  startTime: string;
}

/** @deprecated Prefer EngineSession; kept for transition */
export type SessionType = 'easy' | 'quality' | 'long' | 'rest';
export type PlanSession = EngineSession;

export interface TrainingPlan {
  id: string;
  status: 'active';
  createdAt: string;
  title: string;
  raceDistanceKm: number;
  raceGoalTimeSec: number;
  targetDate: string;
  trainingDaysPerWeek: number;
  weeklyMileageTargetKm: number;
  currentWeeklyMileageKm: number;
  focus: string;
  weekOf: string;
  sessions: EngineSession[];
  phase: TrainingPhase;
  daysToRace: number;
  paceBands: PaceBands;
  volumeBaselineKm: number;
  progressiveStreak: number;
  fatigueStreak: number;
  audits: AdaptationAuditEntry[];
  adaptationStyle: 'progressive';
  goalModel: 'race_pace';
  syncCursor: SyncCursor;
  fitness: PlanFitness;
  /** Pace from last-3 calibration at plan start (sec/km) — path origin */
  startingPaceSecPerKm: number | null;
  /** Days-to-race when the plan was created — path length */
  startingDaysToRace: number;
  /** Weeks rolled since plan creation (0 = creation week) */
  weeksSinceStart: number;
  /** Most recently applied pace blend toward goal (0..1) */
  lastPaceBlend: number;
  /** Which single variable this week's progression moved (one-at-a-time rhythm) */
  progressionFocus: ProgressionFocus;
}

export interface CreatePlanInput {
  title: string;
  raceDistanceKm: number;
  raceGoalTimeSec: number;
  targetDate: string;
  trainingDaysPerWeek: number;
}

export interface EvaluateRunInput {
  activityId: string;
  startTime: string;
  distanceKm: number;
  durationSec: number;
  avgPaceSecPerKm?: number | null;
  avgHr?: number | null;
  lateFadeRatio?: number | null;
}
