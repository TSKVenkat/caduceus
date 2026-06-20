---
name: summarize-diff
description: Summarize the current git changes into a concise, reviewer-friendly overview grouped by theme.
---

# Summarize diff

When asked to summarize the current changes:

1. Run `git diff --stat` and `git diff` with the bash tool. Use `git diff --cached` if the user asks about staged changes.
2. Group the changes by theme: feature, fix, refactor, tests, docs, chore.
3. For each group, write one short bullet describing what changed and why it matters.
4. Call out anything risky: deleted files, changed public APIs, new dependencies, or leftover TODOs.
5. Keep the summary under ~150 words unless the user asks for more detail.
