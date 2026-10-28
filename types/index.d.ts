export type LaneStatus = 'running' | 'done' | 'failed'

export type RunStatus = 'running' | 'done' | 'failed' | 'killed'

export type LaneAgent = {
  key: string
  label: string
  phase: string
  status: LaneStatus
  /** When the poller first saw it start / end (ms epoch, ±1 poll). */
  startedAt?: number
  endedAt?: number
}

/** Average durations of earlier runs of one workflow name, from `$.store`. */
export type RunHistory = {
  count: number
  totalMs: number
  phaseMs: Record<string, number>
}

export type WorkflowRun = {
  runId: string
  taskId: string
  name: string
  journalPath: string
  /** Phase titles from the script's meta, in order; journal phases are appended. */
  phases: string[]
  agents: LaneAgent[]
  status: RunStatus
  startedAt: number
  endedAt?: number
  tokens?: number
  readError?: string
  estimate?: RunHistory
  isExpanded: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'workflow-lanes': {
      runs: Shaped<WorkflowRun[]>
      now: number
      isBandHidden: boolean
    }
  }
}
