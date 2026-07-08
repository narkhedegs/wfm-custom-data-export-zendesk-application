# WFM Custom Data Export Zendesk Application

## Decisions

This section records the design decisions behind the app and the reasoning that
led to each one. The decisions are grouped by theme — how the app authenticates,
where its data comes from, how that data is shaped into the exported grid, and
which slices of the schedule are considered in scope — followed by the
cross-cutting behaviors and defaults that were settled without a dedicated
discussion.

### Authentication & Data Sources

#### How The App Talks To The WFM API

The app authenticates through the **ZAF proxy using the same-origin session**
rather than by sending credentials of its own. Every WFM call is made to a
relative `/wfm/public/api/...` URL via ZAF's `client.request()`, which lets
Zendesk inject the logged-in agent's session JWT server-side. As a result, no
secret is ever shipped to or stored in the browser.

```js
client.request({
  url: '/wfm/public/api/v1/shifts/fetch',
  type: 'POST',
  contentType: 'application/json',
  data: JSON.stringify({ startDate, endDate, published: 1 })
})
```

#### Where Agent Names And Emails Come From

The exported CSV needs three identity columns — `agentId`, `Name`, and `Email` —
but neither `/v1/shifts/fetch` nor `/v2/timeOff` returns anything beyond a numeric
`agentId`. To fill in the human-readable fields, the app collects the distinct
agent ids that appear in the schedule and resolves them against the **core
Zendesk Users API**, batching lookups through
`GET /api/v2/users/show_many.json?ids=...` at up to 100 ids per call over the
same ZAF session. This relies on the assumption that a WFM `agentId` is the same
value as the corresponding Zendesk user id.

### Shaping The Exported Grid

#### Time Zone For Rendering And Day Assignment

All shift and time-off timestamps arrive as Unix times, and the chosen time zone
affects two things at once: the `HH:MM` strings shown in each cell and the
day-column a given shift is assigned to. The app renders and buckets everything
in **UTC**, which keeps exports reproducible and unambiguous across users and
machines. The trade-off, worth noting for anyone comparing the export against the
scheduling tool, is that these times may not match the local times a scheduler
sees in the WFM UI.

#### Columns And Header Rows

The grid uses the **exact selected date range**, emitting one column per day from
`startDate` to `endDate` inclusive, exactly as chosen. Each column carries a
two-row header: the first row shows the weekday name and the second shows the
date in `M/D/YYYY` form. An earlier sample export happened to begin on a Monday,
but that was incidental to that particular data set rather than a requirement, so
the range is taken verbatim from the user's selection.

#### What A Single Day Cell Contains

A cell can hold more than one entry, and everything is preserved losslessly. When
an agent has **multiple shifts on the same day**, all of them are listed and
joined with commas — for example `09:00-12:00, 13:00-17:00` — and because the
value then contains a comma it is quoted in the CSV.

**Time off** is rendered with a `time off` label and combined with any shifts on
the same day rather than replacing them:

- A full-day absence appears simply as `time off`.
- A day that has both a shift and time off shows both, as in
  `09:00-17:00, time off`.
- A partial absence includes its span, as in `time off 13:00-15:00`.

### Scope: Which Schedule Data Counts

#### Published Shifts Only

`/v1/shifts/fetch` returns both published shifts and unpublished working copies
unless it is told otherwise. Because the export is meant to reflect the schedule
agents actually see, the app requests **published shifts only** by sending
`published: 1`. This mirrors the committed schedule and avoids double-counting a
shift that also exists as an in-progress draft.

#### Approved Time Off Only

For the same reason, only time off with `status=approved` is included. Approved
requests are the ones actually in effect against the schedule, so pending and
denied requests are excluded to prevent them from distorting the picture.

#### Which Agents Appear As Rows

The export lists **only agents that have data in the selected range** — an agent
is included if, and only if, they have at least one shift or one approved
time-off entry within the range. Agents with nothing scheduled in the window are
omitted so the sheet stays focused on the schedule under review.

#### Bounding The Range To One Month

The selected range is limited to a **maximum of one calendar month**: it is valid
as long as `endDate ≤ startDate + 1 month`. For instance, 8/15 → 9/15 is allowed,
while 8/15 → 9/16 is not. When the range exceeds that bound, the export is
disabled and the user is shown an explanatory message.

### Cross-Cutting Behavior

#### Handling Unresolved Agents And Errors

Identity resolution and export are designed to **fail soft**. If an `agentId`
cannot be resolved through the Users API, its row is still emitted with the
`agentId` used as a placeholder in the `Name` column and the `Email` left blank;
a partial failure of the Users lookup simply leaves those placeholders in place.
Only a failure of the underlying shifts or time-off fetch aborts the export, in
which case the user is shown an error message.

#### Defaults Chosen

- The date range picker opens with **no range selected**; the user must choose
  both a start and an end date before the export is enabled.
- Rows are sorted by the resolved agent name, falling back to the `agentId` when
  the name is unavailable.
- The downloaded file is named `wfm-schedule_<startDate>_<endDate>.csv`.
- The CSV is written as UTF-8 with a byte-order mark, `\r\n` line endings, and
  RFC-4180 quoting, so it opens cleanly in Excel.
- An empty cell is left truly empty rather than filled with a dash or other
  placeholder.
- The download is produced entirely in the browser via a Blob and an
  `<a download>` link, with no server involved.
