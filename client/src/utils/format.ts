export function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}:${s.toString().padStart(2, '0')}/km`
}

export function formatDuration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function daysUntil(isoDate: string): number {
  const target = new Date(isoDate)
  const now = new Date()
  target.setHours(0, 0, 0, 0)
  now.setHours(0, 0, 0, 0)
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

/** Parse `HH:MM` or `H:MM:SS` into seconds. */
export function parseClockToSeconds(value: string): number {
  const parts = value.split(':').map((p) => Number(p))
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return NaN
  if (parts.length === 2) return parts[0] * 3600 + parts[1] * 60
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return NaN
}

export function formatPaceBand(minSecPerKm: number, maxSecPerKm: number): string {
  return `${formatPace(minSecPerKm).replace('/km', '')}–${formatPace(maxSecPerKm)}`
}

/** Local calendar stamp YYYY-MM-DD for pinning “today” on the week board. */
export function todayStamp(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
