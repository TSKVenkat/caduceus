#!/usr/bin/env python3
"""Proper SWE-bench agent runner: run Caduceus INSIDE each instance's Docker
environment (repo at /testbed with deps installed), so the agent can actually
run tests and iterate — the standard methodology. Then capture its git diff as
the prediction; the official harness scores it.

Prereq: instance images built (python -m swebench.harness.prepare_images ...).
A standalone node binary lives at /tmp/cadnode/bin/node; the Caduceus repo
(dist + node_modules) is mounted read-only at /caduceus.

Usage: python run_agent_docker.py <instance_id> [<instance_id> ...]
"""
import json, os, re, subprocess, sys, time
from pathlib import Path
from datasets import load_dataset
from swebench.harness.test_spec.test_spec import make_test_spec

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
NODE_DIR = os.environ.get("CAD_NODE_DIR", "/tmp/cadnode")
MODEL = os.environ.get("CADUCEUS_MODEL", "qwen3.5:397b")
CONDA_BIN = "/opt/miniconda3/envs/testbed/bin"
PATH = f"{CONDA_BIN}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

def _load_key():
    k = os.environ.get("OLLAMA_API_KEY")
    if k:
        return k
    envf = REPO / ".env"
    if envf.exists():
        for l in envf.read_text().splitlines():
            if l.startswith("OLLAMA_API_KEY="):
                return l.split("=", 1)[1].strip().strip('"').strip("'")
    return None

key = _load_key()

TASK = ("You are resolving a real GitHub issue in this repository, checked out at /testbed "
        "with its dependencies installed. Explore the code, run the project's tests to reproduce "
        "and confirm, make the necessary changes to the SOURCE files, and verify the fix. "
        "Do NOT edit test files. Stop when done.\n\nISSUE:\n{problem}")

def dexec(cname, args, **kw):
    return subprocess.run(["docker", "exec", "-w", "/testbed", cname, *args],
                          capture_output=True, text=True, **kw)

def run_one(x):
    iid = x["instance_id"]
    image = make_test_spec(x).instance_image_key
    cname = "cad_" + re.sub(r"[^a-zA-Z0-9_]", "_", iid)[:50]
    subprocess.run(["docker", "rm", "-f", cname], capture_output=True)
    subprocess.run(["docker", "run", "-d", "--name", cname,
                    "-v", f"{REPO}:/caduceus:ro", "-v", f"{NODE_DIR}:/cadnode:ro",
                    image, "tail", "-f", "/dev/null"], check=True, capture_output=True)
    try:
        # clean any pre-existing dirty state so our diff is only the agent's work
        dexec(cname, ["git", "reset", "--hard", "-q"]); dexec(cname, ["git", "clean", "-qdfx", "--exclude=.git"])
        t0 = time.time()
        try:
            r = subprocess.run(
                ["docker", "exec", "-w", "/testbed",
                 "-e", f"OLLAMA_API_KEY={key}", "-e", f"CADUCEUS_MODEL={MODEL}",
                 "-e", "CADUCEUS_SANDBOX=off",
                 "-e", "CADUCEUS_APPROVAL=allow", "-e", f"PATH={PATH}", "-e", "HOME=/root",
                 cname, "/cadnode/bin/node", "/caduceus/dist/cli.js", "--max-steps", "40",
                 TASK.format(problem=x["problem_statement"])],
                capture_output=True, text=True, timeout=2400)
            stderr = r.stderr or ""
        except subprocess.TimeoutExpired:
            stderr = "TIMEOUT"
        secs = round(time.time() - t0, 1)
        dexec(cname, ["git", "add", "-A"])
        diff = dexec(cname, ["git", "diff", "--cached", "--", ".", ":(exclude)*/test*", ":(exclude)test*"]).stdout
        tok = re.search(r"(\d+) tokens", stderr); stp = re.search(r"(\d+) steps", stderr)
        meta = {"instance_id": iid, "repo": x["repo"], "secs": secs,
                "tokens": int(tok.group(1)) if tok else None,
                "steps": int(stp.group(1)) if stp else None,
                "patch_lines": diff.count("\n"), "empty_patch": not diff.strip()}
        if meta["empty_patch"] or meta["tokens"] is None:
            tail = "\n".join((stderr or "").strip().splitlines()[-8:])
            print(f"  [!] agent produced no result. CLI stderr tail:\n{tail}\n", flush=True)
        return diff, meta
    finally:
        subprocess.run(["docker", "rm", "-f", cname], capture_output=True)

def main(ids):
    ds = load_dataset("princeton-nlp/SWE-bench_Verified", split="test")
    by_id = {x["instance_id"]: x for x in ds}
    pf = HERE / "predictions_docker.jsonl"
    mf = HERE / "agent_meta_docker.json"
    preds = {}
    if pf.exists():
        for line in pf.read_text().splitlines():
            if line.strip():
                p = json.loads(line); preds[p["instance_id"]] = p
    meta = {m["instance_id"]: m for m in (json.loads(mf.read_text()) if mf.exists() else [])}
    for iid in ids:
        print(f"[{iid}] running in-container …", flush=True)
        diff, m = run_one(by_id[iid])
        preds[iid] = {"instance_id": iid, "model_name_or_path": "caduceus-qwen3coder", "model_patch": diff}
        meta[iid] = m
        print(f"[{iid}] {m['secs']}s · {m['tokens']} tok · {m['steps']} steps · patch {m['patch_lines']} lines"
              + (" · EMPTY" if m['empty_patch'] else ""), flush=True)
        pf.write_text("\n".join(json.dumps(preds[k]) for k in sorted(preds)) + "\n")
        mf.write_text(json.dumps([meta[k] for k in sorted(meta)], indent=2))
    print(f"\nwrote {pf} ({len(preds)} predictions)")

if __name__ == "__main__":
    main(sys.argv[1:])
