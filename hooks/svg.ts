import type { LaneAgent, WorkflowRun } from '../types'
import { formatSeconds } from './journal'
import type { PhaseRow } from './journal'

// Every fill and stroke here holds ≥3:1 (WCAG 1.4.11) against VS Code's dark
// (#181818, #1f1f1f) and light (#ffffff, #f8f8f8) editor backgrounds.
// Status is never colour alone: done is solid, running is striped, failed is
// cross-hatched, an estimate is a dashed outline. Nothing moves (WCAG 2.2.2).
export const PALETTE = {
  running: '#3b82f6',
  done: '#16a34a',
  failed: '#e5484d',
  neutral: '#868686',
} as const

const ROW = 6
const ROW_GAP = 3
const PAD = 2
const MIN_BAR = 3

/** The time window every lane of one run is drawn against. */
export type Scale = { from: number; to: number; width: number; now: number; isLive: boolean }

const DEFS = `<defs>
<pattern id="stripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
<rect width="6" height="6" fill="${PALETTE.running}"/><rect width="2.5" height="6" fill="#ffffff" fill-opacity="0.45"/>
</pattern>
<pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse">
<rect width="5" height="5" fill="${PALETTE.failed}"/><path d="M0 0L5 5M5 0L0 5" stroke="#ffffff" stroke-opacity="0.6" stroke-width="1"/>
</pattern>
</defs>`

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, char => `&#${char.charCodeAt(0)};`)
}

function x(scale: Scale, at: number): number {
  const span = Math.max(1, scale.to - scale.from)

  return Math.min(scale.width, Math.max(0, ((at - scale.from) / span) * scale.width))
}

export const PROGRESS_HEIGHT = 8

/** A lane's height in px for `agents` stacked rows (at least one). */
export function laneHeight(agents: number): number {
  const slots = Math.max(1, agents)

  return PAD * 2 + slots * ROW + (slots - 1) * ROW_GAP
}

// preserveAspectRatio="none": the surface stretches the width to its slot,
// the height stays what the caller pins.
function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${DEFS}${body}</svg>`
}

function agentBar(scale: Scale, agent: LaneAgent, slot: number): string {
  if (agent.startedAt === undefined) return ''
  const end = agent.endedAt ?? scale.now
  const left = x(scale, agent.startedAt)
  const width = Math.max(MIN_BAR, x(scale, end) - left)
  const fill = agent.status === 'done' ? PALETTE.done : agent.status === 'failed' ? 'url(#hatch)' : 'url(#stripes)'
  const tip = escapeXml(`${agent.label}: ${agent.status}, ${formatSeconds(end - agent.startedAt)}`)

  return `<rect x="${left.toFixed(1)}" y="${PAD + slot * (ROW + ROW_GAP)}" width="${width.toFixed(1)}" height="${ROW}" rx="3" fill="${fill}"><title>${tip}</title></rect>`
}

function ghostRect(scale: Scale, height: number, ghost: { start: number; ms: number }): string {
  const left = x(scale, ghost.start)
  const width = Math.max(MIN_BAR, x(scale, ghost.start + ghost.ms) - left)

  return `<rect x="${left.toFixed(1)}" y="1" width="${width.toFixed(1)}" height="${height - 2}" rx="3" fill="none" stroke="${PALETTE.neutral}" stroke-width="1.5" stroke-dasharray="4 3"><title>Estimated ${formatSeconds(ghost.ms)}</title></rect>`
}

/** One phase lane: a bar per agent on the run's time axis, one row each so overlap shows. */
export function laneSvg(scale: Scale, row: PhaseRow, ghost?: { start: number; ms: number }): string {
  const height = laneHeight(row.agents.length)
  const track = `<rect width="${scale.width}" height="${height}" rx="4" fill="${PALETTE.neutral}" fill-opacity="0.14"/>`
  const bars = row.agents.map((agent, slot) => agentBar(scale, agent, slot)).join('')
  const nowAt = x(scale, scale.now).toFixed(1)
  const nowLine = scale.isLive
    ? `<line x1="${nowAt}" x2="${nowAt}" y1="0" y2="${height}" stroke="${PALETTE.neutral}" stroke-width="1.5"/>`
    : ''

  return svg(scale.width, height, track + (ghost ? ghostRect(scale, height, ghost) : '') + bars + nowLine)
}

/** The run's overall bar: share of the estimated (or agent) total done. */
export function progressSvg(width: number, share: number, status: WorkflowRun['status']): string {
  const height = PROGRESS_HEIGHT
  const fill = status === 'done' ? PALETTE.done : status === 'running' ? 'url(#stripes)' : 'url(#hatch)'
  const filled = Math.max(share > 0 ? MIN_BAR : 0, Math.min(1, share) * width)

  return svg(
    width,
    height,
    `<rect width="${width}" height="${height}" rx="4" fill="${PALETTE.neutral}" fill-opacity="0.22"/>` +
      `<rect width="${filled.toFixed(1)}" height="${height}" rx="4" fill="${fill}"/>`,
  )
}
