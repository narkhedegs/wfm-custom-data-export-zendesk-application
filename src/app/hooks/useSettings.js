import { useState, useEffect } from 'react'
import { useClient } from './useClient'
import { DEFAULT_MAX_RANGE_DAYS, DEFAULT_TIMEZONE } from '../../lib/buildSchedule'

/**
 * Read the app's installation settings (manifest `parameters`) via
 * `client.metadata()`, normalized to typed values with sensible defaults:
 *
 *  - showDebugButton {boolean}  gates the temporary Debug probe button.
 *  - maxRangeDays    {number}   max selectable date-range length, in days.
 *  - timeZone        {string}   IANA zone the schedule is rendered/bucketed in.
 *
 * While metadata is loading (or if it fails), returns the defaults so the app
 * stays usable.
 */
export function useSettings() {
  const client = useClient()
  const [settings, setSettings] = useState({
    showDebugButton: false,
    maxRangeDays: DEFAULT_MAX_RANGE_DAYS,
    timeZone: DEFAULT_TIMEZONE
  })

  useEffect(() => {
    let cancelled = false
    client
      .metadata()
      .then((meta) => {
        if (cancelled) return
        const s = meta?.settings || {}
        setSettings({
          showDebugButton: parseBool(s.show_debug_button),
          maxRangeDays: parsePositiveInt(s.max_range_days, DEFAULT_MAX_RANGE_DAYS),
          timeZone: parseTimeZone(s.export_timezone, DEFAULT_TIMEZONE)
        })
      })
      .catch(() => {
        // Keep defaults on failure.
      })
    return () => {
      cancelled = true
    }
  }, [client])

  return settings
}

// Checkbox parameters arrive as booleans, but be tolerant of string forms too.
function parseBool(value) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === 'true' || value === '1'
  return false
}

// Coerce to a positive integer; fall back to `fallback` for empty/invalid input.
function parsePositiveInt(value, fallback) {
  const n = parseInt(value, 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

// Accept a valid IANA timezone string; fall back to `fallback` otherwise. An
// unrecognized zone makes Intl.DateTimeFormat throw, so validate up front.
function parseTimeZone(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback
  const zone = value.trim()
  try {
    // Throws a RangeError for an invalid time zone identifier.
    Intl.DateTimeFormat('en-US', { timeZone: zone }).format()
    return zone
  } catch {
    return fallback
  }
}
