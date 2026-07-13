/**
 * Pure schedule-building logic: turn raw WFM shifts + time off into a pivoted
 * model (one row per agent, one column per day) and serialize it to CSV.
 *
 * All wall-clock math is done in a configurable IANA timezone (the
 * `export_timezone` app setting, default Europe/Warsaw) — both the HH:MM
 * rendering AND the decision of which day-column a shift/time-off falls into,
 * plus the time-off fetch window bounds. Using a fixed named zone (rather than
 * the runner's browser) keeps exports reproducible while matching the local
 * times a scheduler sees in the WFM UI. IANA zones are DST-correct (Warsaw is
 * UTC+1 in winter, UTC+2 in summer).
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MS_PER_DAY = 86400000
const MAX_DAYS = 400 // guard against a pathological range

// Default timezone the schedule is interpreted in. Configurable via the
// `export_timezone` app setting.
export const DEFAULT_TIMEZONE = 'Europe/Warsaw'

// --- date / time helpers ---------------------------------------------------

function pad2(n) {
  return String(n).padStart(2, '0')
}

// 'YYYY-MM-DD' -> UTC midnight ms. Used only for calendar-date arithmetic
// (range length, day iteration, weekday) which is timezone-independent.
function dateToUtcMs(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

// UTC ms -> 'YYYY-MM-DD' (calendar-date label; zone-independent).
function utcMsToKey(ms) {
  const dt = new Date(ms)
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`
}

// Cache one Intl.DateTimeFormat per zone — formatToParts is called per shift.
const _dtfCache = new Map()
function dtfFor(timeZone) {
  let dtf = _dtfCache.get(timeZone)
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
    _dtfCache.set(timeZone, dtf)
  }
  return dtf
}

// Absolute instant (ms) -> its wall-clock parts in `timeZone`, as numbers.
function zonedParts(unixMs, timeZone) {
  const parts = {}
  for (const p of dtfFor(timeZone).formatToParts(new Date(unixMs))) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  let hour = parseInt(parts.hour, 10)
  if (hour === 24) hour = 0 // some engines emit '24' for midnight under h23
  return {
    year: parseInt(parts.year, 10),
    month: parseInt(parts.month, 10),
    day: parseInt(parts.day, 10),
    hour,
    minute: parseInt(parts.minute, 10),
    second: parseInt(parts.second, 10)
  }
}

// unix seconds -> day key ('YYYY-MM-DD') in `timeZone`.
function tsToDayKey(unixSeconds, timeZone = 'UTC') {
  const p = zonedParts(unixSeconds * 1000, timeZone)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`
}

// unix seconds -> 'HH:MM' in `timeZone`.
export function tsToHHMM(unixSeconds, timeZone = 'UTC') {
  const p = zonedParts(unixSeconds * 1000, timeZone)
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

// Offset (ms) between `timeZone`'s wall clock and UTC at the given instant.
function zoneOffsetMs(utcMs, timeZone) {
  const p = zonedParts(utcMs, timeZone)
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asIfUtc - utcMs
}

// Wall-clock time in `timeZone` -> the UTC instant (ms). Two-pass correction
// handles DST transitions (offset differs before/after the guess).
function zonedWallToUtcMs(y, mo, d, hh, mm, ss, timeZone) {
  const guess = Date.UTC(y, mo - 1, d, hh, mm, ss)
  const off1 = zoneOffsetMs(guess, timeZone)
  let result = guess - off1
  const off2 = zoneOffsetMs(result, timeZone)
  if (off2 !== off1) result = guess - off2
  return result
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

// Default maximum range length in days (≈ one calendar month). Configurable via
// the `max_range_days` app setting.
export const DEFAULT_MAX_RANGE_DAYS = 31

/**
 * Validate the maximum-range rule: the inclusive number of days from startDate
 * to endDate must not exceed `maxDays`. Both dates are 'YYYY-MM-DD'.
 * Aug 1 → Aug 31 counts as 31 days.
 */
export function isWithinMaxDays(startDate, endDate, maxDays = DEFAULT_MAX_RANGE_DAYS) {
  if (!startDate || !endDate) return false
  const start = dateToUtcMs(startDate)
  const end = dateToUtcMs(endDate)
  if (end < start) return false
  const inclusiveDays = Math.round((end - start) / MS_PER_DAY) + 1
  return inclusiveDays <= maxDays
}

// Inclusive UNIX-second bounds for a 'YYYY-MM-DD'..'YYYY-MM-DD' range, taken as
// midnight-to-midnight in `timeZone` (so the fetch window lines up with the
// zone's calendar days — the same days the export buckets into).
export function rangeToTimestamps(startDate, endDate, timeZone = 'UTC') {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  // Start = 00:00:00 of startDate in the zone.
  const startMs = zonedWallToUtcMs(sy, sm, sd, 0, 0, 0, timeZone)
  // End = 23:59:59 of endDate in the zone (start of next day minus 1s).
  const endNextMidnight = zonedWallToUtcMs(ey, em, ed + 1, 0, 0, 0, timeZone)
  const startTime = Math.floor(startMs / 1000)
  const endTime = Math.floor(endNextMidnight / 1000) - 1
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
 * @param {'published'|'draft'} [params.mode='published']  In 'draft' mode,
 *   unpublished shifts (`published === false`) are suffixed with ` (draft)` so
 *   the export mirrors the white/yellow distinction of the WFM Schedule UI.
 * @param {string} [params.timeZone='UTC']  IANA zone for HH:MM rendering and
 *   day-column bucketing (e.g. 'Europe/Warsaw').
 * @returns {{days:Array, rows:Array}}
 */
export function buildSchedule({
  shifts = [],
  timeOff = [],
  agentMap = new Map(),
  startDate,
  endDate,
  mode = 'published',
  timeZone = 'UTC'
}) {
  const days = enumerateDays(startDate, endDate)
  const dayKeys = new Set(days.map((d) => d.key))

  // agentId -> { shiftsByDay: Map<dayKey, [{start,end,draft}]>, timeOffByDay: Map<dayKey, [text]> }
  const agents = new Map()

  const ensure = (agentId) => {
    const id = String(agentId)
    if (!agents.has(id)) agents.set(id, { shiftsByDay: new Map(), timeOffByDay: new Map() })
    return agents.get(id)
  }

  // Shifts. A shift is a draft when its `published` flag is explicitly false;
  // only relevant in 'draft' mode (in 'published' mode everything is published).
  for (const s of shifts) {
    if (s.agentId == null || s.startTime == null || s.endTime == null) continue
    const key = tsToDayKey(s.startTime, timeZone)
    if (!dayKeys.has(key)) continue
    const bucket = ensure(s.agentId).shiftsByDay
    if (!bucket.has(key)) bucket.set(key, [])
    bucket.get(key).push({ start: s.startTime, end: s.endTime, draft: s.published === false })
  }

  // Time off
  for (const req of timeOff) {
    if (req.agentId == null) continue
    const fullDay = isFullDay(req)
    for (const block of timeOffBlocks(req)) {
      if (block.startTime == null) continue
      const key = tsToDayKey(block.startTime, timeZone)
      if (!dayKeys.has(key)) continue
      const text = fullDay
        ? 'time off'
        : `time off ${tsToHHMM(block.startTime, timeZone)}-${tsToHHMM(block.endTime, timeZone)}`
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
          .forEach((sh) => {
            const range = `${tsToHHMM(sh.start, timeZone)}-${tsToHHMM(sh.end, timeZone)}`
            // In draft mode, mark unpublished shifts so analysts can tell the
            // committed schedule from in-progress edits (mirrors the UI's yellow).
            parts.push(mode === 'draft' && sh.draft ? `${range} (draft)` : range)
          })
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
