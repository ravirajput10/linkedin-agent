export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  const deltaSeconds = (date.getTime() - Date.now()) / 1000
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ]
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  for (const [unit, seconds] of units) {
    if (Math.abs(deltaSeconds) >= seconds || unit === 'second') {
      return formatter.format(Math.round(deltaSeconds / seconds), unit)
    }
  }
  return '—'
}

export function humanize(value: string): string {
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (char) => char.toUpperCase())
}

export function truncate(value: string, max = 220): string {
  if (value.length <= max) return value
  return `${value.slice(0, max).trimEnd()}…`
}

export function toLocalInputValue(iso: string): string {
  const date = new Date(iso)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}
