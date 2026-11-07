import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { GarminRunRow } from '../types'
import { formatDate, formatDuration, formatPace } from '../utils/format'
import './Dashboard.css'
import './GarminRuns.css'

function openRunInNewTab(id: string) {
  window.open(`/runs/${id}`, '_blank', 'noopener,noreferrer')
}

export function GarminRuns() {
  const [runs, setRuns] = useState<GarminRunRow[]>([])
  const [configured, setConfigured] = useState(true)
  const [setupUrl, setSetupUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cacheInfo, setCacheInfo] = useState<string | null>(null)

  async function loadRuns(refresh = false) {
    try {
      if (refresh) setRefreshing(true)
      else setLoading(true)
      setError(null)
      const data = await api.getGarminRuns({ refresh })
      setConfigured(data.configured)
      setSetupUrl(data.setupUrl ?? null)
      setRuns(data.runs ?? [])
      if (data.cache && data.store) {
        setCacheInfo(`Cache ${data.cache} · store ${data.store}`)
      } else {
        setCacheInfo(null)
      }
      if (!data.configured) {
        setError(data.error ?? 'Garmin Personal API key is not configured')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Garmin runs')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    void loadRuns(false)
  }, [])

  return (
    <div className="dash">
      <header className="dash__top">
        <div>
          <p className="dash__brand">Adaptive Running Coach</p>
          <p className="dash__greeting">Garmin runs</p>
        </div>
        <nav className="dash__nav">
          <Link to="/">Dashboard</Link>
          <Link to="/runs" aria-current="page">
            Garmin runs
          </Link>
        </nav>
      </header>

      <section className="runs" aria-labelledby="runs-heading">
        <p className="dash__eyebrow">Garmin Connect Personal API</p>
        <h1 id="runs-heading">Your imported runs</h1>
        <p className="dash__section-support">
          Click a run to open its full Garmin detail page in a new tab. List responses are cached
          (Redis when available, otherwise in-memory).
        </p>
        <div className="runs__actions">
          <button
            type="button"
            className="btn btn--primary"
            disabled={loading || refreshing || !configured}
            onClick={() => void loadRuns(true)}
          >
            {refreshing ? 'Refreshing…' : 'Refresh from Garmin'}
          </button>
          {cacheInfo && <span className="runs__cache">{cacheInfo}</span>}
        </div>

        {loading && <p className="dash__loading">Loading Garmin activities…</p>}

        {!loading && !configured && (
          <div className="runs__setup" role="status">
            <p>{error}</p>
            <ol>
              <li>
                Open the{' '}
                <a
                  href={setupUrl ?? 'https://developer.garmin.com/gc-developer-program/overview/'}
                  target="_blank"
                  rel="noreferrer"
                >
                  Garmin Connect Developer Program
                </a>{' '}
                Personal section and create a Personal API key in Garmin Connect Web.
              </li>
              <li>
                Copy the key once into <code>server/.env</code> as{' '}
                <code>GARMIN_PERSONAL_API_KEY=...</code>
              </li>
              <li>Restart the API and refresh this page.</li>
            </ol>
          </div>
        )}

        {!loading && configured && error && (
          <p className="dash__error" role="alert">
            {error}
          </p>
        )}

        {!loading && configured && !error && runs.length === 0 && (
          <p className="dash__section-support">No running activities found in the last 90 days.</p>
        )}

        {!loading && configured && runs.length > 0 && (
          <div className="runs__table-wrap">
            <table className="runs__table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Name</th>
                  <th scope="col">Distance</th>
                  <th scope="col">Time</th>
                  <th scope="col">Pace</th>
                  <th scope="col">Avg HR</th>
                  <th scope="col">Type</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => openRunInNewTab(run.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        openRunInNewTab(run.id)
                      }
                    }}
                    tabIndex={0}
                    role="link"
                  >
                    <td>{formatDate(run.startTime)}</td>
                    <td>{run.name}</td>
                    <td>{run.distanceKm.toFixed(2)} km</td>
                    <td>{formatDuration(run.durationSec)}</td>
                    <td>
                      {run.avgPaceSecPerKm != null ? formatPace(run.avgPaceSecPerKm) : '—'}
                    </td>
                    <td>{run.avgHr != null ? run.avgHr : '—'}</td>
                    <td>{run.activityType}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
