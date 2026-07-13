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
affects three things at once: the `HH:MM` strings shown in each cell, the
day-column a given shift is assigned to, and the midnight-to-midnight bounds of
the time-off fetch window. The zone is a configurable installation setting,
`export_timezone` (any IANA zone name, e.g. `Europe/Warsaw`, `UTC`,
`America/New_York`), defaulting to **Europe/Warsaw**. Using a fixed *named* zone
— rather than the runner's browser zone — keeps exports reproducible across
users and machines while matching the local times a scheduler sees in the WFM
UI. IANA zones are DST-correct (Warsaw is UTC+1 in winter and UTC+2 in summer),
which a fixed numeric offset would not be. Because the zone drives day
assignment too, a shift that crosses local midnight is filed under the correct
local day rather than its UTC day.

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

#### Schedule Version: Published vs Current (Draft)

A **Schedule Version** selector controls which shifts the export reflects:

- **Published only** — sends `published: 1`, returning the committed schedule
  agents actually see. Nothing is marked.
- **Current (includes drafts)** — omits the `published` param, which returns the
  raw union of published shifts plus unpublished working copies. This
  reproduces exactly (matched by shift `id`) the "current view" a manager sees
  in the WFM Schedule page. Editing a published shift in draft deletes its
  published parent, so the union does not double-count edits; unpublished
  shifts are additionally de-duplicated by `id` defensively. Each unpublished
  shift is suffixed with ` (draft)` in the cell (e.g. `13:00-22:00 (draft)`),
  mirroring the yellow/white distinction of the WFM UI.

Changing the selector (or the date range) clears any generated preview and
requires a re-Generate, so the shown data always matches the current selection.

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

## Building This App With Zendesk App Builder

The prompts below recreate this app inside
[Zendesk App Builder](https://support.zendesk.com/hc/en-us/articles/9037913973146-Prompting-guidelines-and-examples-for-App-Builder).
They follow Zendesk's recommended practice of building **iteratively**: start
with a broad first version, then layer in data, formatting, and refinements one
step at a time, reviewing the result after each prompt. Run them **in order** —
each one assumes the previous prompts have already been applied.

A few things to do outside the prompts, per Zendesk's guidance:

- Set the app **name** ("WFM Custom Data Exporter") and **icon** from the
  **Settings** tab rather than through a prompt.
- App Builder apps run inside the Agent Workspace; this app lives in the top
  **nav bar** location.
- The WFM API is a private API App Builder does not know, so Prompt 3 includes a
  sample request and response to teach it the shape — keep that detail intact.
- The app settings introduced in Prompts 9 and 10 (maximum date range, Debug
  button toggle, and export time zone) are configured per installation from the
  **Settings** tab; the prompts only declare them and wire the app to read their
  values.

### Prompt 1 — Scaffold The App And Date Range Controls

> Create a nav bar app called "WFM Custom Data Exporter" that lets a workforce
> manager export a schedule to CSV. The app is used by WFM administrators to
> verify published schedules against legal rules and forecasts in a spreadsheet.
> For now, just build the controls: a date range picker with a start date and an
> end date, and three buttons labeled "Generate", "Download CSV", and "Clear".
> The picker must start with no dates selected. Validate that the selected range
> is at most one calendar month (the end date must be on or before the start date
> plus one month) and that the end date is on or after the start date; when the
> range is invalid, disable the Generate button and show a warning message
> explaining the one-month limit. Keep the controls centered, with the buttons in
> a row below the date range picker.

### Prompt 2 — Fetch Published Shifts And Approved Time Off

> When the user clicks Generate, call the Zendesk WFM API to load the schedule
> for the selected date range. Fetch published shifts with a POST request to
> `/wfm/public/api/v1/shifts/fetch` sending a JSON body with `startDate`,
> `endDate`, `published: 1`, a `page` number, and an `orderBy` of
> `{ "column": "agentName", "direction": "asc" }`; page through the results using
> the `page` field until you have collected `metadata.total` records. Also fetch
> approved time off with a GET request to `/wfm/public/api/v2/timeOff`, passing
> `startTime` and `endTime` as UNIX-second bounds of the range, `status=approved`,
> and `perPage=50`; follow the `pagination.next` links until there are no more
> pages. Make all of these calls as relative, same-origin URLs so Zendesk adds
> the session automatically — do not send any Authorization header. While the
> data is loading, show the Generate button in a loading state, and if the fetch
> fails show an error message.

### Prompt 3 — Resolve Agent Names And Emails

> The shifts and time-off responses only include a numeric `agentId`, but I need
> agent names and emails in the export. After fetching the schedule, collect the
> distinct agent ids and look them up against the core Zendesk Users API with a
> GET request to `/api/v2/users/show_many.json?ids=...`, batching at most 100 ids
> per request. Treat the WFM `agentId` as the Zendesk user id. This lookup should
> fail soft: if a lookup fails or an id cannot be resolved, still include that
> agent using the `agentId` itself as the name placeholder and leaving the email
> blank. Here is a sample of the users response so you know the shape:
>
> ```json
> { "users": [{ "id": 376828556137, "name": "John Doe", "email": "john.doe@example.com" }] }
> ```

### Prompt 4 — Build The Pivoted Schedule Grid

> Now turn the data into a pivoted table with one row per agent and one column
> per day. The first three columns are `agentId`, `Name`, and `Email`. After
> those, add one column for each day in the selected range, in order. Each day
> column has a two-line header: the weekday name (for example "Monday") on the
> first line and the date as `M/D/YYYY` on the second line. Convert all shift and
> time-off timestamps to UTC when deciding both the time shown and which day
> column an entry belongs to. Only include a row for an agent who has at least one
> shift or approved time off in the range, and sort the rows by name (falling back
> to the agentId when there is no name). Display this table inside the app as a
> preview.

### Prompt 5 — Fill Each Day Cell With Shifts And Time Off

> Fill each day cell using the agent's shifts and time off for that day. Show a
> shift as its start and end time in 24-hour `HH:MM-HH:MM` form, for example
> `09:00-17:00`. If an agent has more than one shift that day, list them all
> separated by a comma and a space, sorted by start time, for example
> `09:00-12:00, 13:00-17:00`. Show a full-day absence as the text `time off`, and
> a partial absence as `time off HH:MM-HH:MM` using its start and end time. When a
> day has both a shift and time off, show both in the same cell separated by a
> comma, for example `09:00-17:00, time off`. Leave a cell completely empty when
> there is nothing scheduled.

### Prompt 6 — Download The CSV

> When the user clicks Download CSV, generate a CSV file from the exact same data
> shown in the preview table, including the two header rows (weekday names, then
> the `M/D/YYYY` dates, with the first three columns blank on the second row).
> Quote any cell that contains a comma, encode the file as UTF-8 with a byte-order
> mark so it opens cleanly in Excel, and name the downloaded file
> `wfm-schedule_<startDate>_<endDate>.csv`. Enable the Download CSV button only
> after a schedule has been generated. The Clear button should reset the date
> range to no selection and clear the preview table and any messages; keep it
> disabled until a date is selected.

### Prompt 7 — Cosmetic Refinements (Batched)

> Make these appearance tweaks together: give the preview table a fixed height of
> about 600 pixels with its own scrollbars so it never grows the whole page; keep
> the header row and the agentId column visible (frozen) while scrolling; add a
> horizontal scrollbar above the table as well as below it, kept in sync with the
> table; style the Clear button as an outlined button in a red/danger color; and
> show an informational message reading "No shifts or approved time off were found
> for the selected range." when a generated export has no rows.

### Prompt 8 — Add A Published vs Current (Draft) Schedule Version Selector

> Add a "Schedule Version" selector above the buttons, as a radio group with two
> options: "Current (includes drafts)" and "Published only". Default to "Current
> (includes drafts)". Below the radios, show a short helper line describing the
> selected option: for Current, "The current working schedule managers see,
> includes unpublished edits, marked “(draft)”."; for Published, "The committed
> schedule only, as published to agents."
>
> This selector controls how shifts are fetched. For "Published only", keep
> sending `published: 1` as before (the committed schedule). For "Current
> (includes drafts)", omit the `published` field from the `/wfm/public/api/v1/shifts/fetch`
> body entirely — this returns the union of published shifts plus unpublished
> draft edits, which is exactly what a manager sees on the WFM Schedule page.
> Editing a published shift in draft deletes its published parent, so the union
> does not double-count edits, but de-duplicate the fetched shifts by their `id`
> defensively so a shift is never counted twice. Each shift object includes a
> boolean `published` field.
>
> In "Current (includes drafts)" mode only, mark each unpublished shift (where
> `published` is false) in its day cell by appending " (draft)" after the time
> range, for example `13:00-22:00 (draft)`; published shifts stay unmarked. In
> "Published only" mode nothing is marked. This marker must appear identically in
> both the preview table and the downloaded CSV. Time off is unaffected by the
> selector — always fetch approved time off exactly as before.
>
> When the user changes the Schedule Version selector, or changes the date range,
> clear any generated preview and disable the Download CSV button, so the shown
> data always matches the current selection and a re-Generate is required. Record
> the mode used to generate a preview: show it in the preview heading (for example
> "Preview — Current (includes drafts) — 12 Agent(s)") and include it in the
> download filename as `wfm-schedule_<mode>_<startDate>_<endDate>.csv`, where
> `<mode>` is `draft` or `published`.

### Prompt 9 — Add Configurable App Settings

> Add two installation settings (app parameters) that the app reads at runtime,
> and give each a label and help text for the Settings tab.
>
> The first, `max_range_days`, is a number that defaults to `31`. Use it as the
> maximum selectable date-range length, measured as an inclusive count of days
> (so August 1 to August 31 is 31 days). Replace the previous "one calendar
> month" rule with this configurable limit everywhere it applies: the range is
> valid only when the inclusive day count is at most `max_range_days` and the end
> date is on or after the start date. Update the date-range field label to read
> "Date Range (Max N Days)" and the invalid-range warning to reference N days,
> where N is the configured value.
>
> The second, `show_debug_button`, is a checkbox that defaults to off. When it is
> on, show a "Debug" button alongside the other buttons that downloads a JSON file
> of the raw WFM API responses for the selected range (useful for
> troubleshooting); when it is off, hide the button entirely.
>
> Read both settings from the app's installation metadata when the app loads, and
> fall back to the defaults (31 days, Debug button hidden) while the metadata is
> still loading or if it cannot be read.

### Prompt 10 — Make The Time Zone Configurable

> Right now shift times and day columns are computed in UTC. Add a third
> installation setting, `export_timezone`, a text parameter holding an IANA time
> zone name (for example `Europe/Warsaw`, `UTC`, or `America/New_York`) and
> defaulting to `Europe/Warsaw`. Give it a label and help text for the Settings
> tab, and read it alongside the other settings, falling back to `Europe/Warsaw`
> if it is missing or not a valid time zone.
>
> Use this zone consistently for every wall-clock decision, not just the
> displayed time. Convert each shift's and time off's start and end to `HH:MM` in
> this zone; decide which day column an entry belongs to using the calendar date
> in this zone (so a shift that crosses local midnight lands on the correct local
> day, which may differ from its UTC day); and compute the time-off fetch window
> as midnight-to-midnight of the selected range in this zone. Use the platform's
> built-in time zone support so daylight-saving transitions are handled correctly
> (for instance Warsaw is UTC+1 in winter and UTC+2 in summer) rather than
> applying a fixed numeric offset.
>
> Show the active time zone in the preview heading (for example "… — times in
> Europe/Warsaw") so it is clear which zone the exported times are in. The times
> in the preview table and the downloaded CSV must match exactly.
