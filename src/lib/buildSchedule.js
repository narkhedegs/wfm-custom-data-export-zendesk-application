/**
 * Pure schedule-building logic: turn raw WFM shifts + time off into a pivoted
 * model (one row per agent, one column per day) and serialize it to CSV.
 *
 * All time math is done in **UTC** — both the HH:MM rendering and the decision
 * of which day-column a shift/time-off falls into. This keeps exports
 * reproducible regardless of who runs them or where.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MS_PER_DAY = 86400000
const MAX_DAYS = 400 // guard against a pathological range

// --- date / time helpers ---------------------------------------------------

function pad2(n) {
  return String(n).padStart(2, '0')
}

// 'YYYY-MM-DD' -> UTC midnight ms
function dateToUtcMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

// UTC ms -> 'YYYY-MM-DD'
function utcMsToKey(ms) {
  const dt = new Date(ms)
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}

// unix seconds -> day key ('YYYY-MM-DD') in UTC
function tsToDayKey(unixSeconds) {
  return utcMsToKey(unixSeconds * 1000)
}

// unix seconds -> 'HH:MM' in UTC
export function tsToHHMM(unixSeconds) {
  const dt = new Date(unixSeconds * 1000)
  return `${pad2(dt.getUTCHours())}:${pad2(dt.getUTCMinutes())}`
}

/**
 * Enumerate the day-columns for the exact selected range, inclusive.
 * @returns {Array<{key:string, weekday:string, dateLabel:string}>}
 */
export function enumerateDays(startDate, endDate) {
  const start = dateToUtcMs(startDate)
  const end = dateToUtcMs(endDate)
  const days = []
  for (let ms = start, i = 0; ms <= end && i < MAX_DAYS; ms += MS_PER_DAY, i++) {
    const dt = new Date(ms)
    days.push({
      key: utcMsToKey(ms),
      weekday: WEEKDAYS[dt.getUTCDay()],
      // M/D/YYYY, no leading zeros — matches the expected CSV format
      dateLabel: `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}/${dt.getUTCFullYear()}`
    })
  }
  return days
}

/**
 * Validate the "maximum one calendar month" rule: endDate must be on or before
 * startDate + 1 month. Both args are 'YYYY-MM-DD'.
 */
export function isWithinOneMonth(startDate, endDate) {
  if (!startDate || !endDate) return false
  const start = dateToUtcMs(startDate)
  const end = dateToUtcMs(endDate)
  if (end < start) return false
  const [y, m, d] = startDate.split('-').map(Number)
  const maxMs = Date.UTC(y, m, d) // month index m == startMonth + 1
  return end <= maxMs
}

// Inclusive UTC-second bounds for a 'YYYY-MM-DD'..'YYYY-MM-DD' range.
export function rangeToTimestamps(startDate, endDate) {
  const startTime = Math.floor(dateToUtcMs(startDate) / 1000)
  // end of endDate = start of the following day minus 1 second
  const endTime = Math.floor((dateToUtcMs(endDate) + MS_PER_DAY) / 1000) - 1
  return { startTime, endTime }
}

// --- schedule assembly ------------------------------------------------------

// A time-off request may carry sub-blocks in `timeOffs`; fall back to the
// request-level start/end when absent. Each block is placed on its start day.
function timeOffBlocks(req) {
  if (Array.isArray(req.timeOffs) && req.timeOffs.length) return req.timeOffs
  return [{ startTime: req.startTime, endTime: req.endTime }]
}

function isFullDay(req) {
  return String(req.timeOffType || '').toLowerCase().startsWith('full')
}

/**
 * Build the pivoted schedule model.
 *
 * @param {object}  params
 * @param {Array}   params.shifts     from fetchShifts
 * @param {Array}   params.timeOff    from fetchTimeOff (already approved-only)
 * @param {Map}     params.agentMap   agentId(string) -> { name, email }
 * @param {string}  params.startDate  'YYYY-MM-DD'
 * @param {string}  params.endDate    'YYYY-MM-DD'
 * @returns {{days:Array, rows:Array}}
 */
export function buildSchedule({ shifts = [], timeOff = [], agentMap = new Map(), startDate, endDate }) {
  const days = enumerateDays(startDate, endDate)
  const dayKeys = new Set(days.map((d) => d.key))

  // agentId -> { shiftsByDay: Map<dayKey, [{start,end}]>, timeOffByDay: Map<dayKey, [text]> }
  const agents = new Map()

  const ensure = (agentId) => {
    const id = String(agentId)
    if (!agents.has(id)) agents.set(id, { shiftsByDay: new Map(), timeOffByDay: new Map() })
    return agents.get(id)
  }

  // Shifts
  for (const s of shifts) {
    if (s.agentId == null || s.startTime == null || s.endTime == null) continue
    const key = tsToDayKey(s.startTime)
    if (!dayKeys.has(key)) continue
    const bucket = ensure(s.agentId).shiftsByDay
    if (!bucket.has(key)) bucket.set(key, [])
    bucket.get(key).push({ start: s.startTime, end: s.endTime })
  }

  // Time off
  for (const req of timeOff) {
    if (req.agentId == null) continue
    const fullDay = isFullDay(req)
    for (const block of timeOffBlocks(req)) {
      if (block.startTime == null) continue
      const key = tsToDayKey(block.startTime)
      if (!dayKeys.has(key)) continue
      const text = fullDay ? 'time off' : `time off ${tsToHHMM(block.startTime)}-${tsToHHMM(block.endTime)}`
      const bucket = ensure(req.agentId).timeOffByDay
      if (!bucket.has(key)) bucket.set(key, [])
      bucket.get(key).push(text)
    }
  }

  // Compose one row per agent that has any data.
  const rows = []
  for (const [id, data] of agents) {
    const resolved = agentMap.get(id)
    const name = resolved?.name || id // placeholder = agentId when unresolved
    const email = resolved?.email || ''

    const cells = {}
    for (const day of days) {
      const parts = []
      const shiftsToday = data.shiftsByDay.get(day.key)
      if (shiftsToday) {
        shiftsToday
          .sort((a, b) => a.start - b.start)
          .forEach((sh) => parts.push(`${tsToHHMM(sh.start)}-${tsToHHMM(sh.end)}`))
      }
      const timeOffToday = data.timeOffByDay.get(day.key)
      if (timeOffToday) parts.push(...timeOffToday)
      cells[day.key] = parts.join(', ')
    }

    rows.push({ agentId: id, name, email, cells })
  }

  // Stable order: by resolved name (case-insensitive), fallback agentId.
  rows.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  return { days, rows }
}

// --- CSV serialization ------------------------------------------------------

function csvField(value) {
  const s = value == null ? '' : String(value)
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * Serialize a schedule model to an RFC-4180 CSV string with a two-row header,
 * a leading UTF-8 BOM (for Excel), and CRLF line endings.
 */
export function toCsv({ days, rows }) {
  const lines = []

  // Row 1: identity headers + weekday names
  lines.push(['agentId', 'Name', 'Email', ...days.map((d) => d.weekday)].map(csvField).join(','))
  // Row 2: blank identity cells + M/D/YYYY dates
  lines.push(['', '', '', ...days.map((d) => d.dateLabel)].map(csvField).join(','))

  for (const row of rows) {
    lines.push(
      [row.agentId, row.name, row.email, ...days.map((d) => row.cells[d.key] || '')].map(csvField).join(',')
    )
  }

  return '﻿' + lines.join('\r\n') + '\r\n'
}
