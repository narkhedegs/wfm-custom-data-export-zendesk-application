/**
 * TEMPORARY DEBUG PROBE — DO NOT SHIP.
 *
 * Investigates how the WFM Schedule "current view" is produced, to settle the
 * Published/Draft selector design. Fires four requests through the ZAF proxy
 * (client.request injects the in-iframe session JWT — the only way the public
 * endpoint authenticates) and bundles the raw responses for offline analysis:
 *
 *   1. public POST /v1/shifts/fetch  published: 1  (committed)
 *   2. public POST /v1/shifts/fetch  published: 0
 *   3. public POST /v1/shifts/fetch  published omitted
 *   4. internal POST /wfm/l5/api/shifts/fetch/visible  { agentsIds }  (manager UI)
 *
 * Remove this file and its call site in NavBar.jsx before any real change ships.
 */

const WFM_BASE = '/wfm/public/api'
const L5_BASE = '/wfm/l5/api'
const MAX_PAGES = 500

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

// Paginate a public /v1/shifts/fetch variant, capturing every page's raw body
// plus a flattened row list. `publishedValue === undefined` omits the param.
async function fetchPublicVariant(client, startDate, endDate, publishedValue) {
  const pages = []
  const rows = []
  let page = 1
  let error = null
  try {
    for (; page <= MAX_PAGES; page++) {
      const data = { startDate, endDate, page, orderBy: { column: 'agentName', direction: 'asc' } }
      if (publishedValue !== undefined) data.published = publishedValue

      const res = await client.request({
        url: `${WFM_BASE}/v1/shifts/fetch`,
        type: 'POST',
        contentType: 'application/json',
        httpCompleteResponse: false,
        data: JSON.stringify(data)
      })
      const body = parseBody(res)
      pages.push(body)
      const r = Array.isArray(body?.data) ? body.data : []
      rows.push(...r)
      const total = body?.metadata?.total
      if (r.length === 0) break
      if (typeof total === 'number' && rows.length >= total) break
    }
  } catch (e) {
    error = { message: String(e?.message || e), raw: safeErr(e) }
  }
  return { publishedValue: publishedValue === undefined ? 'omitted' : publishedValue, rows, pages, error }
}

async function fetchVisible(client, startDate, endDate, agentsIds) {
  try {
    const res = await client.request({
      url: `${L5_BASE}/shifts/fetch/visible`,
      type: 'POST',
      contentType: 'application/json',
      httpCompleteResponse: false,
      data: JSON.stringify({ startDate, endDate, agentsIds })
    })
    return { ok: true, agentsIds, body: parseBody(res) }
  } catch (e) {
    return { ok: false, agentsIds, error: { message: String(e?.message || e), raw: safeErr(e) } }
  }
}

// ZAF errors can be a status-bearing object; keep whatever is serializable.
function safeErr(e) {
  try {
    return JSON.parse(JSON.stringify(e))
  } catch {
    return null
  }
}

/**
 * Run the full probe and trigger a download of the raw bundle.
 * @param {object} client ZAF client
 * @param {string} startDate 'YYYY-MM-DD'
 * @param {string} endDate   'YYYY-MM-DD'
 */
export async function runProbe(client, startDate, endDate) {
  const [pub1, pub0, pubOmit] = await Promise.all([
    fetchPublicVariant(client, startDate, endDate, 1),
    fetchPublicVariant(client, startDate, endDate, 0),
    fetchPublicVariant(client, startDate, endDate, undefined)
  ])

  // agentsIds for /visible: union of every agentId seen across the public
  // variants (robust — doesn't trust the ids from the captured cURL).
  const idSet = new Set()
  for (const v of [pub1, pub0, pubOmit]) {
    for (const s of v.rows) if (s?.agentId != null) idSet.add(Number(s.agentId))
  }
  const agentsIds = [...idSet]

  const visible = await fetchVisible(client, startDate, endDate, agentsIds)

  const bundle = {
    probeVersion: 1,
    range: { startDate, endDate },
    // Counts up front for a quick read before diving into raw rows.
    summary: {
      published_1: { rowCount: pub1.rows.length, error: pub1.error?.message || null },
      published_0: { rowCount: pub0.rows.length, error: pub0.error?.message || null },
      published_omitted: { rowCount: pubOmit.rows.length, error: pubOmit.error?.message || null },
      visible: {
        ok: visible.ok,
        rowCount: Array.isArray(visible.body?.data) ? visible.body.data.length : null,
        error: visible.error?.message || null
      },
      agentsIdsSentToVisible: agentsIds.length
    },
    public_published_1: pub1,
    public_published_0: pub0,
    public_published_omitted: pubOmit,
    l5_visible: visible
  }

  const json = JSON.stringify(bundle, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `wfm-probe_${startDate}_${endDate}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)

  return bundle.summary
}
