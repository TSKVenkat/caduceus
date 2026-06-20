# Revised Plan — Caduceus: a Hermes-Agent-framework-style coding agent on Ollama Cloud

> **PLAN ONLY — no code in this phase.** This document supersedes the *model/serving* parts of Round 1 (`01-TECHNICAL-SPEC.md`, `03-BUILD-PLAN.md`) and integrates Round 2 findings (`04-RESEARCH-REPORT-R2.md`). Round 1's *architecture* findings (single-agent, tiered context, 3-tier memory, bounded reflective loop, private eval) still hold and are carried forward.

## Corrected vision

Build **Caduceus**: an open, single-agent coding agent that **clones and improves the Hermes *Agent framework*** (`NousResearch/hermes-agent`) — the *codebase architecture*, not the Hermes model — with the **Ollama Cloud API** as the LLM backend. "Better performing than what exists" comes from layering three measured wins onto Hermes Agent's proven structure: **Skills + progressive disclosure**, **prompt compression (LongLLMLingua)**, and **prefix caching + threshold summarization** (all user-selected as first-class).

---

## 1. What carries over vs. what changes

| Area | Round 1 decision | Round 2 revision |
|------|------------------|------------------|
| Topology | Single-agent coding agent | **Unchanged** (still strongly evidenced) `[RR1 §4]` |
| Model | Hermes 4.3 36B via vLLM (self-host) | **Ollama Cloud**; default candidate **qwen3-coder:480b-cloud**; Hermes model *not available there* `[RR2 §5]` |
| Identity | "Hermes model + scaffold" | **"Hermes *Agent framework* clone + improvements"** |
| Prompt structure | system.md fully constitutes agent | **Adopt Hermes Agent's stable→context→volatile tiering, fixed mid-conversation** `[RR2 §3]` |
| Tools | minimal builtin + runtime synthesis | Keep; **add registry-based auto-registration** (Hermes Agent) + **Skills** for capabilities `[RR2 §2,§3]` |
| Context format | (unspecified) | **Markdown default for token cost; format is open-model-sensitive → empirical bake-off (watch-list)** `[RR2 §1]` |
| Token saving | caching + compaction | **First-class: Skills disclosure + LongLLMLingua compression + prefix caching/summarization** `[RR2 §2,§4]` |
| Memory | working/long-term/episodic | **Unchanged** `[RR1 §3]` |
| Eval | private suite + pass^k | **Unchanged**, plus per-model format/compression ablations `[RR1 §6]` |

---

## 2. Target architecture (design — not yet built)

### 2.1 Model layer — Ollama Cloud abstraction `[RR2 §5]`
- Thin client over the **OpenAI-compatible** endpoint (`https://ollama.com/api/chat`, `Bearer $OLLAMA_API_KEY`). Streaming on.
- **Default model: qwen3-coder:480b-cloud** (strongest agentic coder on the platform); **bake-off** against `deepseek-v3.1:671b-cloud` and `gpt-oss:120b-cloud` on the private suite before locking.
- **Pin the model + a migration plan** — Ollama deprecates cloud models periodically (e.g., 2026-06-16 batch). Abstraction must make a swap a one-line config change.
- **Confirm empirically (undocumented by Ollama):** context-length limit, structured-output support, rate limits. Treat as unknown until measured.

### 2.2 Prompt assembly — Hermes Agent tiering `[RR2 §3]`
Assemble the system prompt in three tiers, **stable → context → volatile**, and **never mutate it mid-conversation** (preserves prefix cache):
1. **stable** — identity, tool guidance, **skills metadata** (Level-1 ~80–100 tok/skill)
2. **context** — project instruction files (AGENTS.md / CLAUDE.md / .cursorrules), loaded once
3. **volatile** — memory/profile/timestamp (the only part that changes, placed last)

### 2.3 Capabilities — Skills + tool registry `[RR2 §2,§3]`
- **Tool registry** (`tools/registry.py`-style): tools self-register at import; no manual import list.
- **Skills as folders** (`SKILL.md` + `scripts/` + `references/` + `assets/`) with **three-level progressive disclosure**: metadata always loaded (cheap), body on trigger (<5k tok), scripts run via bash (output-only into context). Cap the skills listing (~15k chars).

### 2.4 Context format `[RR2 §1]`
- **Default Markdown** (most token-efficient; XML costs ~80% more). Use light XML/tags only where weak-model parsing clarity demands it.
- **Do NOT copy Claude-tuned patterns blindly** — file-native retrieval *hurt* open models −7.7%. Treat the **MD vs YAML vs XML bake-off per chosen Ollama model** as a planned experiment (watch-list, run during eval).

### 2.5 Token-saving stack (first-class) `[RR2 §2,§4]`
1. **Skills progressive disclosure** — many capabilities, tiny idle footprint.
2. **Prompt compression** — LongLLMLingua-style **extractive** compression on large context blocks (retrieved docs, tool outputs): ~4× fewer tokens, can *raise* accuracy. Prefer extractive over summarization/pruning.
3. **Prefix caching + summarization** — fixed prompt prefix + cache breakpoints; threshold-triggered lossy summarization of old turns (Hermes Agent default).

### 2.6 Carried-forward core (Round 1)
- Single-agent **ReAct + Reflection** loop, **bounded** (3–10 steps) with circuit breaker.
- **Tiered context FS** (`persistent/session/memory/artifacts/trace`) — now *hosting* the Hermes-tier prompt + Skills folders.
- **3-tier memory** (working/long-term/episodic, Reflexion).
- **Eval on a private held-out suite, pass^k**, cost + tool-turn accounting.

### 2.7 Proposed folder structure (merged)
```
.caduceus/
├── agent.toml                  # model (ollama cloud), budgets, tool allowlist
├── prompt/                     # Hermes-tier assembly (stable→context→volatile)
│   ├── identity.md             # stable
│   ├── tool_guidance.md        # stable
│   └── context/                # AGENTS.md / CLAUDE.md / .cursorrules (loaded once)
├── skills/                     # progressive-disclosure capabilities
│   └── <skill>/SKILL.md (+ scripts/ references/ assets/)
├── tools/registry.*            # auto-registering tool registry
├── memory/                     # long_term/ (vector) + episodic/ (Reflexion)
├── session/                    # events.jsonl, plan.md, scratchpad.md (volatile)
├── compress/                   # LongLLMLingua config + cache breakpoints
├── artifacts/                  # load-on-demand blobs + manifest
└── trace/                      # full trajectory logs
```

---

## 3. How Caduceus aims to beat existing agents
1. **Hermes Agent's structure + measured token systems it lacks publicly** — LongLLMLingua extractive compression (+accuracy at 4× fewer tokens) layered on its summarization/caching. `[RR2 §4]`
2. **Open-model-aware formatting** — empirical per-model format tuning instead of copying Claude guidance that *hurts* open models. `[RR2 §1]`
3. **Skills progressive disclosure** for broad capability at low idle cost. `[RR2 §2]`
4. **Single-agent discipline + private pass^k eval** — avoids the multi-agent degradation trap and benchmark inflation. `[RR1 §4,§6]`

---

## 4. Future build roadmap (NOT started — for when you say "build")

> Phases are described so the plan is actionable later. **Nothing here is to be executed now.**

| Phase | Focus | Exit gate |
|-------|-------|-----------|
| D0 Design lock | Confirm default model after Ollama bake-off; verify undocumented Ollama limits (context, structured output, rate limits) | Decisions recorded in `agent.toml` schema |
| D1 Model + loop | Ollama Cloud client + bounded ReAct loop | Round-trips a tool call; circuit breaker works |
| D2 Prompt tiers + registry | stable→context→volatile assembly (fixed prefix) + auto-registering tools | Prefix cache verified stable mid-conversation |
| D3 Skills | SKILL.md folders + 3-level disclosure | Idle skill cost ~80 tok/skill measured |
| D4 Token saving | LongLLMLingua compression + summarization + caching | Measured ≥3× context reduction, no accuracy loss on private suite |
| D5 Memory | working/long-term/episodic + Reflexion | Episodic lifts pass^k on retries |
| D6 Eval + format bake-off | private suite, pass^k, MD/YAML/XML per-model ablation | Reproducible scores; best format locked per model |

---

## 5. Open decisions for you
1. **Default model** — go with **qwen3-coder:480b-cloud** as the planned default (recommended), or defer entirely to the D0 bake-off?
2. **OpenClaude as a starting point** — fork/study `Gitlawb/openclaude` (already Ollama-integrated, TS) vs. build fresh in Python (closer to Hermes Agent's `registry.py` style)? Language choice matters here.
3. **Skills sourcing** — author our own coding skills, or seed from `anthropics/skills` and adapt?
4. **Compression placement** — compress retrieved docs + tool outputs only (safe), or also compress conversation history (riskier, higher savings)?

---

## 6. Standing caveats (carried into the build)
- Ollama Cloud context/rate/structured-output limits are **undocumented** — verify before relying. Model churn requires a swap-ready abstraction.
- Hermes Agent's backend-mode mechanism was **unverified** in research — read it from source before cloning that part.
- DocLang/POML/TOON are **unproven comparatively** — watch-list, not commitments.
- Open models are **format-sensitive**; do not assume Claude patterns transfer.
