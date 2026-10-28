# workflow-lanes

A Claude Code mod that shows your workflow runs while they work: a one-line status above the prompt, and a **Workflows** pane with each run phase by phase.

- **Above the prompt:** the live run's name, a progress bar, the current phase and the time (`Chain (2/3) · 47s of ~1m05s`), with **Open**. When the run ends: done, failed or stopped, agents, duration and tokens, with **Dismiss**.
- **The pane:** one card per run, a line per phase in script order (✓ done, ● running, ○ waiting) with its agent count and time.
- **Details:** a timeline lane per phase on one shared time axis. Agents that run in parallel stack; a pipeline stage starts where the one before it ended; a dashed box marks the estimate and a line marks now. Every agent is listed with its duration.
- **Estimates:** from the second run of a workflow (by its `meta.name`), each phase and the whole run show `elapsed of ~estimate`, averaged over the last five clean runs.
- **Earlier runs** fold into a list with their start time; a click opens one.
- `/workflow-lanes` opens the pane.

## Install

At the prompt of a terminal session:

```
/plugin install workflow-lanes --marketplace Depdx/workflow-lanes
```

From a shell:

```
claude plugin install workflow-lanes --marketplace Depdx/workflow-lanes
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `Depdx/workflow-lanes`, then Add plugin.

## How it works

- When the `Workflow` tool launches a run, the mod reads the run's `journal.jsonl` once a second while it runs: each agent's label, phase, start and result. Phase titles come from the script's `meta.phases`.
- The run ends when its task notification arrives, which also gives its duration and tokens.
- Times are when the mod first saw an agent start and end, so they are within about a second.
- Phase averages are kept per workflow name in the mod's store, across sessions.

It adds nothing to what the model reads: no prompt section, tool or model call, and `/workflow-lanes` prints no transcript line.

## Accessibility

- Text uses the editor theme's own colours, never dimmed; hierarchy comes from size and weight.
- Status is never colour alone: each line carries a symbol and a word, and in the lanes done is solid, running striped, failed cross-hatched and an estimate dashed.
- Every graphic colour holds at least 3:1 against VS Code's dark and light backgrounds (WCAG 1.4.11).
- Each graphic has a text alternative; hovering a bar names the agent and its time.
- Nothing animates.

## Limits

- The journal does not say which agent feeds which, so the lanes show order in time, not arrows between agents.
- Agents a remote workflow runs are not in the local journal.
- An estimate is an average of earlier runs: a workflow whose work varies a lot from run to run gets a rough one.
- Surfaces without graphics (the terminal) show a text bar and no lanes.

## Develop

```
claude plugin validate .
claude plugin test .
```
