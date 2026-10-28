import { expect, test } from 'claude-code/testing'

import type { WorkflowRun } from '../types'
import { parseEnding, parseJournal, parsePhases, phaseRows, progressBar } from '../hooks/journal'
import { JOURNAL } from './fixture'

const SCRIPT = `export const meta = {
  name: 'lanes-smoke-test',
  phases: [
    { title: 'Fan-out', detail: 'x' },
    { title: "Pipeline" },
    { title: 'Synthesize' },
  ],
}`

const run = (journal: string): WorkflowRun => ({
  runId: 'wf_1', taskId: 't1', name: 'lanes-smoke-test', journalPath: '/j',
  phases: parsePhases(SCRIPT), agents: parseJournal(journal),
  status: 'running', startedAt: 0, isExpanded: false,
})

test('a finished journal gives 8 done agents with their labels and phases', async () => {
  const agents = parseJournal(JOURNAL)
  expect(agents.length).toBe(8)
  expect(agents.every(agent => agent.status === 'done')).toBe(true)
  expect(agents.map(agent => agent.label)).toContain('alpha stage 2')
})

test('phases keep script order and show pending ones before they start', async () => {
  const partial = JOURNAL.split('\n').slice(0, 9).join('\n') + '\n{"type":"start'
  const rows = phaseRows(run(partial))
  expect(rows.map(row => `${row.title}:${row.status}:${row.done}/${row.agents.length}`))
    .toEqual(['Fan-out:done:3/3', 'Pipeline:running:0/2', 'Synthesize:pending:0/0'])
})

test('a null result marks the agent failed', async () => {
  const agents = parseJournal('{"type":"started","key":"k","label":"a","phase":"P"}\n{"type":"result","key":"k","result":null}')
  expect(agents[0]?.status).toBe('failed')
})

test('the task notification ends only its own run', async () => {
  const text = '<task-notification><task-id>t1</task-id><status>completed</status><usage><subagent_tokens>508284</subagent_tokens><duration_ms>55229</duration_ms></usage></task-notification>'
  expect(parseEnding(text, 't1')).toEqual({ status: 'done', tokens: 508284, durationMs: 55229 })
  expect(parseEnding(text, 't2')).toBe(null)
})

test('the progress bar fills by share done', async () => {
  expect(progressBar(3, 8, 8)).toBe('▰▰▰▱▱▱▱▱')
  expect(progressBar(0, 0, 4)).toBe('▱▱▱▱')
})
