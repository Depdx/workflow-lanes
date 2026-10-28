import type { ElementTable } from 'claude-code'

import type { RunHistory, WorkflowRun } from '../types'
import { formatSeconds, formatTokens, phaseElapsed, phaseRows, progressBar, remainingMs } from './journal'
import type { PhaseRow } from './journal'
import { laneHeight, laneSvg, PROGRESS_HEIGHT, progressSvg } from './svg'
import type { Scale } from './svg'

// Text keeps the theme's own colours: no dimColor, so every word holds the
// editor's contrast. Meaning sits in words and symbols, colour only repeats it.
const STATUS = {
  running: { mark: '●', word: 'Running', color: 'claude' },
  done: { mark: '✓', word: 'Done', color: 'success' },
  failed: { mark: '✗', word: 'Failed', color: 'error' },
  killed: { mark: '■', word: 'Stopped', color: 'warning' },
  pending: { mark: '○', word: 'Waiting', color: 'text' },
} as const

const PX_PER_COLUMN = 7
const MIN_WIDTH = 160
const MAX_WIDTH = 640
const BAND_BAR = 72

export type Actions = { toggle: (runId: string) => void; open: () => void; dismiss: () => void }

type Ghost = { start: number; ms: number } | undefined

export function widthFor(columns: number | undefined): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, (columns ?? 60) * PX_PER_COLUMN))
}

function clock(ms: number): string {
  const date = new Date(ms)

  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** Where each phase's dashed estimate sits: running ones from their start, pending ones queued after. */
function ghosts(rows: PhaseRow[], estimate: RunHistory | undefined, at: number): Ghost[] {
  let cursor = at
  return rows.map(row => {
    const ms = estimate?.phaseMs[row.title]
    if (!ms) return undefined
    if (row.status === 'running' && row.startedAt !== undefined) {
      cursor = Math.max(cursor, row.startedAt + ms)
      return { start: row.startedAt, ms }
    }
    if (row.status !== 'pending') return undefined
    const start = cursor
    cursor += ms
    return { start, ms }
  })
}

export function summarize(run: WorkflowRun, at: number) {
  const rows = phaseRows(run)
  const done = run.agents.filter(agent => agent.status === 'done').length
  const spent = (run.endedAt ?? at) - run.startedAt
  const left = run.status === 'running' ? remainingMs(rows, run.estimate, at) : undefined
  const current = rows.findIndex(row => row.status === 'running')
  const phaseAt = Math.max(0, current >= 0 ? current : rows.filter(row => row.status !== 'pending').length - 1)
  const share =
    run.status !== 'running'
      ? 1
      : left !== undefined
        ? spent / Math.max(1, spent + left)
        : done / Math.max(1, run.agents.length)
  const time = left === undefined ? formatSeconds(spent) : `${formatSeconds(spent)} of ~${formatSeconds(spent + left)}`

  return { rows, done, total: run.agents.length, phaseAt, share, time, left }
}

function phaseTime(row: PhaseRow, estimate: RunHistory | undefined, at: number): string {
  const spent = phaseElapsed(row, at)
  const expected = estimate?.phaseMs[row.title]
  if (spent === undefined) return expected ? `~${formatSeconds(expected)}` : ''
  if (row.status === 'running' && expected) return `${formatSeconds(spent)} of ~${formatSeconds(Math.max(expected, spent))}`

  return formatSeconds(spent)
}

function Bar(ui: ElementTable, width: number, share: number, run: WorkflowRun, alt: string) {
  if ('Svg' in ui) {
    const { Svg } = ui
    return <Svg source={progressSvg(width, share, run.status)} alt={alt} height={PROGRESS_HEIGHT} />
  }
  const { Text } = ui
  return <Text>{progressBar(Math.round(share * 100), 100)}</Text>
}

function AgentRow(ui: ElementTable, agent: WorkflowRun['agents'][number], at: number) {
  const { Box, Text } = ui
  const status = STATUS[agent.status]

  return (
    <Box key={agent.key} justifyContent="space-between" marginLeft={2}>
      <Box gap={1}>
        <Text color={status.color}>{status.mark}</Text>
        <Text wrap="truncate-end">{agent.label}</Text>
      </Box>
      <Text tabular>{agent.startedAt === undefined ? '' : formatSeconds((agent.endedAt ?? at) - agent.startedAt)}</Text>
    </Box>
  )
}

function Lane(ui: ElementTable, run: WorkflowRun, row: PhaseRow, scale: Scale, ghost: Ghost) {
  const { Box, Text } = ui
  const status = STATUS[row.status]
  const count = row.agents.length > 0 ? `${row.done}/${row.agents.length}` : ''
  const time = phaseTime(row, run.estimate, scale.now)
  const alt = [`${row.title}: ${status.word.toLowerCase()}`, count && `${count} agents done`, time].filter(Boolean).join(', ')

  return (
    <Box key={`${run.runId}-${row.title}`} flexDirection="column" marginTop={run.isExpanded ? 1 : 0}>
      <Box justifyContent="space-between">
        <Box gap={1}>
          <Text color={status.color}>{status.mark}</Text>
          <Text weight={row.status === 'running' ? 'semibold' : 'regular'} italic={row.status === 'pending'}>
            {row.title}
          </Text>
          {count !== '' && <Text tabular>{count}</Text>}
        </Box>
        <Text tabular>{time}</Text>
      </Box>
      {run.isExpanded && 'Svg' in ui && (
        <ui.Svg source={laneSvg(scale, row, ghost)} alt={alt} height={laneHeight(row.agents.length)} isInteractive />
      )}
      {run.isExpanded && row.agents.map(agent => AgentRow(ui, agent, scale.now))}
    </Box>
  )
}

function scaleFor(run: WorkflowRun, at: number, width: number, left: number | undefined): Scale {
  const end = run.status === 'running' ? at + (left ?? 0) : (run.endedAt ?? at)

  return { from: run.startedAt, to: Math.max(run.startedAt + 1000, end), width, now: at, isLive: run.status === 'running' }
}

function RunCard(ui: ElementTable, run: WorkflowRun, at: number, width: number, actions: Actions) {
  const { Box, Button, Text } = ui
  const view = summarize(run, at)
  const status = STATUS[run.status]
  const phase = view.rows[view.phaseAt]
  const lead =
    run.status === 'running' && phase
      ? `Phase ${view.phaseAt + 1} of ${view.rows.length}: ${phase.title}`
      : `${view.done}/${view.total} agents`
  const facts = [lead, view.time, run.tokens ? formatTokens(run.tokens) : '', `started ${clock(run.startedAt)}`]
  const scale = scaleFor(run, at, width, view.left)
  const places = run.status === 'running' ? ghosts(view.rows, run.estimate, at) : []
  const barAlt = `${status.word}, ${Math.round(view.share * 100)}% of the ${view.left === undefined ? 'agents so far' : 'estimated time'}`

  return (
    <Box key={run.runId} flexDirection="column" marginBottom={2}>
      <Box justifyContent="space-between">
        <Text weight="semibold" size="heading">
          {run.name}
        </Text>
        <Box gap={1}>
          <Text color={status.color}>{status.mark}</Text>
          <Text weight="medium">{status.word}</Text>
        </Box>
      </Box>
      <Text size="footnote">{facts.filter(Boolean).join(' · ')}</Text>
      {Bar(ui, width, view.share, run, barAlt)}
      {view.rows.map((row, index) => Lane(ui, run, row, scale, places[index]))}
      {run.readError && <Text color="error">Journal unreadable: {run.readError}</Text>}
      <Box marginTop={1}>
        <Button
          key={`toggle-${run.runId}`}
          plain
          label={run.isExpanded ? 'Hide details' : 'Details'}
          onPress={() => actions.toggle(run.runId)}
        />
      </Box>
    </Box>
  )
}

function EarlierRow(ui: ElementTable, run: WorkflowRun, at: number, actions: Actions) {
  const { Button } = ui
  const view = summarize(run, at)
  const status = STATUS[run.status]
  const facts = [clock(run.startedAt), view.time, run.tokens ? formatTokens(run.tokens) : ''].filter(Boolean).join(' · ')

  return (
    <Button
      key={`earlier-${run.runId}`}
      plain
      label={`${status.mark} ${run.name} — ${status.word}, ${facts}`}
      onPress={() => actions.toggle(run.runId)}
    />
  )
}

/** Live runs and the latest finished one in full; older ones as a list a press opens. */
export function paneTree(ui: ElementTable, list: WorkflowRun[], at: number, width: number, actions: Actions) {
  const { Box, Text } = ui
  if (list.length === 0) return <Text>No workflow runs yet. Start one and it shows here, phase by phase.</Text>

  const newestFirst = [...list].reverse()
  const latestDone = newestFirst.find(run => run.status !== 'running')
  const isFull = (run: WorkflowRun) => run.status === 'running' || run === latestDone || run.isExpanded
  const earlier = newestFirst.filter(run => !isFull(run))

  return (
    <Box flexDirection="column">
      {newestFirst.filter(isFull).map(run => RunCard(ui, run, at, width, actions))}
      {earlier.length > 0 && (
        <Box flexDirection="column">
          <Text weight="semibold">Earlier runs ({earlier.length})</Text>
          {earlier.map(run => EarlierRow(ui, run, at, actions))}
        </Box>
      )}
    </Box>
  )
}

/** One line above the prompt: the newest live run, else the newest finished one. */
export function bandTree(ui: ElementTable, run: WorkflowRun, others: number, at: number, actions: Actions) {
  const { Box, Button, Text } = ui
  const view = summarize(run, at)
  const status = STATUS[run.status]
  const phase = view.rows[view.phaseAt]
  const where = phase ? `${phase.title} (${view.phaseAt + 1}/${view.rows.length})` : 'Starting'
  const detail =
    run.status === 'running'
      ? `${where} · ${view.time}`
      : `${status.word} · ${view.done}/${view.total} agents · ${view.time}${run.tokens ? ` · ${formatTokens(run.tokens)}` : ''}`

  return (
    <Box gap={1} alignItems="center">
      <Text color={status.color}>{status.mark}</Text>
      <Text weight="semibold">{run.name}</Text>
      {Bar(ui, BAND_BAR, view.share, run, `${Math.round(view.share * 100)}% done`)}
      <Text>
        {detail}
        {others > 0 ? ` · +${others} more running` : ''}
      </Text>
      <Button key="open" variant="primary" label="Open" onPress={actions.open} />
      {run.status !== 'running' && <Button key="dismiss" role="dismiss" label="Dismiss" onPress={actions.dismiss} />}
    </Box>
  )
}
