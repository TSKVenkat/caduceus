# SWE-bench Verified — Caduceus harness

Runs Caduceus on real [SWE-bench Verified](https://www.swebench.com/) instances
**the standard way** and scores it with the **official Docker harness**.

## The methodology (why it's fair)

For each instance:

1. **Build** the instance's Docker image (`build_images.py`) — the repo at
   `base_commit` with its dependencies installed, exactly as SWE-bench prescribes.
2. **Run the agent inside that container** (`run_agent_docker.py`): Caduceus runs
   in `/testbed` with the project's env on `PATH`, so it can actually **run the
   tests, reproduce the bug, and iterate** — not just guess. It's given only the
   issue text; the resulting `git diff` is the prediction.
3. **Score** with the official harness (`swebench.harness.run_evaluation`): it
   applies the patch and the hidden test patch in a fresh container and checks
   `FAIL_TO_PASS` + `PASS_TO_PASS`. An instance is *resolved* only if the tests pass.

Same model everywhere: `qwen3-coder:480b-cloud` (Ollama Cloud) — an open,
mid-tier model. Published harnesses on the leaderboard use **frontier** models
(e.g. mini-SWE-agent ~65% with Claude 4.5 Sonnet), so Caduceus's number is
expected to be far lower. The point is a **real, reproducible number on the same
benchmark**, with a confidence interval — not to top the board.

> An earlier version of this harness ran the agent on a bare host clone with **no
> dependencies installed**, so it couldn't run tests. That was wrong and its
> numbers were discarded. This harness runs the agent in-environment.

## Run locally

```bash
pip install "swebench>=4,<5" datasets          # in a venv
pnpm build                                      # dist/cli.js
# a portable node for inside the containers:
mkdir -p /tmp/cadnode && curl -sL https://nodejs.org/dist/v20.18.1/node-v20.18.1-linux-x64.tar.xz | tar xJ -C /tmp/cadnode --strip-components=1

python bench/swebench/build_images.py pallets__flask-5014
python bench/swebench/run_agent_docker.py pallets__flask-5014          # needs OLLAMA_API_KEY (env or .env)
python -m swebench.harness.run_evaluation -d princeton-nlp/SWE-bench_Verified \
  -p bench/swebench/predictions_docker.jsonl -id local -i pallets__flask-5014 --cache_level env
python bench/swebench/report.py caduceus-qwen3coder.local.json bench/swebench/agent_meta_docker.json
```

Needs Docker, ~120 GB free disk for a large run, and `OLLAMA_API_KEY`.

## Run in CI

`.github/workflows/swebench-bench.yml` does all of the above on a GitHub runner.
Trigger it from the Actions tab (or `gh workflow run "SWE-bench (Caduceus)"`),
optionally passing `instances` (space-separated ids) and `max_steps`. Requires
the `OLLAMA_API_KEY` repository secret. Results (predictions, per-instance cost,
the official report) are uploaded as an artifact and summarized in the run.

`sample15.txt` / `sample25.txt` are seeded random draws for larger, unbiased runs.
