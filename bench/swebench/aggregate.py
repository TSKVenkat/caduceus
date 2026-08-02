#!/usr/bin/env python3
"""Aggregate multiple per-instance swebench report JSONs into one honest summary:
overall resolved rate with a 95% Wilson CI, plus a per-instance table.
Usage: python aggregate.py report1.json report2.json ..."""
import json, math, sys
from pathlib import Path

def wilson(k, n, z=1.96):
    if n == 0: return (0.0, 0.0)
    p = k / n; d = 1 + z*z/n; c = p + z*z/(2*n)
    m = z*math.sqrt(p*(1-p)/n + z*z/(4*n*n))
    return ((c-m)/d, (c+m)/d)

rows, resolved, errors, empty, total = [], 0, 0, 0, 0
for f in sys.argv[1:]:
    try:
        d = json.load(open(f))
    except Exception:
        continue
    res = set(d.get("resolved_ids", []))
    err = set(d.get("error_ids", []))
    emp = set(d.get("empty_patch_ids", []))
    for iid in d.get("submitted_ids", []):
        status = "RESOLVED" if iid in res else ("error" if iid in err else ("empty" if iid in emp else "unresolved"))
        rows.append((iid, status))
    total += d.get("total_instances", 0)
    resolved += len(res); errors += len(err); empty += len(emp)

lo, hi = wilson(resolved, total)
print("# SWE-bench Verified — Caduceus")
print(f"\n**resolved: {resolved}/{total} = {100*resolved/total:.1f}%**  (95% Wilson CI: {100*lo:.1f}%–{100*hi:.1f}%)")
print(f"\nunresolved: {total-resolved-errors}  ·  infra-errors: {errors}  ·  empty patches: {empty}\n")
print("| instance | result |")
print("| --- | --- |")
for iid, st in sorted(rows):
    print(f"| {iid} | {st} |")
