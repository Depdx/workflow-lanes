import type { LaneAgent, LaneStatus, RunHistory, RunStatus, WorkflowRun } from '../types'

export type PhaseRow = {
  title: string
  status: LaneStatus | 'pending'
  done: number
  agents: LaneAgent[]
  startedAt?: number
  endedAt?: number
}

/** How many earlier runs the running average weighs before the newest. */
const HISTORY_WEIGHT = 4

export type Ending = { status: RunStatus; tokens?: number; durationMs?: number }

const OTHER_PHASE = 'Other'

/** Agents from journal.jsonl, keyed by the journal's call key; a torn last line is skipped. */
export function parseJournal(text: string): LaneAgent[] {
  const byKey = new Map<string, LaneAgent>()

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let entry: { type?: string; key?: string; label?: string; phase?: string; result?: unknown }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (!entry.key) continue

    if (entry.type === 'started') {
      byKey.set(entry.key, {
        key: entry.key,
        label: entry.label ?? 'agent',
        phase: entry.phase ?? OTHER_PHASE,
        status: 'running',
      })
    } else if (entry.type === 'result') {
      const agent = byKey.get(entry.key)
      if (agent) {
        byKey.set(entry.key, { ...agent, status: entry.result === null ? 'failed' : 'done' })
      }
    }
  }

  return [...byKey.values()]
}

/** Phase titles declared in the script's `meta.phases`, in order. */
export function parsePhases(script: string): string[] {
  const block = /phases\s*:\s*\[([\s\S]*?)\]/.exec(script)?.[1] ?? ''

  return [...block.matchAll(/title\s*:\s*(['"`])(.*?)\1/g)].map(match => match[2] ?? '')
}

/** The run's ending, when `text` is the task notification for `taskId`. */
export function parseEnding(text: string, taskId: string): Ending | null {
  if (!text.includes(`<task-id>${taskId}</task-id>`)) return null

  const tag = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(text)?.[1]
  const raw = tag('status')
  const status: RunStatus = raw === 'completed' ? 'done' : raw === 'killed' ? 'killed' : 'failed'
  const tokens = Number(tag('subagent_tokens'))
  const durationMs = Number(tag('duration_ms'))

  return {
    status,
    tokens: Number.isFinite(tokens) && tokens > 0 ? tokens : undefined,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : undefined,
  }
}

/** One row per phase, script order first, then phases only the journal names. */
export function phaseRows(run: WorkflowRun): PhaseRow[] {
  const titles = [...run.phases]
  for (const agent of run.agents) {
    if (!titles.includes(agent.phase)) titles.push(agent.phase)
  }

  return titles.map(title => {
    const agents = run.agents.filter(agent => agent.phase === title)
    const done = agents.filter(agent => agent.status === 'done').length
    const status: PhaseRow['status'] =
      agents.length === 0
        ? 'pending'
        : agents.some(agent => agent.status === 'running')
          ? 'running'
          : agents.some(agent => agent.status === 'failed')
            ? 'failed'
            : 'done'

    const starts = agents.flatMap(agent => (agent.startedAt === undefined ? [] : [agent.startedAt]))
    const ends = agents.flatMap(agent => (agent.endedAt === undefined ? [] : [agent.endedAt]))
    const isSettled = status === 'done' || status === 'failed'

    return {
      title,
      status,
      done,
      agents,
      startedAt: starts.length > 0 ? Math.min(...starts) : undefined,
      endedAt: isSettled && ends.length > 0 ? Math.max(...ends) : undefined,
    }
  })
}

/** The freshly parsed agents, stamped with when the poller first saw each start and end. */
export function stampAgents(previous: LaneAgent[], parsed: LaneAgent[], at: number): LaneAgent[] {
  return parsed.map(agent => {
    const before = previous.find(one => one.key === agent.key)
    const startedAt = before?.startedAt ?? at
    const endedAt = agent.status === 'running' ? undefined : (before?.endedAt ?? at)

    return { ...agent, startedAt, endedAt }
  })
}

/** Milliseconds a phase has run (or ran), or undefined before it starts. */
export function phaseElapsed(row: PhaseRow, at: number): number | undefined {
  return row.startedAt === undefined ? undefined : (row.endedAt ?? at) - row.startedAt
}

/** Estimated milliseconds left in the run, or undefined with no history. */
export function remainingMs(rows: PhaseRow[], estimate: RunHistory | undefined, at: number): number | undefined {
  if (!estimate) return undefined

  return rows.reduce((sum, row) => {
    const expected = estimate.phaseMs[row.title] ?? 0
    if (row.status === 'pending') return sum + expected
    if (row.status === 'running') return sum + Math.max(0, expected - (phaseElapsed(row, at) ?? 0))
    return sum
  }, 0)
}

/** History after one more finished run: a running average over the last few. */
export function addToHistory(history: RunHistory | undefined, rows: PhaseRow[], totalMs: number): RunHistory {
  const weight = Math.min(history?.count ?? 0, HISTORY_WEIGHT)
  const blend = (old: number | undefined, fresh: number) =>
    old === undefined ? fresh : Math.round((old * weight + fresh) / (weight + 1))

  const phaseMs = { ...(history?.phaseMs ?? {}) }
  for (const row of rows) {
    const ran = row.startedAt !== undefined && row.endedAt !== undefined ? row.endedAt - row.startedAt : undefined
    if (ran !== undefined) phaseMs[row.title] = blend(phaseMs[row.title], ran)
  }

  return { count: (history?.count ?? 0) + 1, totalMs: blend(history?.totalMs, totalMs), phaseMs }
}

/** A stored history, or undefined when the store holds something else. */
export function asHistory(value: unknown): RunHistory | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { count, totalMs, phaseMs } = value as Partial<RunHistory>
  if (typeof count !== 'number' || typeof totalMs !== 'number' || typeof phaseMs !== 'object' || phaseMs === null) {
    return undefined
  }

  return { count, totalMs, phaseMs }
}

export function progressBar(done: number, total: number, cells = 10): string {
  const filled = total === 0 ? 0 : Math.round((done / total) * cells)

  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

export function formatSeconds(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))

  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, '0')}s`
}

export function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k tok` : `${tokens} tok`
}
