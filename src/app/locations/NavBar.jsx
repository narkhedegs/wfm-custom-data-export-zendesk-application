import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useClient } from '../hooks/useClient'
import { Grid, Row, Col } from '@zendeskgarden/react-grid'
import { XL, MD } from '@zendeskgarden/react-typography'
import { Button } from '@zendeskgarden/react-buttons'
import { DatepickerRange } from '@zendeskgarden/react-datepickers'
import { Field, Fieldset, Label, Input, Radio } from '@zendeskgarden/react-forms'
import { Table, Head, HeaderRow, HeaderCell, Body, Row as TRow, Cell } from '@zendeskgarden/react-tables'
import { Alert } from '@zendeskgarden/react-notifications'
import styled from 'styled-components'
import { useSettings } from '../hooks/useSettings'
import { fetchShifts, fetchTimeOff, resolveAgents } from '../../lib/wfmApi'
import { buildSchedule, toCsv, isWithinMaxDays, rangeToTimestamps } from '../../lib/buildSchedule'
// TEMPORARY DEBUG — remove with the Debug button below and src/lib/probe.js.
import { runProbe } from '../../lib/probe'

// A picked Date represents a calendar day; take its local Y/M/D as the day.
function toDateStr(date) {
  if (!date) return ''
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const NavBar = () => {
  const client = useClient()
  const { showDebugButton, maxRangeDays, timeZone } = useSettings()

  const [startValue, setStartValue] = useState(undefined)
  const [endValue, setEndValue] = useState(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [schedule, setSchedule] = useState(null) // { days, rows }
  // 'draft' = the current view a manager sees (published + unpublished edits);
  // 'published' = the committed schedule only. Defaults to the current view.
  const [mode, setMode] = useState('draft')

  // A second horizontal scrollbar above the table, kept in sync with the table's
  // own scroll container so the user can scroll horizontally from the top too.
  const topScrollRef = useRef(null)
  const tableScrollRef = useRef(null)
  const [tableWidth, setTableWidth] = useState(0)

  // Mirror the full table width into the top scrollbar's spacer so it presents
  // the same scroll range, and keep it current as columns/rows change.
  useLayoutEffect(() => {
    const el = tableScrollRef.current
    if (!el) return
    const measure = () => setTableWidth(el.scrollWidth)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [schedule])

  // Two-way scroll sync between the top scrollbar and the table container.
  useEffect(() => {
    const top = topScrollRef.current
    const table = tableScrollRef.current
    if (!top || !table) return
    let lock = false
    const sync = (from, to) => () => {
      if (lock) return
      lock = true
      to.scrollLeft = from.scrollLeft
      lock = false
    }
    const onTop = sync(top, table)
    const onTable = sync(table, top)
    top.addEventListener('scroll', onTop)
    table.addEventListener('scroll', onTable)
    return () => {
      top.removeEventListener('scroll', onTop)
      table.removeEventListener('scroll', onTable)
    }
  }, [schedule])

  const startDate = toDateStr(startValue)
  const endDate = toDateStr(endValue)

  const rangeValid = useMemo(
    () => Boolean(startValue) && Boolean(endValue) && isWithinMaxDays(startDate, endDate, maxRangeDays),
    [startValue, endValue, startDate, endDate, maxRangeDays]
  )

  const handleGenerate = async () => {
    setError('')
    setSchedule(null)
    setLoading(true)
    try {
      const { startTime, endTime } = rangeToTimestamps(startDate, endDate, timeZone)
      const [shifts, timeOff] = await Promise.all([
        fetchShifts(client, startDate, endDate, mode),
        fetchTimeOff(client, startTime, endTime)
      ])

      const agentIds = [...shifts.map((s) => s.agentId), ...timeOff.map((r) => r.agentId)].filter(
        (id) => id != null
      )

      const agentMap = await resolveAgents(client, agentIds)
      const model = buildSchedule({ shifts, timeOff, agentMap, startDate, endDate, mode, timeZone })
      // Stamp the range + mode + timezone the model was built with, so the
      // preview label and download filename always match the data (not a later
      // toggle or a settings change after generation).
      setSchedule({ ...model, mode, startDate, endDate, timeZone })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Export failed', e)
      setError('Could not load schedule data from the WFM API. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = () => {
    if (!schedule) return
    const csv = toCsv(schedule)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // Encode the generated mode + range so a Published and a Draft export of the
    // same range are distinguishable on disk.
    a.download = `wfm-schedule_${schedule.mode}_${schedule.startDate}_${schedule.endDate}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // TEMPORARY DEBUG — probe published:0/1/omitted + /l5/visible. Remove later.
  const handleProbe = async () => {
    setError('')
    setLoading(true)
    try {
      const summary = await runProbe(client, startDate, endDate)
      // eslint-disable-next-line no-console
      console.log('WFM PROBE summary', summary)
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('Probe failed', e)
      setError('Probe failed — see console.')
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setStartValue(undefined)
    setEndValue(undefined)
    setSchedule(null)
    setError('')
  }

  // Any change to the inputs (date range or mode) invalidates a generated
  // preview: the shown data must always match the current selection, so we drop
  // it and require a re-Generate. Prevents downloading e.g. Published data while
  // the selector reads Draft.
  const invalidatePreview = () => {
    setSchedule(null)
    setError('')
  }

  const handleModeChange = (next) => {
    if (next === mode) return
    setMode(next)
    invalidatePreview()
  }

  const hasRows = schedule && schedule.rows.length > 0
  const hasSelection = Boolean(startValue) || Boolean(endValue)

  return (
    <GridContainer>
      <Row justifyContent="center">
        <Col textAlign="center">
          <XL isBold>WFM Custom Data Exporter</XL>
        </Col>
      </Row>

      <Row justifyContent="center">
        <Col size="auto">
          <Field>
            <Label>Date Range (Max {maxRangeDays} Days)</Label>
            <DatepickerRange
              startValue={startValue}
              endValue={endValue}
              onChange={({ startValue: s, endValue: e }) => {
                if (s !== undefined) setStartValue(s)
                if (e !== undefined) setEndValue(e)
                // Changing the range invalidates any existing preview/download.
                invalidatePreview()
              }}
            >
              <DateInputs>
                <DatepickerRange.Start>
                  <Input aria-label="Start date" />
                </DatepickerRange.Start>
                <DatepickerRange.End>
                  <Input aria-label="End date" />
                </DatepickerRange.End>
              </DateInputs>
              <DatepickerRange.Calendar />
            </DatepickerRange>
          </Field>
        </Col>
      </Row>

      <Row justifyContent="center">
        <Col size="auto">
          <Fieldset>
            <Fieldset.Legend>Schedule Version</Fieldset.Legend>
            <ModeOptions>
              <Field>
                <Radio
                  name="schedule-version"
                  value="draft"
                  checked={mode === 'draft'}
                  disabled={loading}
                  onChange={() => handleModeChange('draft')}
                >
                  <Label>Current (includes drafts)</Label>
                </Radio>
              </Field>
              <Field>
                <Radio
                  name="schedule-version"
                  value="published"
                  checked={mode === 'published'}
                  disabled={loading}
                  onChange={() => handleModeChange('published')}
                >
                  <Label>Published only</Label>
                </Radio>
              </Field>
            </ModeOptions>
            <ModeHint>
              {mode === 'draft'
                ? 'The current working schedule managers see, includes unpublished edits, marked “(draft)”.'
                : 'The committed schedule only, as published to agents.'}
            </ModeHint>
          </Fieldset>
        </Col>
      </Row>

      <Row justifyContent="center">
        <ButtonBar>
          <Button isPrimary disabled={!rangeValid || loading} onClick={handleGenerate}>
            {loading ? 'Generating…' : 'Generate'}
          </Button>
          <Button isBasic disabled={!hasRows || loading} onClick={handleDownload}>
            Download CSV
          </Button>
          <Button isDanger disabled={!hasSelection || loading} onClick={handleClear}>
            Clear
          </Button>
          {showDebugButton && (
            <Button disabled={!rangeValid || loading} onClick={handleProbe}>
              Debug
            </Button>
          )}
        </ButtonBar>
      </Row>

      {!rangeValid && (
        <Row>
          <Col>
            <Alert type="warning">
              Please select a range of at most {maxRangeDays} days, with the end date on or after the start
              date.
            </Alert>
          </Col>
        </Row>
      )}

      {error && (
        <Row>
          <Col>
            <Alert type="error">{error}</Alert>
          </Col>
        </Row>
      )}

      {schedule && !hasRows && !error && (
        <Row>
          <Col>
            <Alert type="info">No shifts or approved time off were found for the selected range.</Alert>
          </Col>
        </Row>
      )}

      {hasRows && (
        <PreviewRow>
          <PreviewCol>
            <MD isBold>
              Preview — {schedule.mode === 'draft' ? 'Current (includes drafts)' : 'Published only'} —{' '}
              {schedule.rows.length} Agent(s) — times in {schedule.timeZone}
            </MD>
            <TopScrollbar ref={topScrollRef}>
              <TopScrollSpacer style={{ width: tableWidth }} />
            </TopScrollbar>
            <TableScroll ref={tableScrollRef}>
              <WideTable>
                <Head>
                  <HeaderRow>
                    <StickyHeader>agentId</StickyHeader>
                    <IdentityHeader>Name</IdentityHeader>
                    <IdentityHeader>Email</IdentityHeader>
                    {schedule.days.map((d) => (
                      <DayHeader key={d.key}>
                        <div>{d.weekday}</div>
                        <DateSub>{d.dateLabel}</DateSub>
                      </DayHeader>
                    ))}
                  </HeaderRow>
                </Head>
                <Body>
                  {schedule.rows.map((r) => (
                    <TRow key={r.agentId}>
                      <StickyCell>{r.agentId}</StickyCell>
                      <IdentityCell>{r.name}</IdentityCell>
                      <IdentityCell>{r.email}</IdentityCell>
                      {schedule.days.map((d) => (
                        <DayCell key={d.key}>{r.cells[d.key] || ''}</DayCell>
                      ))}
                    </TRow>
                  ))}
                </Body>
              </WideTable>
            </TableScroll>
          </PreviewCol>
        </PreviewRow>
      )}
    </GridContainer>
  )
}

// display: grid with an implicit `auto` track sizes the whole container to its
// widest child (the table), which leaks horizontal overflow up to the body.
// minmax(0, 1fr) caps the track so it never exceeds the available width.
const GridContainer = styled(Grid)`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: ${(props) => props.theme.space.sm};
  padding: ${(props) => props.theme.space.md};
  width: 100%;
  max-width: 100%;
`

// Flex/grid children default to min-width: auto and refuse to shrink below
// their content, so the wide table would push these ancestors (and the whole
// app) wider than the viewport. min-width: 0 lets them shrink so the overflow
// is trapped inside TableScroll rather than scrolling the body.
const PreviewRow = styled(Row)`
  min-width: 0;
`

const PreviewCol = styled(Col)`
  min-width: 0;
`

const ButtonBar = styled.div`
  display: flex;
  justify-content: center;
  gap: ${(props) => props.theme.space.sm};
`

// The two schedule-version radios laid out horizontally.
const ModeOptions = styled.div`
  display: flex;
  gap: ${(props) => props.theme.space.md};
  margin-top: ${(props) => props.theme.space.xs};
`

// Small explanatory line under the version radios; reflects the active choice.
const ModeHint = styled.div`
  margin-top: ${(props) => props.theme.space.xs};
  color: ${(props) => props.theme.palette.grey[600]};
  font-size: ${(props) => props.theme.fontSizes.sm};
`

// The two range inputs side by side; the calendar opens below them as a popup.
const DateInputs = styled.div`
  display: flex;
  gap: ${(props) => props.theme.space.sm};
`

// Fixed-height scroll viewport: both scrollbars live inside this box, so the
// horizontal bar stays reachable and the table never grows the page past this
// height regardless of row count.
const TableScroll = styled.div`
  overflow: auto;
  max-width: 100%;
  height: 600px;
  border: ${(props) => props.theme.borders.sm} ${(props) => props.theme.palette.grey[300]};
  border-radius: ${(props) => props.theme.borderRadii.md};
`

// A horizontal-only scrollbar above the table, synced with TableScroll so the
// user can scroll the columns from the top as well as the bottom.
const TopScrollbar = styled.div`
  overflow-x: auto;
  overflow-y: hidden;
  max-width: 100%;
  margin-top: ${(props) => props.theme.space.sm};
`

// Zero-height spacer whose width is set to the table's scrollWidth (inline), so
// the top scrollbar exposes the same horizontal scroll range as the table.
const TopScrollSpacer = styled.div`
  height: 1px;
`

// Garden's Table defaults to table-layout: fixed + width: 100%, which crushes
// 30+ day columns on top of each other. Switch to auto layout so each column
// takes its natural width and the container scrolls horizontally instead.
const WideTable = styled(Table)`
  table-layout: auto;
  width: auto;
  min-width: 100%;
`

const DateSub = styled.div`
  font-weight: ${(props) => props.theme.fontWeights.regular};
  color: ${(props) => props.theme.palette.grey[600]};
  font-size: ${(props) => props.theme.fontSizes.sm};
`

// Header cells stick to the top so they stay visible while scrolling the
// (height-capped) table vertically.
const stickyTopHeader = (props) => `
  position: sticky;
  top: 0;
  white-space: nowrap;
  background: ${props.theme.palette.grey[100]};
  z-index: 1;
`

// Day columns: keep each cell on one line and wide enough for "09:00-17:00".
const DayHeader = styled(HeaderCell)`
  ${stickyTopHeader}
  min-width: 96px;
`

const DayCell = styled(Cell)`
  white-space: nowrap;
  min-width: 96px;
`

const IdentityHeader = styled(HeaderCell)`
  ${stickyTopHeader}
  min-width: 140px;
`

const IdentityCell = styled(Cell)`
  white-space: nowrap;
  min-width: 140px;
`

// Top-left corner: sticky on both axes, so it pins over both the header row
// and the agentId column. Higher z-index keeps it above the other sticky cells.
const StickyHeader = styled(HeaderCell)`
  position: sticky;
  top: 0;
  left: 0;
  white-space: nowrap;
  min-width: 120px;
  background: ${(props) => props.theme.palette.grey[100]};
  z-index: 2;
`

const StickyCell = styled(Cell)`
  position: sticky;
  left: 0;
  white-space: nowrap;
  min-width: 120px;
  background: ${(props) => props.theme.colors.background};
  z-index: 1;
`

export default NavBar
