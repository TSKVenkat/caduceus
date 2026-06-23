# Roadmap

Planned work, not yet implemented.

## Next

- Dangerous-command approval. Gate risky shell commands (recursive delete,
  piping a download into a shell, writes to system paths, credential access).
  Prompt for confirmation in the interactive terminal UI; configurable
  allow/block when running non-interactively.
- Planning tool. A lightweight task-list tool so the agent decomposes and
  tracks multi-step work, improving coherence on long tasks.
- Git-aware tools. First-class `git_status` and `git_diff` tools so the agent
  works from diffs instead of re-reading whole files.

## Later

- Per-turn tool-output budgeting (aggregate cap across a turn, on top of the
  current per-result truncation).
- Reasoning-trace preservation across turns for extended-thinking models.
