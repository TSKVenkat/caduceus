#!/usr/bin/env python3
"""Run Caduceus on SWE-bench Verified instances and emit predictions.jsonl.

For each instance: clone the repo at base_commit, run the Caduceus CLI on the
issue text, capture the resulting git diff as `model_patch`. The official
swebench harness then scores each patch in Docker (FAIL_TO_PASS / PASS_TO_PASS).

Usage: python run_agent.py <instance_id> [<instance_id> ...]
Heavy files (clones) go under /tmp (the roomy partition), never /home.
"""
import json, os, re, shutil, subprocess, sys, time
from pathlib import Path
from datasets import load_dataset

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]                      # proj1
CLI = REPO / "dist" / "cli.js"
WORK = Path("/tmp/swebench-work"); WORK.mkdir(exist_ok=True)
MAX_STEPS = os.environ.get("BENCH_MAX_STEPS", "30")
TIMEOUT = int(os.environ.get("BENCH_TIMEOUT", "1500"))

# Caduceus reads .env from its CWD; here CWD is the target repo, so pass creds through env.
env = os.environ.copy()
for line in (REPO / ".env").read_text().splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env.setdefault(k.strip(), v.strip().strip('"').strip("'"))
env["CADUCEUS_SANDBOX"] = "off"
env["CADUCEUS_APPROVAL"] = "allow"

TASK_TMPL = (
    "You are resolving a real GitHub issue in the current repository. "
    "Explore the code, make the necessary changes to the SOURCE files to fix the issue, "
    "and verify your change is coherent. Do NOT modify test files. "
    "When done, stop.\n\nISSUE:\n{problem}"
)

def sh(args, cwd=None, **kw):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True, **kw)

def main(ids):
    ds = load_dataset("princeton-nlp/SWE-bench_Verified", split="test")
    by_id = {x["instance_id"]: x for x in ds}
    preds, meta = [], []
    for iid in ids:
        x = by_id[iid]
        d = WORK / iid
        if d.exists(): shutil.rmtree(d)
        print(f"[{iid}] cloning {x['repo']} …", flush=True)
        sh(["git", "clone", "--quiet", f"https://github.com/{x['repo']}.git", str(d)], timeout=600)
        sh(["git", "checkout", "-q", x["base_commit"]], cwd=d)
        sh(["git", "config", "user.email", "b@b.co"], cwd=d)
        sh(["git", "config", "user.name", "bench"], cwd=d)

        task = TASK_TMPL.format(problem=x["problem_statement"])
        t0 = time.time()
        try:
            r = sh(["node", str(CLI), "--max-steps", MAX_STEPS, task], cwd=d, env=env, timeout=TIMEOUT)
            stderr = r.stderr or ""
        except subprocess.TimeoutExpired:
            stderr = "TIMEOUT"
        secs = round(time.time() - t0, 1)

        sh(["git", "add", "-A"], cwd=d)
        diff = sh(["git", "diff", "--cached"], cwd=d).stdout
        tok = re.search(r"(\d+) tokens", stderr)
        stp = re.search(r"(\d+) steps", stderr)
        m = {"instance_id": iid, "repo": x["repo"], "secs": secs,
             "tokens": int(tok.group(1)) if tok else None,
             "steps": int(stp.group(1)) if stp else None,
             "patch_lines": diff.count("\n"), "empty_patch": not diff.strip()}
        meta.append(m)
        preds.append({"instance_id": iid, "model_name_or_path": "caduceus-qwen3coder", "model_patch": diff})
        print(f"[{iid}] {secs}s · {m['tokens']} tok · {m['steps']} steps · patch {m['patch_lines']} lines"
              + (" · EMPTY" if m["empty_patch"] else ""), flush=True)
        # cleanup the clone to save disk
        shutil.rmtree(d, ignore_errors=True)

    # merge with any existing predictions/meta so multiple runs accumulate
    pf = HERE / "predictions.jsonl"
    existing = {}
    if pf.exists():
        for line in pf.read_text().splitlines():
            if line.strip():
                p = json.loads(line); existing[p["instance_id"]] = p
    for p in preds:
        existing[p["instance_id"]] = p
    pf.write_text("\n".join(json.dumps(existing[k]) for k in sorted(existing)) + "\n")

    mf = HERE / "agent_meta.json"
    emeta = {m["instance_id"]: m for m in (json.loads(mf.read_text()) if mf.exists() else [])}
    for m in meta:
        emeta[m["instance_id"]] = m
    mf.write_text(json.dumps([emeta[k] for k in sorted(emeta)], indent=2))
    print(f"\nmerged; predictions.jsonl now has {len(existing)} instance(s)")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: run_agent.py <instance_id> ..."); sys.exit(1)
    main(sys.argv[1:])
