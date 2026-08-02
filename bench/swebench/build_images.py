#!/usr/bin/env python3
"""Build SWE-bench instance Docker images (no test run) for given instances,
so the agent can run inside them. Replicates run_evaluation's build phase.
Usage: python build_images.py <instance_id> ..."""
import sys, docker
from datasets import load_dataset
from swebench.harness.docker_build import build_env_images, build_instance_images

ids = set(sys.argv[1:])
ds = load_dataset("princeton-nlp/SWE-bench_Verified", split="test")
subset = [x for x in ds if x["instance_id"] in ids]
print(f"building {len(subset)} instance image(s)…", flush=True)
client = docker.from_env()
build_env_images(client, subset, False, 4, None, "latest", "latest")
build_instance_images(client, subset, False, 4, None, "latest", "latest")
print("done building.")
