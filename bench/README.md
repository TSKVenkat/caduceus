# Benchmark: does the scaffold help?

A small, fair, reproducible benchmark. It does **not** try to show Caduceus is the
best coding agent. It asks one honest question: **on the same model, does the
Caduceus scaffold (loop + tools + verification) do things a single model call
cannot — and where does it merely add overhead?**

## Why this design

The research standard for evaluating agents is: hold the model and environment
fixed, and vary only the scaffold (mean pass@1 across identical conditions).
Full SWE-bench Verified follows this but needs a Docker image per task instance,
which isn't feasible on every machine. This harness applies the same principle
locally, at small scale.

Two conditions, **same model** (`qwen3-coder:480b-cloud` on Ollama Cloud):

- **raw** — one model call. It is given the task **and all relevant file
  contents inlined** (equal information — no missing-file confound). It cannot
  run code, read the filesystem, or iterate.
- **caduceus** — the full agent: it reads files, runs commands, checks its work,
  and self-corrects within a step budget.

Every task is scored by a hidden `verify.sh` that exits 0 (pass) or non-zero
(fail). No human judgement.

## Task spread (honest, not cherry-picked)

| Category | Tasks | What it probes |
| --- | --- | --- |
| self-contained | fizzbuzz, anagrams | pure codegen — both conditions should do fine |
| repo-grounded | use-helper | must use an existing function correctly |
| debug | fix-bug | fix code so a failing test passes |
| execution | sha256, count-errors | needs *running* code, not predicting text |

The self-contained and debug tasks are controls: if the scaffold "wins"
everywhere, the suite is rigged. The execution tasks are where an agent that can
actually run commands should pull ahead of a model that can only guess.

## Run it

```bash
pnpm build                 # ensure dist/cli.js exists
node bench/run.mjs         # all tasks; writes bench/results.json
node bench/run.mjs 05-sha256   # a single task
```

Requires `OLLAMA_API_KEY` in `.env`. Results (pass/fail, tokens, steps, seconds)
are written to `bench/results.json`.

## How to read the result

- A **tie** on self-contained/debug tasks is the expected, honest outcome — and
  Caduceus pays for it in tokens (the scaffold's overhead is real).
- The **execution** tasks are the justification: a single model call cannot
  compute a SHA-256 or reliably count matches; an agent that runs `sha256sum` /
  `grep` can. That capability gap — not a leaderboard score — is what the
  scaffold buys.

This is a capability demonstration on a small suite, not a ranking. Scale it up
by adding tasks under `bench/tasks/<id>/` (a `spec.json`, an optional
`workspace/`, and a `verify.sh`).
