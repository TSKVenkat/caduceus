# Evaluation

How Caduceus is measured, and what the numbers say so far. Everything here is reproducible with `pnpm eval`; runs are live against Ollama Cloud (`qwen3-coder:480b-cloud` unless noted).

## Methodology

Tasks are data under `eval/tasks/<id>/`:

- `prompt.txt` — the instruction given to the agent.
- `workspace/` — files copied into a throwaway temp directory the agent edits.
- `verify.sh` — a checker run **outside** the agent's workspace (it never sees it, so it can't be gamed). Exit 0 = pass.
- `knowledge/` — optional OKF bundle, loaded only in the `--knowledge` ablation.

The runner (`eval/runner.ts`) isolates each task in a fresh temp dir, runs the real agent loop, then runs the verifier. It records resolve rate, steps, wall-clock seconds, and real token usage (captured from the API). Wall-clock is the honest cost proxy because Ollama Cloud bills by GPU-time, not tokens.

Reproduce:

```bash
pnpm eval                       # full suite, 1 attempt
pnpm eval --attempts 3 --task lru-cache
pnpm eval --task convention-id-prefix,convention-error-code --attempts 3 --knowledge
```

## Result 1 — Baseline suite saturates (and that's informative)

Ten self-contained coding tasks (fix a failing test, implement fizzbuzz, create a config file, fix a syntax error, rename a function across files, LRU cache, CSV parsing with quoted/escaped fields, an arithmetic-expression evaluator, multi-file bug tracing, a binary-search off-by-one):

```
Resolve rate: 10/10 = 100%   (qwen3-coder:480b-cloud, max-steps 15)
```

**Interpretation:** a strong open coder model plus a working scaffold saturates standard algorithmic and single-bug tasks. This confirms the loop, tools, and harness work end to end — but a benchmark everything passes does not *discriminate*, and it cannot show that any one feature matters. That motivates a controlled ablation.

## Result 2 — The OKF knowledge layer is the differentiator (measured)

Two tasks depend on a **project-specific convention the model cannot guess** (a user-id format, an error-code format). The convention lives **only** in an OKF concept — never in the workspace or a visible test. We run each task 3× with the knowledge layer off, then on.

| Variant | convention-id-prefix | convention-error-code | Resolve rate | Avg steps |
| --- | --- | --- | --- | --- |
| **No knowledge** | 0/3 | 0/3 | **0/6 = 0%** | 8.0 (hits cap) |
| **With OKF knowledge** | 3/3 | 3/3 | **6/6 = 100%** | 5.3 |

**Finding:** on convention-dependent tasks, the OKF knowledge layer raises the resolve rate from **0% to 100%**, and the agent also finishes in fewer steps (with knowledge it reads the concept and proceeds; without it, it wanders and usually exhausts the step budget). This is a clean, controlled demonstration that the knowledge layer changes outcomes — not just that a feature exists.

## Limitations (honest)

- Tasks are synthetic and small; this is not yet a public, comparable benchmark.
- No SWE-bench Verified subset and no head-to-head against another agent (e.g. Aider/opencode) yet — so we cannot yet claim Caduceus is *better* than alternatives, only that a specific feature measurably helps.
- Single model, low attempt counts (pass^k with k=3 on the ablation). Variance is under-characterized.

## Next

1. A long-horizon, multi-file suite where the **context compaction** layer can be ablated the same way.
2. A small **SWE-bench Verified** subset for a publicly comparable number.
3. A same-model comparison against an existing open coding agent.
