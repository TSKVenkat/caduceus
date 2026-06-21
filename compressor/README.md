# LLMLingua compressor

A sidecar that runs the **real** [Microsoft LLMLingua](https://github.com/microsoft/LLMLingua) library (LLMLingua-2) to compress prompt/context text. The agent (TypeScript) talks to it over a line-delimited JSON protocol on stdin/stdout; the model is loaded once and kept warm.

This is the actual library — not a heuristic token-dropper.

## Setup

LLMLingua pulls in `torch` and `transformers` and downloads a ~700 MB model on
first use, so install it into a virtualenv on a partition with room (a few GB).

```bash
# from the repo root; uses uv (https://docs.astral.sh/uv/)
VENV=compressor/.venv            # or e.g. /opt/caduceus/.venv on a roomier partition
uv venv "$VENV" --python python3

# CPU-only torch (strictly from the CPU index — the PyPI default is the multi-GB CUDA build)
uv pip install --no-cache --python "$VENV/bin/python" \
  --index-url https://download.pytorch.org/whl/cpu torch
uv pip install --no-cache --python "$VENV/bin/python" llmlingua numpy
```

If `$VENV` is not `compressor/.venv`, point the agent at it:

```bash
export CADUCEUS_PYTHON="$VENV/bin/python"
export CADUCEUS_HF_HOME=/path/with/room/hf   # where the model is cached
```

## Use

```bash
pnpm compress README.md --rate 0.5     # keep ~50% of tokens
cat somefile | pnpm compress --rate 0.4
```

`--rate` is the fraction of tokens to keep (lower = more aggressive).

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `CADUCEUS_PYTHON` | `compressor/.venv/bin/python` if present, else `python3` | Python that has `llmlingua` |
| `CADUCEUS_HF_HOME` | unset (HuggingFace default) | model cache location |
| `CADUCEUS_LLMLINGUA_MODEL` | `microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank` | scoring model |
| `CADUCEUS_LLMLINGUA_DEVICE` | `cpu` | `cpu` or `cuda` |
