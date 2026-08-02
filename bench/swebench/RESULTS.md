# SWE-bench Verified — results

Run via the CI matrix (`.github/workflows/swebench-bench.yml`): agent runs inside
each instance's Docker env, scored by the official grader. See
[README.md](README.md) for the methodology and [../../docs/BENCHMARKS.md](../../docs/BENCHMARKS.md)
for the honest write-up and caveats.

## Random sample, n=15 · model `glm-5.1`

**resolved: 6/15 = 40.0%** (95% Wilson CI: 19.8%–64.3%) · 0 infra errors

| instance | result |
| --- | --- |
| django__django-10880 | resolved |
| django__django-11087 | no edit (budget) |
| django__django-11163 | resolved |
| django__django-11433 | no edit (budget) |
| django__django-12273 | no edit (budget) |
| django__django-14725 | wrong patch |
| django__django-15315 | resolved |
| django__django-15695 | no edit (budget) |
| matplotlib__matplotlib-21568 | no edit (budget) |
| matplotlib__matplotlib-24970 | resolved |
| pydata__xarray-2905 | resolved |
| pytest-dev__pytest-5262 | resolved |
| sphinx-doc__sphinx-9602 | no edit (budget) |
| sympy__sympy-18211 | no edit (budget) |
| sympy__sympy-22080 | wrong patch |

Caveats: small random sample (wide CI); open mid-tier model + general-purpose
scaffold (frontier harnesses reach ~65%); SWE-bench Verified is public
(memorization); "no edit (budget)" = the agent hit its 40-step budget on a large
repo without landing a source change — the main scaffold-improvement target.

Seed lists for larger unbiased runs: `sample15.txt`, `sample25.txt`, `sample50.txt`.
