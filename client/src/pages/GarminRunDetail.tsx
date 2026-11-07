import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api'
import type { GarminRunDetail as GarminRunDetailType } from '../types'
import { formatDuration, formatPace } from '../utils/format'
import './Dashboard.css'
import './GarminRuns.css'

function labelize(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

function formatValue(key: string, value: string | number | boolean | null | undefined): string {
  if (value == null || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') {
    if (key.toLowerCase().includes('pacesec')) return formatPace(value)
    if (key.toLowerCase().includes('duration') || key.toLowerCase().endsWith('sec')) {
      return formatDuration(Math.round(value))
    }
    if (Number.isInteger(value)) return String(value)
    return value.toFixed(2)
  }
  return String(value)
}

function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const w = 280
  const h = 56
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - ((v - min) / span) * (h - 4) - 2
      return `${x},${y}`
    })
    .join(' ')

  return (
    <div className="spark">
      <p className="spark__label">
        {label} · {Math.round(min)}–{Math.round(max)}
      </p>
      <svg viewBox={`0 0 ${w} ${h}`} className="spark__svg" aria-hidden="true">
        <polyline fill="none" stroke="currentColor" strokeWidth="2" points={points} />
      </svg>
    </div>
  )
}

function StatGrid({
  title,
  data,
}: {
  title: string
  data: Record<string, string | number | boolean | null>
}) {
  const entries = Object.entries(data).filter(([, v]) => v != null && v !== '')
  if (entries.length === 0) return null
  return (
    <section className="detail__section">
      <h3>{title}</h3>
      <dl className="detail__grid">
        {entries.map(([key, value]) => (
          <div key={key}>
            <dt>{labelize(key)}</dt>
            <dd>{formatValue(key, value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function GarminRunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [detail, setDetail] = useState<GarminRunDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cacheInfo, setCacheInfo] = useState<string | null>(null)

  async function load(refresh = false) {
    if (!id) return
    try {
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setError(null)
      const data = await api.getGarminRunDetail(id, { refresh })
      setDetail(data.run)
      setCacheInfo(`Cache ${data.cache} · store ${data.store}`)
    } catch (err) {
      setDetail(null)
      setError(err instanceof Error ? err.message : 'Failed to load run detail')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void load(false)
  }, [id])

  return (
    <div className="dash">
      <header className="dash__top">
        <div>
          <p className="dash__brand">Adaptive Running Coach</p>
          <p className="dash__greeting">Run detail</p>
        </div>
        <nav className="dash__nav">
          <Link to="/">Dashboard</Link>
          <Link to="/runs">Garmin runs</Link>
        </nav>
      </header>

      <section className="runs detail-page" aria-labelledby="run-detail-heading">
        <p className="dash__eyebrow">
          <Link to="/runs" className="detail-page__back">
            ← Back to runs
          </Link>
        </p>

        {loading && <p className="dash__loading">Loading run detail…</p>}
        {error && (
          <p className="dash__error" role="alert">
            {error}
          </p>
        )}

        {detail && !loading && (
          <>
            <h1 id="run-detail-heading">{detail.name}</h1>
            <p className="dash__section-support">
              {[detail.locationName, detail.startTimeLocal, detail.activityType]
                .filter(Boolean)
                .join(' · ')}
            </p>
            <div className="runs__actions">
              <button
                type="button"
                className="btn btn--primary"
                disabled={refreshing}
                onClick={() => void load(true)}
              >
                {refreshing ? 'Refreshing…' : 'Refresh from Garmin'}
              </button>
              {cacheInfo && <span className="runs__cache">{cacheInfo}</span>}
            </div>

            <div className="detail-page__body">
              <section className="detail__section detail__section--first">
                <h3>Splits / laps</h3>
                <p className="dash__section-support">
                  {detail.lapsSource === 'fit' &&
                    `Official laps from the Garmin FIT file (${detail.laps.length}).`}
                  {detail.lapsSource === 'metrics' &&
                    `Derived 1 km splits from Garmin metrics (${detail.laps.length}) — FIT laps unavailable.`}
                  {detail.lapsSource === 'none' && 'No lap or km-split data available for this run.'}
                </p>
                {detail.laps.length > 0 && (
                  <div className="runs__table-wrap">
                    <table className="runs__table runs__table--compact">
                      <thead>
                        <tr>
                          <th scope="col">#</th>
                          <th scope="col">Distance</th>
                          <th scope="col">Time</th>
                          <th scope="col">Pace</th>
                          <th scope="col">Avg HR</th>
                          <th scope="col">Max HR</th>
                          <th scope="col">Cadence</th>
                          <th scope="col">Elev+</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.laps.map((lap) => (
                          <tr key={lap.index}>
                            <td>{lap.index}</td>
                            <td>{lap.distanceKm.toFixed(2)} km</td>
                            <td>{formatDuration(lap.durationSec)}</td>
                            <td>
                              {lap.avgPaceSecPerKm != null
                                ? formatPace(lap.avgPaceSecPerKm)
                                : '—'}
                            </td>
                            <td>{lap.avgHr ?? '—'}</td>
                            <td>{lap.maxHr ?? '—'}</td>
                            <td>{lap.avgCadence ?? '—'}</td>
                            <td>
                              {lap.elevationGainM != null ? `${lap.elevationGainM} m` : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <StatGrid title="Overview" data={detail.overview} />
              <StatGrid title="Performance" data={detail.performance} />
              <StatGrid title="Heart rate" data={detail.heartRate} />
              <StatGrid title="Elevation" data={detail.elevation} />
              <StatGrid title="Training effect" data={detail.training} />

              {(detail.splitSummaries?.length ?? 0) > 0 && (
                <section className="detail__section">
                  <h3>Run / walk summaries</h3>
                  <ul className="detail__list">
                    {detail.splitSummaries.map((split, index) => (
                      <li key={`${split.splitType}-${index}`}>
                        <strong>{String(split.splitType)}</strong>
                        <span>
                          {split.count != null ? `${split.count}×` : ''}{' '}
                          {split.distanceKm != null ? `${split.distanceKm} km` : ''}{' '}
                          {split.durationSec != null
                            ? `· ${formatDuration(Number(split.durationSec))}`
                            : ''}{' '}
                          {split.avgPaceSecPerKm != null
                            ? `· ${formatPace(Number(split.avgPaceSecPerKm))}`
                            : ''}{' '}
                          {split.avgHr != null ? `· avg HR ${split.avgHr}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {detail.workout && (
                <section className="detail__section">
                  <h3>Workout</h3>
                  <p className="dash__section-support">
                    {[detail.workout.name, detail.workout.phrase, detail.workout.sport]
                      .filter(Boolean)
                      .join(' · ') || 'Structured workout'}
                  </p>
                  {detail.workout.steps.length > 0 && (
                    <ol className="detail__list">
                      {detail.workout.steps.map((step, index) => (
                        <li key={index}>
                          {[step.type, step.intensity, step.durationType, step.durationValue]
                            .filter((v) => v != null && v !== '')
                            .join(' · ')}
                        </li>
                      ))}
                    </ol>
                  )}
                </section>
              )}

              <section className="detail__section">
                <h3>Metric series</h3>
                <p className="dash__section-support">
                  {detail.series.sampleCount} samples
                  {detail.series.descriptors.length
                    ? ` · ${detail.series.descriptors
                        .map((d) => d.key)
                        .slice(0, 6)
                        .join(', ')}`
                    : ''}
                </p>
                <Sparkline values={detail.series.heartRate} label="Heart rate" />
                <Sparkline values={detail.series.speedMps} label="Speed (m/s)" />
                <Sparkline values={detail.series.cadence} label="Cadence" />
              </section>

              <StatGrid title="Metadata" data={detail.metadata} />

              <section className="detail__section">
                <h3>Endpoint availability</h3>
                <ul className="detail__list detail__list--compact">
                  {Object.entries(detail.availableEndpoints).map(([name, status]) => (
                    <li key={name}>
                      <strong>{name}</strong> · {status}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
