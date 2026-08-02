#!/usr/bin/env python3
"""Summarize a SWE-bench evaluation report honestly: resolved rate with a
95% Wilson confidence interval, a per-repo breakdown, and agent cost stats.

Usage: python report.py <swebench_report.json> [agent_meta.json]
"""
import json, math, sys, statistics as st
from collections import defaultdict

def wilson(k, n, z=1.96):
    if n == 0: return (0.0, 0.0)
    p = k / n
    d = 1 + z*z/n
    c = p + z*z/(2*n)
    m = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))
    return ((c-m)/d, (c+m)/d)

rep = json.load(open(sys.argv[1]))
meta = {m["instance_id"]: m for m in json.load(open(sys.argv[2]))} if len(sys.argv) > 2 else {}

n = rep["total_instances"]
resolved = set(rep["resolved_ids"])
errors = set(rep.get("error_ids", []))
empty = set(rep.get("empty_patch_ids", []))
k = len(resolved)
lo, hi = wilson(k, n)

print(f"SWE-bench Verified — {n} instances")
print(f"resolved: {k}/{n} = {100*k/n:.1f}%   (95% Wilson CI: {100*lo:.1f}%–{100*hi:.1f}%)")
print(f"unresolved: {n-k-len(errors)}   infra-errors: {len(errors)}   empty patches: {len(empty)}")

# per repo
byrepo = defaultdict(lambda: [0, 0])
allids = rep["submitted_ids"]
for iid in allids:
    repo = iid.rsplit("-", 1)[0]
    byrepo[repo][1] += 1
    if iid in resolved: byrepo[repo][0] += 1
print("\nby repo:")
for repo in sorted(byrepo):
    r, t = byrepo[repo]
    print(f"  {repo:34s} {r}/{t}")

# cost
if meta:
    toks = [m["tokens"] for m in meta.values() if m.get("tokens")]
    steps = [m["steps"] for m in meta.values() if m.get("steps")]
    secs = [m["secs"] for m in meta.values() if m.get("secs")]
    if toks:
        print(f"\nagent cost (median): {int(st.median(toks)):,} tokens · "
              f"{int(st.median(steps))} steps · {st.median(secs):.0f}s per instance")
