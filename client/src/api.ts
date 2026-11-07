import type {
  Activity,
  Athlete,
  CreatePlanInput,
  EvaluateResult,
  GarminRunDetail,
  GarminRunsResponse,
  TrainingPlan,
} from './types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  })
  if (!res.ok) {
    let message = `Request failed: ${res.status}`
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // keep default message
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export const api = {
  getAthlete: () => request<Athlete>('/api/athlete'),
  getActivities: () => request<Activity[]>('/api/activities'),
  getCurrentPlan: () => request<{ plan: TrainingPlan | null }>('/api/plan/current'),
  createPlan: (input: CreatePlanInput) =>
    request<TrainingPlan>('/api/plan', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  endPlan: () =>
    request<{ ended: true; plan: TrainingPlan }>('/api/plan/end', {
      method: 'POST',
    }),
  evaluateRun: (body: { activityId: string } | Record<string, unknown>) =>
    request<EvaluateResult>('/api/plan/evaluate', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getGarminRuns: async (opts?: { refresh?: boolean }) => {
    const qs = opts?.refresh ? '?refresh=1' : ''
    const res = await fetch(`/api/garmin/runs${qs}`)
    const body = (await res.json()) as GarminRunsResponse
    if (!res.ok && res.status !== 503) {
      throw new Error(body.error || `Request failed: ${res.status}`)
    }
    return body
  },
  getGarminRunDetail: (id: string, opts?: { refresh?: boolean }) => {
    const qs = opts?.refresh ? '?refresh=1' : ''
    return request<{
      configured: true
      source: string
      cache: 'hit' | 'miss'
      store: 'redis' | 'memory'
      run: GarminRunDetail
    }>(`/api/garmin/runs/${encodeURIComponent(id)}${qs}`)
  },
  clearGarminCache: () =>
    request<{ cleared: true; removed: number; store: 'redis' | 'memory' }>(
      '/api/garmin/cache/clear',
      { method: 'POST' },
    ),
}
