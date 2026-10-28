import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer, ToolCallResult } from 'claude-code'

import type { WorkflowRun } from '../types'
import { addToHistory, asHistory, parseEnding, parseJournal, parsePhases, phaseRows, stampAgents } from './journal'
import { bandTree, paneTree, widthFor } from './view'
import type { Actions } from './view'

const PANE = 'workflows'
const POLL_MS = 1000
const MAX_RUNS = 20

// Bump the shape tag when WorkflowRun changes: older stored values are declined.
const runs = atom({ plugin: 'workflow-lanes', key: 'runs' } as const, [], { shape: 'runs-2' })
const now = atom({ plugin: 'workflow-lanes', key: 'now' } as const, 0)
const isBandHidden = atom({ plugin: 'workflow-lanes', key: 'isBandHidden' } as const, false)

type WorkflowLaunch = {
  runId?: string
  taskId?: string
  workflowName?: string
  transcriptDir?: string
  scriptPath?: string
}

let timer: Timer | undefined

const historyKey = (name: string) => `history:${name}`

function actionsFor($: EngineInterface): Actions {
  return {
    toggle: runId =>
      void update($, runs, current =>
        current.map(run => (run.runId === runId ? { ...run, isExpanded: !run.isExpanded } : run)),
      ),
    open: () => void $.ui.open({ id: PANE, title: 'Workflows' }),
    dismiss: () => void update($, isBandHidden, () => true),
  }
}

function ensurePolling($: EngineInterface): void {
  if (timer) return
  timer = $.clock.every(POLL_MS, () => void tick($))
}

async function readRun($: EngineInterface, run: WorkflowRun, at: number): Promise<WorkflowRun> {
  try {
    const agents = stampAgents(run.agents, parseJournal(await $.fs.read(run.journalPath)), at)
    return { ...run, agents, readError: undefined }
  } catch (error) {
    return { ...run, readError: String(error) }
  }
}

// Re-reads every running run's journal; stops itself once nothing runs.
async function tick($: EngineInterface): Promise<void> {
  const list = await read($, runs)
  const running = list.filter(run => run.status === 'running')
  if (running.length === 0) {
    timer?.cancel()
    timer = undefined
    return
  }

  const at = await $.clock.now()
  const fresh = await Promise.all(running.map(run => readRun($, run, at)))
  await update($, runs, current =>
    current.map(run => {
      const got = fresh.find(one => one.runId === run.runId)
      return got ? { ...run, agents: got.agents, readError: got.readError } : run
    }),
  )
  await update($, now, () => at)
}

async function recordLaunch($: EngineInterface, launch: WorkflowLaunch): Promise<void> {
  const { runId, taskId, transcriptDir, scriptPath } = launch
  if (!runId || !taskId || !transcriptDir) return

  const script = scriptPath ? await $.fs.read(scriptPath).catch(() => '') : ''
  const name = launch.workflowName ?? runId
  const run: WorkflowRun = {
    runId,
    taskId,
    name,
    estimate: asHistory(await $.store.get(historyKey(name))),
    journalPath: `${transcriptDir}/journal.jsonl`,
    phases: parsePhases(script),
    agents: [],
    status: 'running',
    startedAt: await $.clock.now(),
    isExpanded: false,
  }
  await update($, runs, list => [...list.filter(one => one.runId !== runId), run].slice(-MAX_RUNS))
  await update($, isBandHidden, () => false)
  ensurePolling($)
}

// The task notification is the only end marker: the journal has none.
async function recordEndings($: EngineInterface, text: string): Promise<void> {
  const list = await read($, runs)
  const endings = list
    .filter(run => run.status === 'running')
    .map(run => ({ runId: run.runId, ending: parseEnding(text, run.taskId) }))
  if (!endings.some(one => one.ending)) return

  await tick($)
  const at = await $.clock.now()
  const ended = await update($, runs, current =>
    current.map(run => {
      const ending = endings.find(one => one.runId === run.runId)?.ending
      if (!ending) return run
      return {
        ...run,
        status: ending.status,
        tokens: ending.tokens,
        endedAt: ending.durationMs ? run.startedAt + ending.durationMs : at,
      }
    }),
  )

  // Only clean runs teach the estimate; a failed or killed one would skew it.
  for (const run of ended) {
    const isNew = endings.some(one => one.runId === run.runId && one.ending?.status === 'done')
    if (!isNew || run.endedAt === undefined) continue
    const key = historyKey(run.name)
    const history = addToHistory(asHistory(await $.store.get(key)), phaseRows(run), run.endedAt - run.startedAt)
    await $.store.set(key, history)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'workflow-lanes',
      description: 'Show the workflow runs of this session, phase by phase',
      immediate: true,
    })
    if ((await read($, runs)).some(run => run.status === 'running')) ensurePolling($)

    return next(e)
  })

  on('command.run', { command: 'workflow-lanes' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Workflows' })

    // No text: a transcript line would reach the model and cost tokens.
    return {}
  })

  // The Workflow tool answers at launch with the run's id, task id and paths.
  on('tool.call', { tool: 'Workflow' }, async ($, e, next): Promise<ToolCallResult<'Workflow'>> => {
    const ran: ToolCallResult<'Workflow'> = await next(e)
    if (ran.result) await recordLaunch($, ran.result as WorkflowLaunch)

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    await recordEndings($, e.text)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, runs)
    const live = list.filter(run => run.status === 'running')
    const latest = live.at(-1) ?? list.at(-1)
    if (e.props.hasSurvey || !latest || (latest.status !== 'running' && (await read($, isBandHidden)))) {
      return next(e)
    }

    return bandTree($.ui.resolve(e), latest, Math.max(0, live.length - 1), await read($, now), actionsFor($))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const list = await read($, runs)

    return paneTree($.ui.resolve(e), list, await read($, now), widthFor(e.props.bodyColumns), actionsFor($))
  })
}
