export interface Athlete {
  id: string
  name: string
}

export interface Activity {
  id: string
  name: string
  sport: 'running'
  distanceKm: number
  durationSec: number
  avgPaceSecPerKm: number
  avgHr: number
  startTime: string
}

export type SessionType = 'easy' | 'quality' | 'long' | 'rest'
export type SessionDayStatus = 'scheduled' | 'completed' | 'skipped'
export type TrainingPhase = 'base' | 'build' | 'peak' | 'taper'
export type PerformanceSignal =
  | 'on_track'
  | 'too_hard'
  | 'too_easy'
  | 'missed'
  | 'partial'
  | 'fatigue'

export interface PaceBand {
  minSecPerKm: number
  maxSecPerKm: number
}

export interface PaceBands {
  goalSecPerKm: number
  easy: PaceBand
  long: PaceBand
  quality: PaceBand
}

export interface SessionPrescription {
  structure: string
  warmUpKm: number
  coolDownKm: number
  workDistanceKm: number | null
  reps: number | null
  paceBand: PaceBand | null
  notes: string
}

export interface SessionExpectation {
  minDistancePct: number
  maxDistancePct: number
  paceBand: PaceBand | null
  maxAvgHr: number | null
  requireComplete: boolean
}

export interface ExtraRunEntry {
  activityId: string
  name: string
  distanceKm: number
  durationSec: number
  avgPaceSecPerKm: number | null
  avgHr: number | null
  startTime: string
}

export type FitnessReadiness = 'progress' | 'hold' | 'ease'

export interface PlanFitness {
  assessedAt: string
  qualifyingRunCount: number
  recentWeeklyKm: number
  longestRunKm: number
  typicalSessionKm: number
  avgPaceSecPerKm: number | null
  readiness: FitnessReadiness
  note: string
}

export interface SyncCursor {
  activityId: string | null
  startTime: string | null
}

export interface PlanSession {
  id: string
  day: string
  date?: string
  type: SessionType
  title: string
  purpose: string
  distanceKm: number | null
  durationSec: number | null
  completed: boolean
  status?: SessionDayStatus
  prescription?: SessionPrescription
  expectation?: SessionExpectation
  linkedActivityId?: string | null
  lastSignal?: PerformanceSignal | null
  lastScoreSummary?: string | null
  extras?: ExtraRunEntry[]
}

export interface AdaptationAuditEntry {
  id: string
  at: string
  signal: PerformanceSignal
  rule: string
  summary: string
  sessionId: string | null
  activityId: string | null
  mutations: string[]
}

export interface TrainingPlan {
  id: string
  status: 'active'
  createdAt: string
  title: string
  raceDistanceKm: number
  raceGoalTimeSec: number
  targetDate: string
  trainingDaysPerWeek: number
  weeklyMileageTargetKm: number
  currentWeeklyMileageKm: number
  focus: string
  weekOf: string
  sessions: PlanSession[]
  phase: TrainingPhase
  daysToRace: number
  paceBands: PaceBands
  volumeBaselineKm: number
  progressiveStreak: number
  fatigueStreak: number
  audits: AdaptationAuditEntry[]
  adaptationStyle: 'progressive'
  goalModel: 'race_pace'
  syncCursor: SyncCursor
  fitness: PlanFitness
  startingPaceSecPerKm?: number | null
  startingDaysToRace?: number
}

export interface CreatePlanInput {
  title: string
  raceDistanceKm: number
  raceGoalTimeSec: number
  targetDate: string
  trainingDaysPerWeek: number
}

export interface SessionScore {
  sessionId: string
  activityId: string
  signal: PerformanceSignal
  summary: string
  distancePct: number
  paceDeltaSec: number | null
  details: string[]
}

export interface EvaluateResult {
  plan: TrainingPlan
  score: SessionScore
  matchedSessionId: string
  fatigueDetected: boolean
}

export interface GarminRunRow {
  id: string
  name: string
  startTime: string
  distanceKm: number
  durationSec: number
  avgPaceSecPerKm: number | null
  avgHr: number | null
  activityType: string
}

export interface GarminRunsResponse {
  configured: boolean
  source?: string
  cache?: 'hit' | 'miss'
  store?: 'redis' | 'memory'
  runs?: GarminRunRow[]
  error?: string
  setupUrl?: string
}

export interface GarminLap {
  index: number
  distanceKm: number
  durationSec: number
  movingDurationSec: number | null
  avgPaceSecPerKm: number | null
  avgHr: number | null
  maxHr: number | null
  avgCadence: number | null
  elevationGainM: number | null
  elevationLossM: number | null
  calories: number | null
  startTime: string | null
  intensity: string | null
  trigger: string | null
}

export interface GarminKmSplit {
  index: number
  label: string
  distanceKm: number
  durationSec: number
  avgPaceSecPerKm: number | null
  avgHr: number | null
  avgCadence: number | null
}

export interface GarminRunDetail {
  id: string
  name: string
  activityType: string
  eventType: string | null
  locationName: string | null
  startTimeLocal: string | null
  startTimeGmt: string | null
  overview: Record<string, string | number | boolean | null>
  performance: Record<string, string | number | null>
  heartRate: Record<string, string | number | null>
  elevation: Record<string, string | number | null>
  training: Record<string, string | number | null>
  laps: GarminLap[]
  lapsSource: 'fit' | 'metrics' | 'none'
  kmSplits: GarminKmSplit[]
  splitSummaries: Array<Record<string, string | number | null>>
  workout: {
    name: string | null
    phrase: string | null
    sport: string | null
    steps: Array<Record<string, string | number | boolean | null>>
  } | null
  metadata: Record<string, string | number | boolean | null>
  series: {
    descriptors: Array<{ key: string; unit: string | null }>
    sampleCount: number
    heartRate: number[]
    speedMps: number[]
    cadence: number[]
  }
  availableEndpoints: Record<string, 'ok' | 'missing' | 'error'>
}
