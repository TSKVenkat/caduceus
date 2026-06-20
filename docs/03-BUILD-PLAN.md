# Build Plan — Caduceus

Phased, executable plan to build the Hermes-based coding agent specified in `01-TECHNICAL-SPEC.md`. Each phase ships something runnable and ends with a measurable gate. Citations `[RR §n]` reference the research report.

---

## Stack decisions (resolving spec §9 open questions)

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Language | **Python 3.12** | Best ecosystem for vLLM/SGLang, FAISS, MCP, eval harnesses. |
| Base model (default) | **Hermes 4.3 36B** via vLLM | Hybrid reasoning + schema repair + cheap; auto tool-parser in vLLM `[RR §1]`. Keep an adapter so 70B/405B or any OpenAI-compatible endpoint drops in. |
| Serving | **vLLM** (SGLang fallback) | Native `<tool_call>` auto-parsing `[RR §1]`. |
| Vector store | **pgvector** (FAISS for local dev) | Multi-session, queryable, provenance columns for anti-poisoning `[RR §2]`. |
| Tool protocol | **MCP** + Hermes function-calling | Standardized integration `[RR §5]`; on-distribution format `[RR §1]`. |
| Compaction model | Same Hermes (cheap mode), async | Avoids a second dependency; ADK async-summarization pattern `[RR §2]`. |
| Tool sandbox | **Docker + restricted bash** for synthesized tools | Runtime-generated executables must be sandboxed (P6 guardrails). |
| Config | `agent.toml` | Single source for model, budgets, tool allowlist. |

---

## Repo layout

```
caduceus/
├── caduceus/
│   ├── orchestrator.py        # the agent loop (spec §7)
│   ├── context/
│   │   ├── builder.py         # Constructor→Loader→Evaluator (spec §3)
│   │   ├── fs.py              # Context FS read/write, typed events
│   │   └── compaction.py      # async summarization
│   ├── memory/
│   │   ├── long_term.py       # pgvector + provenance
│   │   └── episodic.py        # Reflexion buffer
│   ├── tools/
│   │   ├── builtin.py         # bash/read/edit/grep/run_tests/load_artifact
│   │   ├── runtime.py         # MemTool hybrid scoping + execution
│   │   └── synthesis.py       # Live-SWE-agent runtime tool creation (sandboxed)
│   ├── model/
│   │   └── hermes.py          # vLLM client, <tool_call> parse + JSON repair
│   ├── reflector.py           # Evaluator-Optimizer gate
│   └── trace.py               # trajectory logging
├── prompts/system.md          # the control surface (spec §6)
├── eval/
│   ├── private_suite/         # held-out tasks (NEVER public SWE-bench) [RR §6]
│   └── runner.py              # pass^k, $/task, tool-turns/task
├── .caduceus/                 # runtime context FS (spec §3)
└── docs/                      # these four documents
```

---

## Phase 0 — Spike (1 week) · *prove the loop*
**Goal:** Hermes does one real edit via a tool call.
- vLLM serving Hermes 4.3 36B; `hermes.py` round-trips a `<tool_call>` and parses it (with JSON-repair fallback) `[RR §1]`.
- Built-in `bash` + `read_file` + `edit_file` only `[RR §5]`.
- Hardcoded linear loop (no context FS yet), 5-step cap.
- **Gate:** agent fixes one toy bug end-to-end; tool call parses cleanly.

## Phase 1 — Context FS + loop (2 weeks) · *the scaffold that scores* `[RR §2, §6]`
**Goal:** the tiered context store and a real bounded loop.
- Implement `.caduceus/` layout (spec §3); `fs.py` typed events; `builder.py` Constructor→Loader→Evaluator.
- `persistent/system.md` fully constituting the agent (spec §6); context caching for the persistent tier.
- Orchestrator with ReAct + bounded execution (3–10 steps) + circuit breaker (K consecutive errors) `[RR §4]`.
- `trace.py` full trajectory logging.
- **Gate:** ablation shows context-builder ON beats the Phase-0 linear loop on a 10-task dev set (proves P2: scaffold earns its keep).

## Phase 2 — Memory (2 weeks) · *don't repeat mistakes* `[RR §3]`
**Goal:** three-tier memory live.
- Long-term: pgvector with provenance on every chunk (anti-poisoning); top-k retrieval into Context Builder; payload cap (scale guard).
- Episodic: Reflexion buffer — write `{task, summary, reflection}` on failure, retrieve on similar-task retry.
- **Gate:** on a retry set, episodic-memory ON measurably lifts pass^k vs OFF (replicating the Reflexion effect direction).

## Phase 3 — Dynamic & self-evolving tools (2–3 weeks) · *lean, growing toolset* `[RR §5]`
**Goal:** MemTool hybrid + runtime tool synthesis.
- `runtime.py`: deterministic tool scoping per task + model-chosen tools within set (Hybrid mode — best for mid-size models).
- MCP client for external tools.
- `synthesis.py`: Reflector emits `synthesize_tool` → sandboxed executable written to `persistent/tools/synthesized/` with a schema → callable next turn.
- **Gate:** at least one task solved that requires a synthesized tool; sandbox blocks unsafe ops.

## Phase 4 — Eval harness & hardening (2 weeks) · *trust nothing* `[RR §6]`
**Goal:** honest measurement + safety.
- `eval/runner.py`: **pass^k (k≥4)**, $/task, tool-turns/task; private held-out suite as the release gate.
- Track the six 2026 benchmarks (GAIA, SWE-bench Verified, OSWorld, Tau²-Bench, WebArena, METR) as *directional* only.
- Four-point guardrails (input/tool/response/output) `[RR §4]`; compaction-loss logging.
- **Gate:** reproducible pass^k on private suite; no silent truncation anywhere; cost report per run.

## Phase 5 — v1.0 (1 week) · *ship*
- `agent.toml` config surface; model adapter verified against 70B/405B and an OpenAI-compatible endpoint.
- README + the four docs; example tasks; sandbox docs.
- **Gate:** fresh clone → one command → solves an example task; published eval numbers carry the §6 caveats.

---

## Milestone summary

| Phase | Duration | Ships | Gate |
|-------|----------|-------|------|
| 0 Spike | 1w | model + tool-call round-trip | toy bug fixed |
| 1 Context FS | 2w | tiered store + bounded loop | scaffold ablation win |
| 2 Memory | 2w | 3-tier + Reflexion | episodic lifts pass^k |
| 3 Tools | 2–3w | MemTool hybrid + synthesis | synthesized-tool task solved |
| 4 Eval | 2w | pass^k harness + guardrails | reproducible private-suite score |
| 5 v1.0 | 1w | packaged release | one-command demo |

**Total: ~10–11 weeks to v1.0.**

---

## Risks & mitigations

| Risk | Evidence | Mitigation |
|------|----------|------------|
| Open-model ceiling on long-horizon tasks | open SOTA 20.1% vs closed 38.6% on Toolathlon `[RR §5]` | Model adapter → swap to 70B/405B/closed endpoint; scope tasks to where 36B is competitive. |
| Benchmark overfitting / contamination | 32.67% SWE-bench leakage `[RR §6]` | Private held-out suite is the only release gate. |
| Context bloat → loops | agents loop when window grows `[RR §2]` | Per-turn rebuild + compaction + circuit breaker. |
| Multi-agent temptation | degrades coding, 4× cost `[RR §4]` | Single-agent default; multi-agent gated behind decomposability proof. |
| Unsafe synthesized tools | runtime-generated executables (P6) | Docker sandbox + restricted bash + guardrail review. |
| Memory doesn't scale | 25% loss 1M→10M tokens `[RR §3]` | Retrieval payload caps; summaries over raw chunks past threshold. |

---

## Definition of done (v1.0)
1. Single Hermes-model coding agent runs end-to-end from one command.
2. Context FS rebuilt per turn; artifacts loaded on demand; compaction never truncates silently.
3. Three-tier memory with Reflexion self-improvement, all ablations positive.
4. Minimal toolset that grows via sandboxed runtime synthesis; tool context in MemTool hybrid mode.
5. Bounded, reflective, fully-logged loop with circuit breakers.
6. Private-suite pass^k + cost reporting; public numbers published only with contamination caveats.
