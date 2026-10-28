import { expect, test } from 'claude-code/testing'

import type { LaneAgent, WorkflowRun } from '../types'
import { addToHistory, asHistory, phaseRows, remainingMs, stampAgents } from '../hooks/journal'

const agent = (key: string, phase: string, status: LaneAgent['status'], startedAt?: number, endedAt?: number): LaneAgent =>
  ({ key, label: key, phase, status, startedAt, endedAt })

const run = (agents: LaneAgent[]): WorkflowRun => ({
  runId: 'wf_1', taskId: 't1', name: 'w', journalPath: '/j', phases: ['A', 'B', 'C'],
  agents, status: 'running', startedAt: 0, isExpanded: false,
})

test('an agent keeps the time it was first seen to start and end', async () => {
  const first = stampAgents([], [agent('k', 'A', 'running')], 1000)
  const later = stampAgents(first, [agent('k', 'A', 'done')], 5000)
  const again = stampAgents(later, [agent('k', 'A', 'done')], 9000)
  expect([again[0]?.startedAt, again[0]?.endedAt]).toEqual([1000, 5000])
})

test('a phase spans its first start to its last end', async () => {
  const rows = phaseRows(run([agent('a1', 'A', 'done', 0, 10_000), agent('a2', 'A', 'done', 0, 20_000)]))
  expect([rows[0]?.startedAt, rows[0]?.endedAt]).toEqual([0, 20_000])
})

test('time left adds what the running phase lacks and every pending phase', async () => {
  const rows = phaseRows(run([agent('a', 'A', 'done', 0, 20_000), agent('b', 'B', 'running', 20_000)]))
  const estimate = { count: 1, totalMs: 60_000, phaseMs: { A: 20_000, B: 30_000, C: 10_000 } }
  expect(remainingMs(rows, estimate, 30_000)).toBe(20_000 + 10_000)
  expect(remainingMs(rows, undefined, 30_000)).toBe(undefined)
})

test('history averages over runs and skips phases that never ran', async () => {
  const rows = phaseRows(run([agent('a', 'A', 'done', 0, 20_000)]))
  const one = addToHistory(undefined, rows, 20_000)
  const two = addToHistory(one, phaseRows(run([agent('a', 'A', 'done', 0, 40_000)])), 40_000)
  expect(one.phaseMs).toEqual({ A: 20_000 })
  expect([two.count, two.phaseMs.A, two.totalMs]).toEqual([2, 30_000, 30_000])
})

test('a stored value of another shape is no history', async () => {
  expect(asHistory({ count: 'x' })).toBe(undefined)
  expect(asHistory(null)).toBe(undefined)
})
