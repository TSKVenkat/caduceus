# Technical Spec — **Caduceus**: a Hermes-based self-improving coding agent

> **Naming.** *Hermes* is the messenger (the model). *Caduceus* is the staff he carries — our **scaffold**: the agent loop, context filesystem, memory, tools, and eval harness around a Hermes model. The research is unambiguous that the scaffold is half the score (§6 of the research report), so it earns its own name.

**Status:** v0.1 design. **Target use-case:** single-agent coding agent (justification: research report §0, §4). **Base model:** Hermes 4.3 36B (default) or Hermes 4 70B/405B; any OpenAI-compatible endpoint. **License intent:** open.

Every design choice below cites the verified finding it rests on, in the form `[RR §n]` (research report section).

---

## 1. Design principles (each traceable to evidence)

| # | Principle | Evidence |
|---|-----------|----------|
| P1 | **Single agent by default.** No multi-agent unless a task needs genuinely specialized roles. | Multi-agent degrades on SWE-bench >45%; error amplification 4.4–17.2× `[RR §4]` |
| P2 | **The scaffold is the product.** Invest in context + tool-calling, not just model choice. | ~30-pt GAIA / 5.2-pt SWE-bench-Pro swings from scaffolding alone `[RR §6]` |
| P3 | **Context is a tiered, file-like store, assembled per turn.** Never accumulate a mutable buffer. | Google ADK + Cloud + "everything is a file" paper converge `[RR §2]` |
| P4 | **Three-tier memory:** working / long-term / episodic. | Consensus decomposition; Reflexion episodic gains `[RR §3]` |
| P5 | **Lean tools, grown at runtime.** Start with a minimal toolset; synthesize tools on demand; load tool *context* dynamically. | Live-SWE-agent 79.2%; MemTool hybrid best `[RR §5]` |
| P6 | **Bounded, reflective, observable loop.** 3–10 step budgets, circuit breakers, full trajectory logs, reflection gate. | Bounded-execution + Reflexion `[RR §3, §4]` |
| P7 | **Hermes is steered by the system prompt — exploit it.** The system prompt is a hard control surface, not a hint. | Empty system prompt ≠ default persona in Hermes 405B `[RR §1]` |
| P8 | **Trust no benchmark; measure on held-out tasks with pass^k.** | Contamination/inflation 5–15 pts; SWE-bench leakage 32.67% `[RR §6]` |

---

## 2. System architecture

```
                         ┌──────────────────────────────────────────┐
                         │                 CADUCEUS                   │
                         │                                            │
  user task ───▶  ┌──────┴───────┐   assemble    ┌────────────────┐  │
                  │  Orchestrator │ ─────────────▶│ Context Builder │  │
                  │  (agent loop) │◀───────────── │ (per-turn)      │  │
                  └──────┬───────┘   prompt        └───────┬────────┘  │
                         │                                  │ reads     │
            ┌────────────┼─────────────┐          ┌────────▼────────┐  │
            ▼            ▼             ▼           │  CONTEXT FS      │  │
      ┌─────────┐  ┌──────────┐  ┌──────────┐     │  (tiered store)  │  │
      │  Hermes  │  │   Tool   │  │ Reflector│     │  working/        │  │
      │  model   │  │  Runtime │  │  (gate)  │     │  session/        │  │
      └─────────┘  └────┬─────┘  └──────────┘     │  memory/         │  │
                        │                          │  artifacts/      │  │
              ┌─────────┼──────────┐               └──────────────────┘  │
              ▼         ▼          ▼                                      │
        bash/edit  MCP tools  synthesized   ◀── Tool Memory (MemTool)     │
        (builtin)            tools (runtime)     dynamic load/unload      │
                         │                                                │
                         ▼                                                │
                   Trajectory Log ──▶ Eval Harness (held-out, pass^k)     │
                         └────────────────────────────────────────────────┘
```

**Control flow per turn:** Orchestrator asks Context Builder to *assemble* a fresh Working Context from the Context FS → calls Hermes → parses `<tool_call>` → Tool Runtime executes → result written back to Context FS as a typed event → Reflector decides (continue / synthesize-tool / done) → repeat until done or budget hit.

---

## 3. The folder structure (Context FS) — **the heart of the spec**

Synthesized from the §2 convergence: Google ADK's four layers (Working/Session/Memory/Artifacts), Google Cloud's three lifetimes (Persistent/Semi-persistent/Transient), and the "everything is a file" mounting/metadata/access-control model. **On-disk layout per agent run:**

```
.caduceus/
├── agent.toml                    # run config: model, budgets, tool allowlist
│
├── persistent/                   # LIFETIME: forever. Google Cloud "Persistent" layer [RR §2]
│   ├── system.md                 # the system prompt (P7 control surface)
│   ├── policies.md               # guardrails, refusal rules, safety contract
│   └── tools/                    # tool *definitions* (JSON schemas → <tools>)
│       ├── builtin/              # bash, read, edit, grep, run_tests (minimal set, P5)
│       └── synthesized/          # runtime-created tools (Live-SWE-agent style) [RR §5]
│
├── session/                      # LIFETIME: this run. ADK "Session" [RR §2]
│   ├── events.jsonl              # TYPED event records, not raw prompts [RR §2]
│   ├── plan.md                   # current <PLAN> (mirrors Hermes plan tokens) [RR §1]
│   └── scratchpad.md             # WORKING memory <SCRATCHPAD> [RR §3]
│
├── memory/                       # LIFETIME: across runs. ADK "Memory" / long-term [RR §3]
│   ├── long_term/                # vector store: repo facts, user prefs, conventions
│   │   ├── index.faiss
│   │   └── docs/                 # source chunks, each with metadata + provenance
│   └── episodic/                 # Reflexion buffer: past trajectories + reflections [RR §3]
│       └── reflections.jsonl     # {task, outcome, reflection} reused on retry
│
├── artifacts/                    # LIFETIME: referenced, never inlined. ADK "Artifacts" [RR §2]
│   ├── manifest.json             # id → {path, size, mime, summary}
│   └── blobs/                    # 5MB+ files, build logs, datasets — load on demand
│
└── trace/                        # observability (P6)
    └── run-<id>.jsonl            # full trajectory: decisions, tool calls, outputs
```

### Why each tier exists (and the rule that governs it)

| Tier | Lifetime | Rebuilt per turn? | Inlined into prompt? | Rule |
|------|----------|-------------------|----------------------|------|
| `persistent/` | forever | no (cached at front) | **always** (system+policies) | Context caching pins it → up to 90% token savings `[RR §2]` |
| `session/` | run | **yes** (Working Context) | recent events + plan + scratchpad | Rebuild, don't accumulate `[RR §2, P3]` |
| `memory/long_term/` | cross-run | retrieved | **only top-k retrieved chunks** | Select/compress, cite provenance `[RR §2,§3]` |
| `memory/episodic/` | cross-run | retrieved on retry | only relevant past reflections | Reflexion verbal feedback `[RR §3]` |
| `artifacts/` | referenced | **never** | **never** — referenced by id | `LoadArtifactsTool` on demand `[RR §2]` |

### The Context Builder contract (per turn)
Implements **Constructor → Loader → Evaluator** (from arXiv:2512.05470) `[RR §2]`:
1. **Construct** the window in fixed order: `persistent/system.md` + `policies.md` (cached) → compacted session summary → top-k long-term retrieval → relevant episodic reflections → recent `events.jsonl` tail → current `plan.md` + `scratchpad.md`.
2. **Load** artifacts *only* when a tool/event references them by id.
3. **Evaluate** against the token budget. If over: trigger **async compaction** (LLM-summarize oldest events into a session summary) — never silently truncate `[RR §2]`. Log what was compacted.

**Guards against the four degradation modes** `[RR §2]`: poisoning (provenance on every retrieved chunk), distraction (k small, recency-windowed), confusion (typed events not raw strings), clash (single source of truth per fact in `memory/`).

---

## 4. Memory subsystem `[RR §3]`

- **Working** = `session/scratchpad.md` + `plan.md`. Ephemeral, rebuilt each turn.
- **Long-term** = vector store under `memory/long_term/`. Writes: repo conventions, file-path maps, user prefs, resolved facts — **each with provenance** (anti-poisoning). Reads: top-k by query at construct time.
- **Episodic** = Reflexion buffer. On task failure/retry, write `{task, trajectory_summary, reflection}`; on a new attempt at a similar task, retrieve relevant reflections into context. **No weight updates** — verbal self-improvement only `[RR §3]`. (Reflexion: 91% pass@1 HumanEval.)
- **Scale guard:** memory degrades ~25% from 1M→10M tokens `[RR §3]`. Cap long-term retrieval payload; prefer summaries over raw chunks beyond a threshold; never assume "more context = better."

---

## 5. Tool-calling contract — **native Hermes format** `[RR §1]`

Use the Hermes Function-Calling standard verbatim so the model is on-distribution:

- Definitions: JSON schemas inside `<tools>…</tools>` (assembled from `persistent/tools/`).
- Invocation: model emits `<tool_call>{"name": ..., "arguments": {...}}</tool_call>`.
- Result: harness injects `<tool_response>…</tool_response>`.
- RAG citations: `<co>` tag.
- Parsing: rely on vLLM/SGLang auto-parsers; on malformed JSON, use Hermes's **trained repair** behavior before falling back to a re-ask `[RR §1]`.

**Built-in minimal toolset (P5):** `bash`, `read_file`, `edit_file`, `grep`, `run_tests`, `load_artifact`. Deliberately small — Live-SWE-agent starts from "only a minimal bash toolset" and grows `[RR §5]`.

**Tool memory (MemTool, Hybrid mode)** `[RR §5]`: do **not** stuff all tool schemas into every prompt (fixed-window limit). The harness deterministically scopes the candidate tool set per task (Workflow control), and lets the model request/drop tools within that set (Autonomous control) — **Hybrid mode is the measured best trade-off.** For mid-size models (Hermes 4.3 36B sits here), lean more on deterministic scoping (autonomous tool-removal efficiency drops to 0–60% for non-frontier models).

**Self-evolving tools (Live-SWE-agent)** `[RR §5]`: the Reflector may emit a `synthesize_tool` action → write an executable script to `persistent/tools/synthesized/` with a JSON schema → it becomes callable next turn. Gate creation behind a reflection step ("would a reusable tool help here?"), exactly as in the paper.

---

## 6. System prompt design (exploit Hermes steerability) `[RR §1, §7]`

Because an empty system prompt yields *no* default persona in large Hermes models, `persistent/system.md` must fully constitute the agent. Required sections:
1. **Identity & objective** — "You are Caduceus, a coding agent. Resolve the task; do not stop until tests pass or budget is exhausted."
2. **The loop contract** — how to use `<PLAN>`, `<SCRATCHPAD>`, `<REASONING>`, `<REFLECTION>` (Hermes's native structured tokens) `[RR §1]`.
3. **Tool protocol** — the `<tools>`/`<tool_call>` contract and the built-in toolset.
4. **Bounds** — step budget, when to ask vs. proceed, circuit-breaker behavior.
5. **Safety/policy reference** — points to `policies.md` (four-point guardrails) `[RR §4]`.

Keep it stable (for context caching) and version it.

---

## 7. The agent loop (Orchestrator) `[RR §4]`

ReAct + Reflection + bounded execution:

```
budget = 3..10 steps (configurable); errors_in_row = 0
loop:
  ctx   = ContextBuilder.assemble()              # P3: fresh each turn
  out   = hermes(ctx)                            # may include <think>, <tool_call>
  if out.tool_call:
     res = ToolRuntime.run(out.tool_call)        # bash/edit/mcp/synthesized
     events.append(typed_event(res))             # write back to Context FS
     errors_in_row = (res.error ? errors_in_row+1 : 0)
  decision = Reflector.gate(out, events)         # CONTINUE | SYNTHESIZE_TOOL | DONE | ASK
  if decision == DONE: break
  if decision == SYNTHESIZE_TOOL: create_tool(); continue
  if errors_in_row >= K or steps >= budget: circuit_break()   # P6
```

- **Reflector gate** runs the Evaluator-Optimizer pattern `[RR §4]`: verify output, decide continue/finish, and write an episodic reflection on failure.
- **Circuit breaker**: on K consecutive errors or budget exhaustion, stop and emit a structured failure with the trajectory — never loop forever (agents loop when context bloats `[RR §2]`).
- **Escalation to multi-agent is OFF by default** (P1). Only if a task is provably decomposable with specialized roles do we route to an Orchestrator-Workers topology — and the research says expect ~4× cost for marginal gains `[RR §4]`.

---

## 8. Eval harness `[RR §6]`

Non-negotiable given §6 contamination findings:
- **Held-out/private task suite** — never trust public SWE-bench numbers (32.67% leakage; perf drops ~15 pts on private repos) `[RR §6]`.
- **pass^k reporting** (k≥4) — single-run hides 20+ pts of variance `[RR §6]`.
- **Track the six 2026 benchmarks** as directional context (GAIA, SWE-bench Verified, OSWorld, Tau²-Bench, WebArena, METR) but gate releases on the private suite.
- **Per-run cost & tool-turn accounting** (Live-SWE-agent reports $/task and turns/task — we should too) `[RR §5]`.
- **Ablations that matter:** context-builder on/off, episodic memory on/off, tool synthesis on/off — to prove the scaffold earns its complexity (P2).

---

## 9. Open questions for the build phase
1. **Default base model** — Hermes 4.3 36B (cheap, hybrid reasoning, schema repair) vs Hermes 4 70B (stronger) given the open-vs-closed gap on long-horizon tasks (open SOTA 20.1% on Toolathlon) `[RR §5]`.
2. **Vector store** — FAISS (local, simple) vs pgvector (queryable, multi-session) for `memory/long_term/`.
3. **Compaction trigger** — fixed token threshold vs adaptive; who summarizes (same Hermes vs a small cheap model).
4. **Tool-synthesis safety** — sandboxing for runtime-generated executables (P6 guardrails).

These are resolved in the Build Plan (`03-BUILD-PLAN.md`).
