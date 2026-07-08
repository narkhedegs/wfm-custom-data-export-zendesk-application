/**
 * WFM API access layer.
 *
 * All calls go through the ZAF `client.request()` proxy using RELATIVE,
 * same-origin URLs (`/wfm/public/api/...`, `/api/v2/...`). Zendesk injects the
 * logged-in agent's session JWT server-side — the WFM edge rejects direct
 * `Authorization: Basic ...` calls with `403 {"message":"JWT not found."}`, so
 * no credential is ever shipped from the browser.
 */

const WFM_BASE = '/wfm/public/api'
const CORE_BASE = '/api/v2'

// Guard against a runaway pagination loop if the API keeps returning a "next".
const MAX_PAGES = 500
// Core Users API accepts up to 100 ids per show_many request.
const USERS_CHUNK = 100

/**
 * Fetch every published shift in [startDate, endDate], following the paginated
 * `page`/`metadata.total` contract of POST /v1/shifts/fetch.
 *
 * @param {object} client  ZAF client
 * @param {string} startDate  YYYY-MM-DD
 * @param {string} endDate    YYYY-MM-DD
 * @returns {Promise<Array>} flat array of shift objects
 */
export async function fetchShifts(client, startDate, endDate) {
  const all = []
  let page = 1

  for (; page <= MAX_PAGES; page++) {
    const res = await client.request({
      url: `${WFM_BASE}/v1/shifts/fetch`,
      type: 'POST',
      contentType: 'application/json',
      httpCompleteResponse: false,
      // The live API requires orderBy (both column and direction) even though
      // the swagger marks it optional; omitting it returns 422.
      data: JSON.stringify({
        startDate,
        endDate,
        published: 1,
        page,
        orderBy: { column: 'agentName', direction: 'asc' }
      })
    })

    const body = parseBody(res)
    const rows = Array.isArray(body?.data) ? body.data : []
    all.push(...rows)

    // Stop when we have collected everything the API reports, or this page was
    // short/empty (defensive: `total` is the grand total across all pages).
    const total = body?.metadata?.total
    if (rows.length === 0) break
    if (typeof total === 'number' && all.length >= total) break
  }

  return all
}

/**
 * Fetch approved time-off requests overlapping the window, following the
 * `pagination.next` links of GET /v2/timeOff. `startTime`/`endTime` are the
 * inclusive UTC-second bounds of the selected range.
 *
 * @returns {Promise<Array>} flat array of time-off request objects
 */
export async function fetchTimeOff(client, startTime, endTime) {
  const all = []
  const params = new URLSearchParams({
    startTime: String(startTime),
    endTime: String(endTime),
    status: 'approved',
    // Live API caps perPage at 50 (swagger says 100).
    perPage: '50',
    page: '1'
  })
  let url = `${WFM_BASE}/v2/timeOff?${params.toString()}`

  for (let i = 0; i < MAX_PAGES && url; i++) {
    const res = await client.request({
      url,
      type: 'GET',
      httpCompleteResponse: false
    })

    const body = parseBody(res)
    const rows = Array.isArray(body?.data) ? body.data : []
    all.push(...rows)

    // `next` is an absolute URL; reduce it to a same-origin relative path so it
    // keeps flowing through the ZAF proxy (and its session JWT).
    url = toRelative(body?.pagination?.next)
  }

  return all
}

/**
 * Resolve agent ids to { name, email } via the core Users API in chunks of 100.
 * Fail-soft: a failed chunk is skipped (those agents stay unresolved) rather
 * than aborting the whole export.
 *
 * @param {object} client
 * @param {Array<number|string>} agentIds  may contain duplicates
 * @returns {Promise<Map<string, {name: string, email: string}>>}
 */
export async function resolveAgents(client, agentIds) {
  const map = new Map()
  const unique = [...new Set(agentIds.map((id) => String(id)))]

  for (let i = 0; i < unique.length; i += USERS_CHUNK) {
    const chunk = unique.slice(i, i + USERS_CHUNK)
    try {
      const res = await client.request({
        url: `${CORE_BASE}/users/show_many.json?ids=${chunk.join(',')}`,
        type: 'GET',
        httpCompleteResponse: false
      })
      const body = parseBody(res)
      const users = Array.isArray(body?.users) ? body.users : []
      for (const u of users) {
        map.set(String(u.id), { name: u.name || '', email: u.email || '' })
      }
    } catch (e) {
      // Fail-soft: leave this chunk's agents unresolved.
      // eslint-disable-next-line no-console
      console.warn('resolveAgents: chunk failed, leaving agents unresolved', e)
    }
  }

  return map
}

// --- helpers ---------------------------------------------------------------

// ZAF may hand back the response already parsed (object) or as a JSON string,
// depending on the detected content type. Normalize to an object.
function parseBody(res) {
  if (res == null) return null
  if (typeof res === 'string') {
    try {
      return JSON.parse(res)
    } catch {
      return null
    }
  }
  return res
}

// Convert an absolute API URL (or null) to a same-origin relative path so it
// continues to route through the ZAF proxy. Returns '' when there is no next.
function toRelative(next) {
  if (!next) return ''
  const idx = next.indexOf(WFM_BASE)
  if (idx >= 0) return next.slice(idx)
  return next // already relative, or unexpected shape — let the caller try it
}
