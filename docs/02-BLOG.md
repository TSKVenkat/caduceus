# We read the 2025–2026 agent research so you don't have to — then designed an open coding agent around it

*How a deep-research sweep of Nous Hermes, Google's context-engineering guidance, and ~20 recent papers led us to one opinionated design: a single-agent, self-improving coding agent we call **Caduceus**.*

---

## The premise

There's a lot of agent hype and not much agreement. So we ran a structured deep-research pass: five search angles, 22 sources, **100 falsifiable claims extracted, and the 25 most important ones put through three independent adversarial verifiers** — a claim only survived if it *wasn't* refuted by at least two of three skeptics. Twenty-five out of twenty-five survived. Then we asked a simple question: *if you wanted to build something exactly like Hermes — open, steerable, agentic — what does the evidence say to actually build?*

The answer turned out to be refreshingly opinionated. Here it is.

---

## Finding 1: For coding, one good agent beats a committee

The most seductive idea in agent-land is "just add more agents." The data says: usually don't.

A controlled study across **260 configurations** found multi-agent outcomes ranging from **−70%** (a planning task with independent agents) to **+80.8%** (a finance task with a centralized coordinator). The deciding factor wasn't intelligence — it was **topology and task decomposability**. And errors compound as you decentralize: relative to a single agent (1.0×), error amplification climbed to 4.4× centralized, 7.8× decentralized, and a catastrophic **17.2× for fully independent agents**.

For our use-case — coding — the verdict was blunt: on SWE-bench Verified, multi-agent systems showed **consistent degradation** wherever the single-agent baseline already cleared 45%. Multi-agent earns its keep on cleanly separable work (the finance task showed agents genuinely exchanging useful information, r=0.71) — but it costs roughly **4× more** for a couple of accuracy points ($47K/mo vs $22.7K/mo in one comparison).

**So Caduceus is a single agent by default.** Multi-agent is a deliberate escalation for provably decomposable tasks, not a starting posture.

---

## Finding 2: The scaffold *is* half the score

Here's the finding that reframes everything. Take one fixed model and wrap it in three different agent harnesses. On SWE-bench Pro, the same Claude Opus 4.5 scored anywhere from **50.2% to 55.4%** — a 5.2-point spread coming *entirely* from how each harness managed context and tool calls. On GAIA, scaffolding can move the same model by **~30 points**.

That means the model is necessary but not sufficient. The agent loop, the retrieval, the tool definitions, the context window discipline — that's the product. It's why we gave the scaffold its own name (**Caduceus**, the staff Hermes carries) and treat the model as swappable.

It also sets a sober ceiling. On Toolathlon — 32 apps, 604 tools, realistic long-horizon tasks — the *best closed model* managed only 38.6%, and the **best open-weight model just 20.1%**. A great scaffold extracts every point a scaffold can extract; it cannot conjure capability the base model lacks. Honesty about that gap is part of the design.

---

## Finding 3: Why Hermes specifically

If the scaffold is half the score, the other half should be a model built *for* scaffolding. Hermes is.

- **A native tool-calling format.** Hermes was trained on the Hermes Function-Calling standard — tool schemas in `<tools>`, calls in `<tool_call>`, results in `<tool_response>`, citations in `<co>`. Its predecessor hit ~90% function-calling accuracy where general models of the same size managed 60–70%. Tool use isn't bolted on; it's in the training data.
- **Reasoning primitives as tokens.** Hermes 3 trained on reserved tokens like `<PLAN>`, `<SCRATCHPAD>`, `<REASONING>`, `<REFLECTION>` — the exact verbs of an agent loop are first-class.
- **Schema adherence with repair.** Hermes 4.3 is trained to emit valid JSON for a given schema *and to repair malformed objects* — which is precisely the failure you fight most in production tool use.
- **Neutral alignment = a real control surface.** This is the subtle one. Hermes follows the system prompt "exactly and neutrally." In the 405B model, an *empty* system prompt doesn't even summon a default "helpful assistant" persona. For an agent builder that's a gift: the system prompt is a hard steering wheel, not a polite suggestion. We design `system.md` to fully constitute the agent and exploit that.

And it's open weights, with automatic parsers in vLLM and SGLang. You can actually run this.

---

## Finding 4: Context is a filesystem, not a transcript

The piece the request was chasing — "a Google blog on folder structure for agents" — turned out to be a *convergence* of three independent sources, which is stronger than any single post:

- **Google's ADK guidance** (Dec 2025): treat context as a first-class system with four tiers — **Working Context, Session, Memory, Artifacts** — and *rebuild the working context every invocation* instead of growing a mutable buffer. Store 5MB files as artifacts loaded on demand, not 5MB of noise in every prompt. Summarize old events asynchronously. Pin stable instructions at the front for caching.
- **Google Cloud** (Apr 2026): three lifetimes — **Persistent** (system rules), **Semi-persistent** (memory), **Transient** (live data) — described with a "labeled filing cabinet" metaphor. Context caching can cut token cost up to 90%.
- **An academic paper** (Dec 2025): literally *"everything is a file"* — a Unix-style filesystem abstraction for context, with mounting, metadata, and access control, and a Constructor → Loader → Evaluator pipeline.

Three sources, one shape: **context is a tiered, governed, file-like store, and the prompt is assembled from it per turn.** So Caduceus ships a real on-disk `.caduceus/` layout — `persistent/`, `session/`, `memory/`, `artifacts/`, `trace/` — and a Context Builder that constructs each turn's window fresh, loads artifacts only when referenced, and compacts (never truncates) when it hits the token budget. That discipline also defends against the four documented ways context rots — poisoning, distraction, confusion, and clash — none of which a bigger window fixes.

---

## Finding 5: Memory in three tiers, and self-improvement without retraining

An LLM is a stateless function; memory has to be engineered around it. The consensus split is **working / long-term / episodic**, and the most interesting tier is episodic.

**Reflexion** showed that an agent can *write down what went wrong in plain language*, store it in an episodic buffer, and do better next time — no weight updates. It hit 91% pass@1 on HumanEval, beating the GPT-4 of its day. Caduceus uses exactly this: on a failed attempt it records `{task, what-happened, reflection}`, and retrieves relevant reflections when it sees a similar task again.

We keep one eye open about scale, though: even the best memory systems lose ~25% of their score going from 1M to 10M tokens. More memory is not free accuracy.

---

## Finding 6: Lean tools that grow themselves

The best single-agent result we found, **Live-SWE-agent**, hits **79.2% on SWE-bench Verified at $0.86 a task** — and it starts with *only a minimal bash toolset*, then **writes its own tools at runtime** when reflection suggests one would help. That's the opposite of the "give the agent 200 tools" instinct.

It pairs with **MemTool**'s finding that you shouldn't cram every tool schema into every prompt: manage the tool *context* dynamically. The catch — frontier reasoning models manage their own tool memory at 90–94% efficiency, but mid-size models drop to 0–60%. Since a 36B Hermes sits in the middle, Caduceus uses MemTool's **Hybrid mode**: the harness deterministically scopes which tools are in play, and the model picks within that set. Best of both, per the measurements.

---

## Finding 7: Don't trust the leaderboard

Last, a warning baked into the design. Public agent benchmarks are inflated an estimated **5–15 points** by contamination, scaffolding, and single-run reporting. One study found **32.67%** of "successful" SWE-bench Verified patches involved solution leakage, with models recalling correct file paths up to 76% of the time — and OpenAI's evals team **stopped reporting SWE-bench Verified in early 2026** after finding 60%+ of audited tasks unsolvable as written.

So Caduceus's eval harness runs a **private, held-out task suite**, reports **pass^k** (single runs hide 20+ points of variance), and treats public numbers as a contaminated upper bound — not a target to overfit.

---

## The design, in one breath

> **Caduceus** is a single Hermes-model coding agent. Context lives in a tiered on-disk filesystem and is rebuilt every turn. Memory is working + long-term + episodic, with Reflexion-style self-improvement. The toolset starts minimal and grows itself at runtime, with tool context managed in MemTool hybrid mode. The loop is bounded, reflective, and fully logged. And nothing ships until it passes a private eval suite measured with pass^k.

Every one of those clauses is a line item from a verified research finding — not a vibe. The full citations are in `00-RESEARCH-REPORT.md`, the buildable detail in `01-TECHNICAL-SPEC.md`, and the plan in `03-BUILD-PLAN.md`.

*Hermes carries the message. Caduceus is the staff that makes it land.*
