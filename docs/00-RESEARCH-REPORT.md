# Research Report — Foundations for a Hermes-Based Open Agent System

**Date:** 2026-06-20
**Method:** Deep-research harness — 5 search angles → 22 sources fetched → 100 falsifiable claims extracted → 25 highest-importance claims put through 3-vote adversarial verification (a claim survives only if it is *not* refuted by ≥2 of 3 independent skeptics). **Result: 25/25 confirmed, 0 killed.** All claims below carry a source and a publication date; quality is tagged `[primary]` (papers, official reports, vendor docs), `[secondary]`/`[blog]` (practitioner writeups), or `[unreliable]` (excluded).

> **Note on provenance.** The workflow's automatic final-synthesis JSON degraded to placeholders. This report is reconstructed directly from the verified claim corpus in the run journal (run `wf_e2227a93-0a5`), not from that degraded summary. Every figure here traces to a verified claim.

---

## 0. Executive summary & recommendation

**Build a single-agent, self-improving coding agent**, wrapping a Hermes model in a strong scaffold, with context managed as a tiered *filesystem* and memory split into three tiers. The evidence for this shape is unusually clean:

1. **Single-agent beats multi-agent for coding.** On SWE-bench Verified, multi-agent systems showed *consistent degradation* against single-agent baselines exceeding 45% success. Error amplification rises monotonically with decentralization (1.0 → 4.4 → 5.1 → 7.8 → 17.2). Multi-agent only wins on cleanly decomposable tasks (finance: +80.8%). [§4]
2. **The scaffold is half the score.** The *same* model swings ~30 points on GAIA and 5.2 points on SWE-bench Pro purely from context-management and tool-calling differences. System design is not a wrapper around the model — it *is* the product. [§6]
3. **Hermes is purpose-built for agentic scaffolds.** Function-calling standard, neutral alignment + near-absolute system-prompt adherence, structured-reasoning tokens, schema adherence with JSON repair, hybrid `<think>` reasoning, open weights. [§1]
4. **Self-evolving single agents are SOTA-competitive and cheap.** Live-SWE-agent (minimal bash toolset + runtime tool synthesis) reaches 79.2% on SWE-bench Verified at $0.86/task. [§5]
5. **Context belongs in a tiered, file-like store**, rebuilt per turn — the convergent recommendation of Google's ADK guidance, Google Cloud, and a dedicated "everything is a file" context-engineering paper. [§2]

**The honest caveat:** open-weight models still trail closed models badly on long-horizon multi-tool tasks (best open model 20.1% vs. best closed 38.6% on Toolathlon). A Hermes-based agent's ceiling on hard, realistic workflows is set largely by the base model — the scaffold's job is to extract every point that scaffold *can* extract, and to fail safely. [§5, §6]

---

## 1. Nous Research Hermes — what makes it good at agentic tool use

### Architecture & lineage
- **Hermes 3** is a family of neutrally-aligned instruct/tool-use models fine-tuned from **Llama 3.1** at 8B / 70B / 405B; decoder-only Transformers with **128K (131,072-token) context**. The 405B version claims SOTA among open-weight models on several public benchmarks. `[primary, 2024-08]` (Hermes 3 Technical Report, arXiv:2408.11857)
- **Hermes 4** (405B & 70B) is built on **Meta-Llama-3.1**, a **hybrid reasoning** family combining structured multi-turn reasoning with broad instruction-following; **131K context**; released **2025-08-26**. `[primary, 2025-08-25]` (Hermes 4 Technical Report, arXiv:2508.18255)
- **Hermes 4.3 36B** breaks the Llama lineage — built on the **ByteDance Seed 36B** base, a "frontier, hybrid-mode reasoning model," trained by Nous via **decentralized methods (Psyche)**. `[primary, 2025-08-25]` (HF: NousResearch/Hermes-4.3-36B)

### What specifically makes it agentic
- **The Hermes Function-Calling standard.** Tool definitions are JSON schemas inside `<tools>`; invocations/responses use `<tool_call>` / `<tool_response>`. RAG sources are cited with a `<co>` tag. The report states Hermes 3 "can perform planning, incorporate outside data, and make use of external tools in an interpretable and transparent manner out-of-the-box, making it an excellent choice for agentic tasks." `[primary, 2024-08]`
- **Dedicated structured-reasoning tokens.** Using Llama 3.1's *reserved* tokenizer tokens, Hermes 3 was trained on `<SCRATCHPAD>`, `<REASONING>`, `<INNER_MONOLOGUE>`, `<PLAN>`, `<EXECUTION>`, `<REFLECTION>`, `<THINKING>`, `<SOLUTION>`, `<EXPLANATION>`, `<UNIT_TEST>` — i.e., the agent loop's primitives are *first-class tokens*. `[primary, 2024-08]`
- **Neutral alignment + extreme steerability.** Training "strongly encourages the model to follow the system and instruction prompts exactly and neutrally" — distinguishing it from closed models that refuse on moral grounds. Models are "highly sensitive to the system prompt"; in 405B, **an empty system prompt does not even elicit a default 'helpful assistant' persona.** For an agent harness, this means the system prompt is a *real control surface*, not a suggestion. `[primary, 2024-08]`
- **Hybrid reasoning.** Hermes 4 toggles between direct answers and explicit `<think>…</think>` traces (up to ~16,000 tokens), generated via a graph-based "DataForge" synthesis pipeline. `[primary, 2025-08-25]` / `[secondary, 2026-03-15]`
- **Schema adherence & JSON repair.** Hermes 4.3 is trained to "produce valid JSON for given schemas and to repair malformed objects," emitting `<tool_call>` tags with automatic parsers in **vLLM and SGLang**. `[primary, 2025-08-25]`

### Training recipe (post-training is the story)
- **Two-phase: SFT → DPO.** Hermes 3 SFT on a **~390M-token** curated dataset (270M output tokens); **Tool Use/Agentic/RAG = 4.3% (17M tokens)**, Coding = 4.5% (18M). DPO (LoRA) gave only moderate gains at 8B and negligible gains at larger sizes, so 70B/405B shipped the SFT checkpoint. `[primary, 2024-08]`
- **Hermes 4 scaled post-training to ~5M samples / ~60B tokens** (5× more samples, 50× more tokens than Hermes 3), emphasizing verified reasoning traces. The report explicitly frames the contribution as **data curation/synthesis/training/eval at scale, not a new base architecture.** `[primary, 2025-08-25]` / `[secondary, 2026-03-15]`
- **Measured tool-calling strength:** predecessor Hermes 2 Pro reached **~90% function-calling accuracy vs. 60–70% for general-purpose models of similar size** — evidence the tool-use edge comes from dedicated function-calling fine-tuning, not scale alone. `[secondary, 2026-03-15]`
- **Steerability metric:** Hermes 4.3 reports **74.60% on RefusalBench** (non-reasoning), claimed SOTA "across non-obliterated models." `[primary, 2025-08-25]`

> There is also a separate **"Hermes Agent" runtime** implementing classic ReAct (Observation → Reasoning → Action → Loop) over any OpenAI-compatible endpoint. It is distinct from the Hermes *models*. `[secondary, 2026-03-15]` (dev.to/crabtalk) — treat as design inspiration, not a verified production system.

---

## 2. Context engineering & "folder structure for agents" (the Google angle)

This is the blog the request was chasing. There are **two** convergent Google sources plus an academic paper.

### Google ADK guidance (the developers blog — Dec 2025)
"Architecting an efficient, context-aware multi-agent framework for production" recommends treating **context as a first-class system** with a **tiered architecture**: `[primary, 2025-12-04]`
- **Four layers:** Working Context · Session · Memory · Artifacts.
- **Rebuild Working Context per invocation** rather than maintaining a mutable buffer.
- **Artifacts on demand:** large data (5MB+ files) stored separately and pulled via a `LoadArtifactsTool` — "turning 5MB of noise in every prompt" into a precise resource.
- **Async compaction:** LLM-based summarization of older events at configurable thresholds → indefinite session scaling.
- **Context caching:** stable system instructions/summaries pinned at the front of the window.
- **Typed event records** replace raw prompt strings (model-agnostic storage); **narrative translation** recasts prior assistant messages on handoff so sub-agents don't misattribute history.
- **Multi-agent context scoping — two patterns:** *Agents-as-Tools* (callee sees only focused prompts + necessary artifacts) and *Agent-Transfer* (sub-agents inherit scoped context via `include_contents`); **default to minimal context, agents explicitly request more.**

### Google Cloud context-engineering model (Apr 2026)
Defines **three layers** and a workspace metaphor: `[blog, 2026-04-23]`
- **Persistent** (system instructions — role/tone/rules, active every interaction)
- **Semi-persistent** (memory — conversation history + user preferences)
- **Transient** (dynamic real-time data — retrieved docs, API outputs)
- Frames the agent's environment as a **"labeled filing cabinet"** (structured storage in BigQuery, live connections, explicit rules) rather than ad-hoc prompts. Context engineering is "the bigger job of designing the entire data system and memory" — a **superset of prompt engineering.**
- **Context Caching** can cut token cost by **up to 90%** by holding large data in active memory.

### The "everything is a file" context paper (Dec 2025)
arXiv:2512.05470 proposes a **file-system abstraction for context engineering**, Unix-inspired: persistent, governed infrastructure for heterogeneous context artefacts via **uniform mounting, metadata, and access control**. Pipeline = **Context Constructor → Loader → Evaluator** (assemble, deliver, validate under token constraints). Implemented in the open-source **AIGNE** framework; demonstrated on an agent-with-memory and an MCP GitHub assistant. `[primary, 2025-12-05]`

> **Convergence:** independent Google and academic sources all land on the same shape — **context is a tiered, file-like, governed store; the prompt is *assembled* per turn from it, not accumulated.** This is the single strongest design signal in the whole corpus.

### Failure modes to design against
Four context-degradation patterns — **poisoning, distraction, confusion, clash** — none solvable by enlarging the window. `[blog, 2025-12-09]` Agents "lose track" and loop when the window grows too large. `[blog, 2025-07-17]`

---

## 3. Memory systems

- **Three-tier memory is the consensus decomposition:** **short-term** (scratchpad/working memory for the current task), **long-term** (persistent user/task/team knowledge across sessions, usually a vector DB), **episodic** (record of prior agent trajectories reused on future attempts). `[blog, 2026-05-18]` / `[blog, 2025-12-09]`
- An **LLM is a stateless function** — no memory unless context is re-injected; memory must be engineered externally. `[blog, 2025-07-17]`
- **Reflexion** (the episodic-memory foundation): agents "verbally reflect on task feedback" and keep "reflective text in an episodic memory buffer," learning across trials **without weight updates**. **91% pass@1 on HumanEval**, beating GPT-4's then-80%. Gains across decision-making, coding, and reasoning. `[primary, 2023-03 / v4 2023-10]`
- **Memory at scale is still unsolved.** Best-in-class memory (Mem0) reports 92.5 LoCoMo / 94.4 LongMemEval at ~6,900 tokens/query (vs ~26K baseline), +29.6 temporal / +23.1 multi-hop over its prior algorithm — **but** on the BEAM benchmark performance falls **64.1 → 48.6 from 1M → 10M tokens** (~25% loss at 10× scale). Six challenges remain explicitly open (temporal abstraction scaling, cross-session structure, eval standardization, privacy/consent, identity resolution, staleness). `[blog, 2026-06-19, mem0]`

---

## 4. Agent patterns & orchestration (single vs. multi)

**The most decision-relevant section.** A 260-config controlled study `[blog, 2026-04-15]`:
- Outcomes ranged **−70.0% (PlanCraft Independent) to +80.8% (Finance-Agent Centralized)** vs single-agent — value is **highly task- and topology-dependent.**
- **Error amplification by topology:** SAS **1.0** → Centralized **4.4** → Hybrid **5.1** → Decentralized **7.8** → Independent **17.2**.
- **On SWE-bench Verified: consistent multi-agent degradation** where single-agent baselines exceed 45%.
- Multi-agent *helps* on decomposable finance tasks (centralized +80.8%, agents exchange genuinely useful info r=0.71, p<0.001) — **but costs ~4×** ($47K/mo @ 94.3% vs $22.7K/mo @ 92.2%).

**Pattern catalogs converge on "start simple."** `[blog, 2026-05-18]` Decision rule: single LLM + tools by default → add **Reflection** when output verification is needed → add **Planning (ReAct)** for multi-step runtime dependencies → use **Multi-Agent only when specialized roles are genuinely required** and benefits justify cost. Foundational set = Ng's 4 (Reflection, Tool Use, Planning, Multi-Agent) + Anthropic's 5 workflow patterns (Prompt Chaining, Routing, Parallelization, Orchestrator-Workers, Evaluator-Optimizer).

**Reliability patterns:** bounded execution (max steps / tool-call caps / circuit breakers — **3–10 steps** improves clarity & reliability), four-point guardrail layering (input, tool calls, responses, output), and full trajectory logging. `[blog, 2026-05-18]` / `[blog, 2025-07-17]`

---

## 5. Tool use & self-improvement

- **Live-SWE-agent** — "first live software agent that autonomously and continuously evolves itself on-the-fly." Starts with **only a minimal bash toolset**, **synthesizes custom executable tools at runtime**, and uses a **reflection step to decide when to create a tool**. **79.2% on SWE-bench Verified** (Claude Opus 4.5, $0.86); 77.4% Gemini 3 Pro / 75.4% Claude Sonnet 4.5; **45.8% on the harder SWE-Bench Pro**. `[primary, 2025-11-24, arXiv:2511.13646]`
- **MemTool** — dynamic tool/MCP-context management across multi-turn conversations. Three modes: **Autonomous** (full autonomy), **Workflow** (deterministic), **Hybrid**. Reasoning LLMs hit **90–94% tool-removal efficiency** autonomously; mid-size models only 0–60%. **Hybrid mode is the best trade-off** (manages tool memory *and* completes tasks). Motivation: fixed context windows can't hold all tools statically. `[primary, 2025-07-30]`
- **Toolathlon (ICLR 2026)** — 32 apps, 604 tools, 108 long-horizon tasks. **Best model (Claude-4.5-Sonnet) only 38.6%** at 20.2 tool-turns/task; **best open-weight (DeepSeek-V3.2-Exp) 20.1%** — a stark open-vs-closed gap and a sobering ceiling for realistic multi-tool work. `[primary, 2025-10-29]`
- **MCP** standardizes tool integration; structured/template-based reasoning improves function-call reliability. `[blog, 2025-10-22]`

---

## 6. Evaluation reality (read before trusting any number above)

- **Scaffolding dominates.** Same model, 3 harnesses → **50.2%–55.4% on SWE-bench Pro** (5.2-pt spread "entirely from how each agent managed context and tool calls"). ~30-pt swing on GAIA from scaffolding. `[blog, 2026-06-16]` / `[blog, 2026-05-09]`
- **Leaderboards are inflated 5–15 pts** by contamination, scaffolding, single-run reporting — treat as directional, not an SLA. **Use pass^k** (single-run hides 20+ pts of variance). `[blog, 2026-05-09]`
- **SWE-bench Verified is contaminated:** 32.67% of successful patches involved solution leakage; models recall correct file paths up to 76% of the time. OpenAI's Frontier Evals **stopped reporting it in early 2026** after finding >60% of 138 audited tasks unsolvable as written. Performance drops on private codebases (GPT-5.4 xHigh 59.1% → 43.4%). `[blog, 2026-06-16]`
- **Six benchmarks that matter for 2026:** GAIA (general assistant), SWE-Bench Verified (coding), OSWorld (computer-use), Tau²-Bench (tool/policy adherence), WebArena (browser), METR HCAST/Time-Horizons. METR: agent time-horizon doubling ~every 4 months. `[blog, 2026-05-09]`

**Implication for us:** our own eval harness must run **held-out/private tasks**, report **pass^k**, and treat public SWE-bench numbers as a contaminated upper bound.

---

## 7. Sources (by angle, with quality)

**Hermes technical:** arXiv:2408.11857 `[primary]` · Hermes-3-Technical-Report.pdf (nousresearch.com) `[primary]` · arXiv:2508.18255 (Hermes 4) `[primary]` · HF NousResearch/Hermes-4.3-36B `[primary]` · openrouter.ai/nousresearch `[secondary]` · dev.to/crabtalk Hermes-Agent `[secondary]`

**Google / context engineering:** developers.googleblog.com (ADK multi-agent, Dec 2025) `[primary]` · cloud.google.com/discover/ai-context-engineering `[blog]` · arXiv:2512.05470 (filesystem abstraction) `[primary]`

**Academic benchmarks:** arXiv:2303.11366 (Reflexion) `[primary]` · live-swe-agent.github.io / arXiv:2511.13646 `[primary]` · digitalapplied.com SWE-bench Verified analysis (Jun 2026) `[blog]` · mem0.ai state-of-ai-agent-memory-2026 `[blog]`

**Practitioner patterns:** augmentcode.com agentic-design-patterns `[blog]` · arXiv:2507.21428 (MemTool) `[primary]` · sparkco.ai tool-calling deep-dive `[blog]` · weaviate.io context-engineering `[blog]` · kubiya.ai context-engineering `[blog]`

**Use-case comparison:** decodethefuture.org ai-agent-benchmarks-2026 `[blog]` · medium.com (single vs multi-agent) `[blog]` · arXiv:2510.25726 (Toolathlon) `[primary]`

**Excluded:** mem0.ai/blog/context-engineering-ai-agents-guide `[unreliable — 0 extractable claims]`

---

## 8. Caveats & confidence

- **High confidence:** Hermes architecture/tool-format/alignment facts (primary, multiply corroborated); single-vs-multi-agent direction for coding (controlled study + benchmark agreement); context-as-tiered-store (triple convergence); scaffolding-dominates (multiple independent measurements).
- **Medium confidence:** specific benchmark *numbers* — all subject to the §6 inflation/contamination caveats. Dates beyond the Jan 2026 knowledge cutoff (e.g., "Opus 4.8 69.2%", "Gemini 3.1 1–2M context") come from blog sources and were verified for internal consistency, not independently confirmed against vendor primaries.
- **Known gap:** we found strong *structural* guidance for folder/context layout but no single canonical "Google folder-structure spec" — the recommendation in the spec is **synthesized** from the ADK + Cloud + filesystem-paper convergence, which is a feature (three sources agreeing) not a citation of one post.
