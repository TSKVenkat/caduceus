# Research Report (Round 2) — Context formats, Skills, OSS agent landscape, compression, Ollama Cloud

**Date:** 2026-06-20
**Method:** Deep-research harness, run `wf_eb0da39a-a92` — 5 angles → 25 sources → 118 claims extracted → 25 highest-importance claims through 3-vote adversarial verification. **Result: 22 confirmed, 3 refuted.** Two gaps the synthesizer flagged as "unfilled" (Ollama Cloud specifics, prompt compression) were **recovered directly from the run journal** — their source claims were extracted but didn't make the top-25 cut. They are included below and marked `[journal-recovered]`.

Quality tags: `[primary]` papers/official docs · `[secondary]`/`[blog]` practitioner · numbers carry the same inflation caveats as Round 1 §6.

> **Scope correction.** This round assumes the project goal is to **clone + improve the Hermes *Agent framework*** (NousResearch/hermes-agent), running on **Ollama Cloud** — *not* to run the Hermes *model*. That reframing is reflected throughout.

---

## 0. The five conclusions that change the plan

1. **Context format matters far more for open models than frontier ones.** Open models swing **9.8–20.1%** by format; frontier only **1.6–5.4%**. There is *no universally best format*, and a 10k-experiment 2026 study found format effect statistically insignificant in aggregate (p=0.484) — **but** that average hides large per-open-model sensitivity. Since we're on Ollama Cloud (open models), **we cannot borrow Claude-tuned formatting; it must be empirically tuned.** [§1]
2. **File-native/agentic retrieval *hurts* open models −7.7%** (Qwen −21.9%, Llama Maverick −13.9%) while helping frontier +2.7%. A pattern that helps Claude can actively hurt our backend. [§1]
3. **The Skills pattern is a measured token-saving win** and the right capability-packaging mechanism: ~80 tokens/skill idle, ~2k when triggered, scripts run via bash without entering context. [§2]
4. **Prompt compression is real and sometimes free:** LongLLMLingua **+21.4% accuracy at ~4× fewer tokens**, **94% cost cut** on LooGLE — compression can *raise* accuracy, not just trade it. [§4]
5. **Ollama Cloud is viable but under-documented for agents, and does NOT host Hermes.** It serves qwen3-coder:480b, deepseek-v3.1:671b, gpt-oss:120b/20b, etc., via an OpenAI-compatible API; tool-calling is tested on "real agent workflows," but context limits / structured-output / rate-limit specs are not published. [§5]

---

## 1. Context-feeding format — what the measurements actually say

**Format sensitivity is a "butterfly effect," and it scales inversely with model strength.** `[high confidence]`
- GPT-3.5-turbo varied **up to 40%** on code translation by format; GPT-4 far more robust. (arXiv:2411.10541, He et al., Nov 2024) `[primary]`
- POML's TableQA study swept ~73,926 styling combinations across 8 LLMs: GPT-3.5 improved **929%** and Phi-3 **4450%** worst-to-best styling. (arXiv:2508.13948, Microsoft, Aug 2025) `[primary]`
- FormatSpread (Sclar et al., ICLR 2024): up to **76-point** swings from superficial changes on LLaMA-2-13B. `[primary]`

**No universally best format; preferences flip by model.** `[high]`
- MMLU: GPT-3.5-turbo preferred **JSON 59.7% vs Markdown 50.0%**; GPT-4 preferred **Markdown 81.3% vs JSON 77.8%** — the ordering *reverses*. (arXiv:2411.10541) `[primary]`
- 2026 agentic study (~10k experiments, 4 formats): **YAML 75.4% / MD 74.9% / JSON 72.3% / TOON 72.3%**, χ²=2.45, **p=0.484** (not significant in aggregate) — **but open-source models show 9.8–20.1% spread vs frontier 1.6–5.4%.** (arXiv:2602.05447, "Structured Context Engineering for File-Native Agentic Systems", Feb 2026) `[primary, medium — single preprint]`

**Retrieval strategy interacts with model tier.** `[medium]`
- File-native schema retrieval: **frontier +2.7% (p=0.029)**, **open-source −7.7% (p<0.001)** — Qwen −21.9%, Llama Maverick −13.9%, Kimi/Llama-Scout ≈0. (arXiv:2602.05447)

**Token efficiency by format (cost angle).** `[blog]`
- Markdown most token-efficient across models — **38% fewer tokens than JSON** (Gemini); **XML needs ~80% more tokens than Markdown** for the same data. Recommendation: **YAML when accuracy is priority, Markdown when cost is priority.** (improvingagents.com, Oct 2025)
- **TOON** (Token-Oriented Object Notation): ~25% smaller files than YAML, but **file size ≠ runtime token cost** — compact/novel formats can cost *more* runtime tokens. (arXiv:2602.05447) `[primary]`

**Anthropic's official guidance (Claude-specific).** `[primary, verified live]`
- Use **XML tags** (`<instructions>`, `<context>`, `<input>`) so prompts parse unambiguously.
- For 20k+ token prompts, **put long docs at the top, query at the end → up to +30%** response quality "in tests." *Caveat: vendor figure, no published methodology, Claude-specific — may not transfer to Ollama open models.*
- Prefer the **Structured Outputs** feature over prefill format-forcing.

### "DocLang" — identified, but unproven
- **DocLang** is a real **AI-native markup format** (constrained XML aligned to LLM tokenizers, aiming for 1:1 token mapping while preserving structure/semantics/layout/geometry). Spec + Python reference validator (`pip install doclang`, Apache-2.0), governed by the **LF AI & Data Foundation** (working group launched **2026-06-09**; founders incl. IBM, NVIDIA, Red Hat, ABBYY, HumanSignal). (github.com/doclang-project/doclang; LF press release) `[primary, high]`
- **One self-reported datapoint:** IBM 2025 annual report — DocLang **5,310 input tokens vs PDF 8,421 (~37% fewer)**, latency 4.2s→2.7s. `[secondary, 2026-06-16]`
- **Verdict: no comparative benchmarks vs MD/XML/JSON/YAML/HTML exist.** Token-efficiency is a *stated design goal*, and ABBYY's pilot claims are unquantified marketing. **Watch-list, do not bet on it.** (A claim that DocLang has zero benchmarks was itself contested 1-2, reflecting the single IBM datapoint — net: treat as unproven.)
- **POML** (Microsoft Research): HTML/XML-inspired prompt markup with component tags + CSS-like styling decoupling content from presentation. (arXiv:2508.13948; github.com/microsoft/poml) `[primary]` — also no head-to-head token/accuracy wins published.

**Is HTML better?** No evidence it is. HTML/XML-family markup is *more* token-expensive (XML ~80% over Markdown). Structured markup helps *parsing clarity* on weak models, not token cost.

---

## 2. The "Skills" pattern (Anthropic Agent Skills / SKILL.md)

**A Skill is a capability folder** `[primary, high]`:
```
skill-name/
├── SKILL.md          # required: Markdown instructions + YAML frontmatter (name, description)
├── scripts/          # optional: executable code (run via bash, never enters context)
├── references/       # optional: docs loaded only as needed
└── assets/           # optional: templates/fonts/icons used in output
```

**Three-level progressive disclosure with measured token costs** `[primary + blog, high]`:
| Level | When loaded | Cost |
|-------|-------------|------|
| 1 — metadata (name+description) | always, at startup | **~100 tokens/skill** (median ~80; 17 official skills ≈ **1,700 tokens total**) |
| 2 — SKILL.md body | when triggered | **<5k tokens** (median ~2,000; range 275–8,000; 40,285-skill study median **1,414**) |
| 3 — bundled resources/scripts | as needed | **effectively unlimited**; scripts run via bash, **output-only** enters context |

- "Install many Skills without context penalty." Scripts: *"the script's code never loads into the context window. Only the script's output consumes tokens."*
- The `<available_skills>` listing is capped at **15,000 chars** by default to prevent bloat.
- Illustrative win: a skill cut a workflow **12,000 → 6,000 tokens (~50%)**, 0 failed API calls. `[primary, vendor-illustrative]`
- Related: **AGENTS.md / CLAUDE.md / .cursorrules** instruction files — keep to **500–2,000 tokens** since they load *every* invocation. `[blog, 2026-06]`

**Why it matters for us:** Skills are the proven mechanism to give an agent many capabilities while keeping idle context tiny — directly compatible with the Hermes Agent framework's "skills" tier (§3) and our token-saving goals.

---

## 3. Open-source agent landscape & architectures

### Hermes Agent framework (Nous Research) — **our reference architecture** `[primary, high]`
Source: hermes-agent.nousresearch.com/docs/developer-guide/architecture; github.com/NousResearch/hermes-agent
- **Three-tier system-prompt assembly, ordered stable → context → volatile:**
  1. **stable** — identity / tool guidance / skills
  2. **context** — context files (AGENTS.md, CLAUDE.md, .cursorrules)
  3. **volatile** — memory / profile / timestamp blocks
- **System prompt held FIXED mid-conversation** — *"No cache-breaking mutations except explicit user actions."* This is the key to prefix caching.
- **Registry-based tool discovery** (`tools/registry.py`): **70+ tools across ~28 toolsets**, each file **self-registers at import time** — no manual import list.
- **Lossy summarization** as the default context-compression engine when context exceeds thresholds; **Anthropic cache breakpoints** for prefix caching to cut token cost.
- ⚠️ **Refuted (0-3):** a claim that Hermes Agent supports three specific backend modes (chat_completions / codex_responses / anthropic) converting to Anthropic Messages format internally **did not survive verification** — do *not* rely on that as its provider-agnosticism mechanism. Verify the actual backend abstraction from the codebase before copying it.

### OpenClaude (Gitlawb/openclaude) — "OpenClaw" resolved `[primary, high]`
- An **open-source TypeScript CLI coding agent**, motto *"runs anywhere. uses anything."* Provider/backend-flexible: OpenAI-compatible APIs, Gemini, Bedrock, OpenRouter, Groq, Mistral, LM Studio, **and Ollama (local inference)**.
- **Agentic tool loop**: multi-step tool calls → execution → follow-up responses; **MCP integration**; file/bash/grep/glob tools; web search/fetch. (github.com/Gitlawb/openclaude, 2026-06)
- Relevance: a working reference for **Ollama-backed** agent integration and a multi-provider tool loop. (Note "OpenClaw" spelling is an inference; this is the best-matching active repo. A separate "Claw Code vs OpenClaw" comparison exists at verdent.ai but is secondary.)

### Others (from landscape survey, lighter verification)
opencode, Cline, Aider, OpenHands/OpenDevin, Goose appear in the CLI-coding-agent landscape (github.com/bradAGI/awesome-cli-coding-agents). The **recurring patterns in the better performers**: registry/auto-discovered tools, stable cache-friendly prompts, MCP for tool standardization, instruction files for project context, and summarization-based compression — i.e., the same patterns Hermes Agent codifies.

---

## 4. Token-saving / context compression (gap recovered from journal)

**Prompt compression can improve accuracy *and* cut cost** `[primary, high — journal-recovered]`:
- **LongLLMLingua** (ACL 2024, arXiv:2310.06839): **+21.4% accuracy** on NaturalQuestions multi-doc QA (GPT-3.5-Turbo) at **~4× fewer tokens**; **94.0% cost reduction** on LooGLE; **1.4–2.6× latency speedup** at 2×–6× compression on ~10k-token prompts. *"Not only enhances performance but also significantly reduces costs and latency."*
- **Compression-method comparison** (arXiv:2407.08892, Jul 2024): **extractive compression up to 10× with minimal degradation**, and extractive **often outperforms** abstractive summarization and token-pruning. Token-pruning lags; summarization helps only on summarization tasks.

**Caching + summarization** (from Hermes Agent, §3): fixed prefix + cache breakpoints + threshold lossy summarization.

**Structured outputs** reduce ret/ parse failures (Anthropic Structured Outputs; Hermes-style schema adherence from Round 1).

---

## 5. Ollama Cloud as an agent backend (gap recovered from journal)

Sources: docs.ollama.com/cloud, ollama.com/blog/cloud-models, ollama.com/pricing `[primary, journal-recovered]`

- **What it is:** announced **2025-09-19** (preview). Runs large open models on datacenter GPUs while keeping local-style integration; **same API/capabilities as local models**. Privacy: *"Prompt or response data is never logged or trained on."*
- **Models served:** `qwen3-coder:480b-cloud`, `deepseek-v3.1:671b-cloud`, `gpt-oss:120b-cloud`, `gpt-oss:20b-cloud`, plus GLM, Kimi, MiniMax, Qwen, Cogito families. **Hermes (Nous) is NOT in the hosted lineup.**
- **API:** OpenAI-compatible; direct access at `https://ollama.com/api/chat` with `Authorization: Bearer $OLLAMA_API_KEY` (mirrors local `localhost:11434/api/chat`). SDKs: JS, Python, cURL. **Streaming supported.**
- **Tool calling:** *"Cloud models that are trained to support tools are tested for tool calling and with real agent workflows."* (So function-calling is supported on tool-trained models, though per-model behavior isn't tabulated.)
- **Pricing:** Free $0 · **Pro $20/mo** ($200/yr, **50× Free usage**) · **Max $100/mo** (**5× Pro**) · Team forthcoming. Billed by **GPU utilization** (model size × duration), 4 consumption levels (light→extra-heavy).
- **Hosting:** primarily US, may route to EU/Singapore.
- **Model churn:** Ollama **periodically deprecates** older cloud models (e.g., a **2026-06-16** batch retiring kimi-k2-thinking, minimax-m2, glm-4.6, qwen3-next:80b, cogito-2.1:671b → successors), with advance notice.
- **NOT documented:** explicit **context-length limits, structured-output support, rate limits**, and per-model pricing detail. **These must be confirmed empirically before relying on them.**

**Implication:** Ollama Cloud is a credible backend (OpenAI-compatible, tool-tested, large coder models), but its under-documented limits + model churn argue for a **thin model-abstraction layer** and a **pinned default model** with a migration plan.

---

## 6. Refuted / unproven (don't build on these)
- ❌ "Model capability is the dominant factor (21-pt frontier↔open gap)" — contested **1-2**; capability matters but the same study shows format/retrieval move open models 10–20 pts, so scaffold still matters.
- ❌ Hermes Agent's specific 3-backend-mode mechanism — refuted **0-3**; verify from code.
- ⚠️ DocLang / POML / TOON token-efficiency superiority — **no comparative benchmarks**; watch-list only.
- ⚠️ Anthropic "+30% query-at-end" and "scripts far more efficient" — vendor figures, no methodology, Claude-specific.

---

## 7. Sources (round 2)
**Format:** arXiv:2411.10541 `[primary]` · arXiv:2508.13948 (POML) `[primary]` · arXiv:2310.11324 / FormatSpread `[primary]` · arXiv:2602.05447 (file-native, Feb 2026) `[primary]` · improvingagents.com `[blog]`
**DocLang/markup:** github.com/doclang-project/doclang `[primary]` · lfaidata.foundation press 2026-06-09 `[primary]` · theregister.com 2026-06-16 `[secondary]` · abbyy.com/ai/doclang `[blog]` · github.com/microsoft/poml `[primary]`
**Skills:** platform.claude.com/.../agent-skills/overview `[primary]` · Anthropic "Complete Guide to Building Skills" PDF `[primary]` · github.com/anthropics/skills `[primary]` · swirlai / leehanchung / firecrawl / buildbetter.ai `[blog]`
**OSS agents:** hermes-agent.nousresearch.com/docs `[primary]` · github.com/NousResearch/hermes-agent `[primary]` · github.com/Gitlawb/openclaude `[primary]` · awesome-cli-coding-agents `[secondary]` · verdent.ai `[secondary]`
**Compression:** arXiv:2310.06839 (LongLLMLingua) `[primary]` · arXiv:2407.08892 (compression survey) `[primary]`
**Ollama Cloud:** docs.ollama.com/cloud `[primary]` · ollama.com/blog/cloud-models `[primary]` · ollama.com/pricing `[primary]`
