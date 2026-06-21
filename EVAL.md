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

## Result 3 — Head-to-head vs Aider (same model, same tasks)

We ran [Aider](https://github.com/Aider-AI/aider) 0.86 against the identical task suite and hidden verifiers, on the same model (`qwen3-coder:480b-cloud` via Ollama Cloud). Reproduce with `bash eval/compare-aider.sh`.

**Standard suite (10 tasks):**

| Agent | resolve rate | speed |
| --- | --- | --- |
| Aider | **10/10** | faster (~5–16 s/task; single-shot edits) |
| Caduceus | **10/10** | slower (~5–30 s/task; multi-step ReAct loop) |

On standard tasks the two are at **parity on success**, and Aider is **faster** — its mature single-message edit format makes fewer round-trips than our ReAct tool loop. Caduceus is competitive here, not better; the loop has efficiency headroom.

**Convention tasks (knowledge in an OKF bundle, not the prompt):**

| Agent | resolve rate |
| --- | --- |
| Aider | **0/2** |
| Caduceus, no knowledge | **0/6** |
| Caduceus + OKF knowledge | **6/6 (2/2 tasks, 3 attempts each)** |

Aider has no mechanism to consult a curated knowledge store, so it fails exactly as Caduceus does *without* its knowledge layer. **The OKF knowledge layer is a real, differentiating capability: it solves tasks a leading open coding agent cannot, on the same model.**

### Honest takeaway

Caduceus matches Aider on standard coding tasks but is slower; its distinctive value is the OKF knowledge layer, which turns project-convention tasks from unsolvable (0%) into reliably solvable (100%). The clear next engineering win is reducing round-trips to close the speed gap.

## Result 4 — Convention benchmark at scale (the strong version)

The Result 2/3 ablation used only 2 tasks — too small to trust. This is the scaled, statistically meaningful version. `eval/generate-conventions.mjs` machine-generates **12 convention tasks**, each with an arbitrary string rule the model cannot guess (e.g. "lowercase and replace every vowel with `*`", "reverse the characters and wrap in angle brackets"). Each rule is documented **only** in an OKF concept, and each verifier checks **held-out inputs** different from the examples in the concept, so neither guessing nor memorizing the examples works. We run every task **3 times** under three conditions (`bash eval/run-full.sh`):

| Condition | Resolve rate | 95% CI (Wilson) |
| --- | --- | --- |
| Aider 0.86 | **0/36 = 0.0%** | [0.0%, 9.6%] |
| Caduceus, knowledge **off** | **1/36 = 2.8%** | [0.5%, 14.2%] |
| Caduceus, **OKF knowledge on** | **36/36 = 100.0%** | [90.4%, 100%] |

The one no-knowledge pass was `conv-count-prefix` (its rule — prefix the length and a colon — is the most guessable). The confidence intervals do **not overlap**, and a Fisher's exact test (36/36 vs 0/36) gives p ≪ 0.0001: the effect is real, not noise.

**Conclusion (the defensible claim):** across 108 controlled runs, the OKF knowledge layer takes project-convention tasks from ~0% (Aider, and Caduceus without it) to **100%**. The agent itself is not magic — *with the feature off it fails just like Aider does* — which is exactly what isolates the knowledge layer as the cause. With knowledge on, it solves each task in ~12.5 s and ~9.7k tokens on average.

Reproduce end to end: `node eval/generate-conventions.mjs && bash eval/run-full.sh`.

## Limitations (honest)

- Tasks are synthetic (controlled, generated) rather than scraped from real repos; this is not a public benchmark like SWE-bench Verified.
- Single model (`qwen3-coder:480b-cloud`); results may differ on other models.
- The convention claim is now well-powered (12 tasks x 3 trials x 3 conditions, non-overlapping CIs), but the standard-suite parity-with-Aider claim is still a single pass over 10 tasks, and Aider remains faster there (our ReAct loop makes more round-trips).

## Next

1. A long-horizon, multi-file suite where the **context compaction** layer can be ablated the same way.
2. A small **SWE-bench Verified** subset for a publicly comparable number.
3. A same-model comparison against an existing open coding agent.
