import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { Athlete, TrainingPlan } from '../types'
import {
  daysUntil,
  formatDate,
  formatDuration,
  formatPace,
  formatPaceBand,
  parseClockToSeconds,
  todayStamp,
} from '../utils/format'
import './Dashboard.css'

const emptySetup = {
  title: '',
  raceDistanceKm: '21.1',
  raceGoalTime: '01:45',
  targetDate: '',
  trainingDaysPerWeek: 3,
}

const MIN_TRAINING_DAYS = 2
const MAX_TRAINING_DAYS = 7
const MIN_RACE_DISTANCE_KM = 1
const MIN_LEAD_DAYS_TO_RACE = 7

function minRaceDateStr(): string {
  const d = new Date()
  d.setDate(d.getDate() + MIN_LEAD_DAYS_TO_RACE)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function Dashboard() {
  const [athlete, setAthlete] = useState<Athlete | null>(null)
  const [plan, setPlan] = useState<TrainingPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [ending, setEnding] = useState(false)
  const [setup, setSetup] = useState(emptySetup)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        setLoading(true)
        setError(null)
        const [athleteData, planData] = await Promise.all([
          api.getAthlete(),
          api.getCurrentPlan(),
        ])
        if (cancelled) return
        setAthlete(athleteData)
        setPlan(planData.plan)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleCreatePlan(e: FormEvent) {
    e.preventDefault()
    try {
      setSaving(true)
      setError(null)
      const raceGoalTimeSec = parseClockToSeconds(setup.raceGoalTime)
      if (!Number.isFinite(raceGoalTimeSec) || raceGoalTimeSec <= 0) {
        throw new Error('Enter a valid race goal time as HH:MM')
      }

      const trainingDays = Math.min(
        MAX_TRAINING_DAYS,
        Math.max(MIN_TRAINING_DAYS, Number(setup.trainingDaysPerWeek) || MIN_TRAINING_DAYS),
      )
      const created = await api.createPlan({
        title: setup.title.trim(),
        raceDistanceKm: Number(setup.raceDistanceKm),
        raceGoalTimeSec,
        targetDate: setup.targetDate,
        trainingDaysPerWeek: trainingDays,
      })
      setPlan(created)
      setSetup(emptySetup)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create plan'
      if (message.toLowerCase().includes('active plan already exists')) {
        try {
          const { plan: existing } = await api.getCurrentPlan()
          if (existing) {
            setPlan(existing)
            setSetup(emptySetup)
            setError(null)
            return
          }
        } catch {
          // fall through
        }
      }
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  async function handleEndPlan() {
    if (!plan) return
    const confirmed = window.confirm(
      'End this plan? You will need to set up a new plan from scratch. The current plan cannot be edited—only ended.',
    )
    if (!confirmed) return

    try {
      setEnding(true)
      setError(null)
      await api.endPlan()
      setPlan(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to end plan')
    } finally {
      setEnding(false)
    }
  }

  const mileageProgress =
    plan && plan.weeklyMileageTargetKm > 0
      ? Math.min(100, (plan.currentWeeklyMileageKm / plan.weeklyMileageTargetKm) * 100)
      : 0

  return (
    <div className="dash">
      <header className="dash__top">
        <div>
          <p className="dash__brand">Adaptive Running Coach</p>
          <p className="dash__greeting">
            {athlete ? `Welcome back, ${athlete.name}` : 'Loading your coaching view…'}
          </p>
        </div>
        <nav className="dash__nav">
          <Link to="/" aria-current="page">
            Dashboard
          </Link>
          <Link to="/runs">Garmin runs</Link>
        </nav>
      </header>

      {error && (
        <p className="dash__error" role="alert">
          {error}
        </p>
      )}
      {loading && <p className="dash__loading">Syncing coaching data…</p>}

      {!loading && !plan && (
        <section className="dash__setup" aria-labelledby="setup-heading">
          <p className="dash__eyebrow">No active plan</p>
          <h1 id="setup-heading">Set up your training plan</h1>
          <p className="dash__section-support">
            Uses your last 3 runs (30+ min) to calibrate current fitness, then builds a week on the
            path toward your race goal. After start, the plan is locked; new runs sync when you open
            the dashboard; weeks advance toward the goal on Mondays.
          </p>

          <div className="setup-requirements" aria-label="Minimum requirements to start a plan">
            <p className="setup-requirements__title">Minimum requirements</p>
            <ul>
              <li>
                At least <strong>{MIN_TRAINING_DAYS}</strong> training days per week (up to{' '}
                {MAX_TRAINING_DAYS})
              </li>
              <li>
                At least <strong>3 Garmin runs of 30+ minutes</strong> on record, so we can read your
                current fitness
              </li>
              <li>Race date at least {MIN_LEAD_DAYS_TO_RACE} days from today</li>
              <li>Race distance at least {MIN_RACE_DISTANCE_KM} km</li>
              <li>
                Goal time must be realistic from your last 3 runs — overly ambitious goals are
                rejected with guidance
              </li>
            </ul>
          </div>

          <form className="setup-form" onSubmit={handleCreatePlan}>
            <label>
              Race / goal title
              <input
                type="text"
                value={setup.title}
                onChange={(e) => setSetup((s) => ({ ...s, title: e.target.value }))}
                placeholder="City Half Marathon"
                required
              />
            </label>
            <div className="setup-form__row">
              <label>
                Race distance (km)
                <input
                  type="number"
                  min={MIN_RACE_DISTANCE_KM}
                  step={0.1}
                  value={setup.raceDistanceKm}
                  onChange={(e) => setSetup((s) => ({ ...s, raceDistanceKm: e.target.value }))}
                  required
                />
              </label>
              <label>
                Race goal time (HH:MM)
                <input
                  type="time"
                  value={setup.raceGoalTime}
                  onChange={(e) => setSetup((s) => ({ ...s, raceGoalTime: e.target.value }))}
                  required
                />
              </label>
            </div>
            <label>
              Target race date
              <input
                type="date"
                min={minRaceDateStr()}
                value={setup.targetDate}
                onChange={(e) => setSetup((s) => ({ ...s, targetDate: e.target.value }))}
                required
              />
            </label>
            <label>
              Training days per week
              <input
                type="number"
                min={MIN_TRAINING_DAYS}
                max={MAX_TRAINING_DAYS}
                step={1}
                value={setup.trainingDaysPerWeek}
                onChange={(e) =>
                  setSetup((s) => ({
                    ...s,
                    trainingDaysPerWeek: Number(e.target.value) || MIN_TRAINING_DAYS,
                  }))
                }
                required
              />
            </label>
            <button className="btn btn--primary" type="submit" disabled={saving}>
              {saving ? 'Assessing fitness…' : 'Start plan'}
            </button>
          </form>
        </section>
      )}

      {!loading && plan && (
        <>
          <section className="dash__goal" aria-labelledby="goal-heading">
            <div className="dash__goal-main">
              <p className="dash__eyebrow">
                Active · {plan.phase} · {plan.fitness.readiness}
                {plan.progressionFocus
                  ? ` · week ${plan.weeksSinceStart ?? 0} focus: ${plan.progressionFocus}`
                  : ''}
              </p>
              <h1 id="goal-heading">{plan.title}</h1>
              <p className="dash__goal-meta">
                {plan.raceDistanceKm} km · goal {formatDuration(plan.raceGoalTimeSec)} ·{' '}
                {daysUntil(plan.targetDate)} days out · race day {formatDate(plan.targetDate)}
              </p>
              <p className="dash__goal-meta">
                {plan.trainingDaysPerWeek} training days · {plan.weeklyMileageTargetKm} km planned /
                week · race goal pace {formatPace(plan.paceBands.goalSecPerKm)} (target — not today’s
                training)
              </p>
              <p className="dash__fitness">
                Assessed from {plan.fitness.qualifyingRunCount} runs · longest{' '}
                {plan.fitness.longestRunKm} km · typical ~{plan.fitness.typicalSessionKm ?? '—'} km
                · ~{plan.fitness.recentWeeklyKm} km/week · readiness {plan.fitness.readiness}
                {plan.fitness.avgPaceSecPerKm != null
                  ? ` · recent pace ${formatPace(plan.fitness.avgPaceSecPerKm)}`
                  : ''}
                . {plan.fitness.note}
              </p>
              <div className="pace-bands" aria-label="Training pace bands from recent runs">
                <div>
                  <span>Easy (now)</span>
                  <strong>
                    {formatPaceBand(plan.paceBands.easy.minSecPerKm, plan.paceBands.easy.maxSecPerKm)}
                  </strong>
                </div>
                <div>
                  <span>Long (now)</span>
                  <strong>
                    {formatPaceBand(plan.paceBands.long.minSecPerKm, plan.paceBands.long.maxSecPerKm)}
                  </strong>
                </div>
                <div>
                  <span>Quality (now)</span>
                  <strong>
                    {formatPaceBand(
                      plan.paceBands.quality.minSecPerKm,
                      plan.paceBands.quality.maxSecPerKm,
                    )}
                  </strong>
                </div>
              </div>
              <div className="progress" aria-label="Weekly mileage progress">
                <div className="progress__track">
                  <div
                    className="progress__fill"
                    style={{ ['--progress' as string]: `${mileageProgress}%` }}
                  />
                </div>
                <p className="progress__label">
                  {plan.currentWeeklyMileageKm.toFixed(1)} / {plan.weeklyMileageTargetKm} km this
                  week
                </p>
              </div>
              <p className="dash__locked-note">
                Plan inputs are locked. New Garmin runs sync when you open this page. Weeks roll on
                Monday from last week’s performance.
              </p>
            </div>

            <button
              className="btn btn--danger"
              type="button"
              onClick={() => void handleEndPlan()}
              disabled={ending}
            >
              {ending ? 'Ending…' : 'End plan'}
            </button>
          </section>

          <section className="dash__section" aria-labelledby="plan-heading">
            <h2 id="plan-heading">This week’s plan</h2>
            <p className="dash__section-support">{plan.focus}</p>
            <ol className="plan-list">
              {plan.sessions.map((session, index) => {
                const isToday = session.date === todayStamp()
                const status = session.status ?? (session.completed ? 'completed' : 'scheduled')
                return (
                  <li
                    key={session.id}
                    className={[
                      'plan-row',
                      `plan-row--${session.type}`,
                      status === 'completed' ? 'is-done' : '',
                      status === 'skipped' ? 'is-skipped' : '',
                      isToday ? 'is-today' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ animationDelay: `${0.05 * index}s` }}
                  >
                    <span className="plan-row__day">{session.day}</span>
                    <div className="plan-row__body">
                      <p className="plan-row__title">
                        {session.title}
                        {isToday && <span className="plan-row__pin">Today</span>}
                        {status === 'completed' && (
                          <span className="plan-row__badge">Completed</span>
                        )}
                        {status === 'skipped' && (
                          <span className="plan-row__badge plan-row__badge--skipped">Skipped</span>
                        )}
                      </p>
                      <p className="plan-row__purpose">{session.purpose}</p>
                      {session.prescription?.notes && (
                        <p className="plan-row__rx">{session.prescription.notes}</p>
                      )}
                      {session.lastScoreSummary && status !== 'scheduled' && (
                        <p className="plan-row__score">{session.lastScoreSummary}</p>
                      )}
                      {(session.extras ?? []).map((extra) => (
                        <p key={extra.activityId} className="plan-row__extra">
                          <span className="plan-row__extra-label">Extra</span> {extra.name} ·{' '}
                          {extra.distanceKm.toFixed(1)} km
                          {extra.avgPaceSecPerKm != null
                            ? ` · ${formatPace(extra.avgPaceSecPerKm)}`
                            : ''}
                          {extra.avgHr != null ? ` · HR ${extra.avgHr}` : ''}
                        </p>
                      ))}
                    </div>
                    <span className="plan-row__load">
                      {session.distanceKm != null ? `${session.distanceKm} km` : '—'}
                      {session.durationSec != null
                        ? ` · ${formatDuration(session.durationSec)}`
                        : ''}
                      {session.prescription?.paceBand
                        ? ` · ${formatPaceBand(
                            session.prescription.paceBand.minSecPerKm,
                            session.prescription.paceBand.maxSecPerKm,
                          )}`
                        : ''}
                    </span>
                  </li>
                )
              })}
            </ol>
          </section>
        </>
      )}
    </div>
  )
}
