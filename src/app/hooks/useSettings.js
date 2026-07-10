import { useState, useEffect } from 'react'
import { useClient } from './useClient'
import { DEFAULT_MAX_RANGE_DAYS } from '../../lib/buildSchedule'

/**
 * Read the app's installation settings (manifest `parameters`) via
 * `client.metadata()`, normalized to typed values with sensible defaults:
 *
 *  - showDebugButton {boolean}  gates the temporary Debug probe button.
 *  - maxRangeDays    {number}   max selectable date-range length, in days.
 *
 * While metadata is loading (or if it fails), returns the defaults so the app
 * stays usable.
 */
export function useSettings() {
  const client = useClient()
  const [settings, setSettings] = useState({
    showDebugButton: false,
    maxRangeDays: DEFAULT_MAX_RANGE_DAYS
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
          maxRangeDays: parsePositiveInt(s.max_range_days, DEFAULT_MAX_RANGE_DAYS)
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
