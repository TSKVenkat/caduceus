# Roadmap

Planned work, not yet implemented.

## Later

- Per-turn tool-output budgeting (an aggregate cap across a turn, on top of the
  current per-result truncation).
- Reasoning-trace preservation across turns for extended-thinking models.

## Done

- Dangerous-command approval (`CADUCEUS_APPROVAL`): risky shell commands are
  classified and gated, with a prompt in the interactive UI and a configurable
  allow/deny when non-interactive.
- Planning tool (`update_plan`): the agent maintains an explicit task list for
  multi-step work.
- Git-aware tools (`git_status`, `git_diff`): the agent works from diffs instead
  of re-reading whole files.
