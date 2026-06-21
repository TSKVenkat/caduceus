#!/usr/bin/env python3
"""Long-lived LLMLingua compression sidecar.

Loads Microsoft's LLMLingua-2 model once, then answers line-delimited JSON
requests on stdin with line-delimited JSON responses on stdout. This uses the
real `llmlingua` library (https://github.com/microsoft/LLMLingua) — there is no
heuristic substitute here.

Protocol:
  -> {"id": 1, "text": "...", "rate": 0.5}
  <- {"type": "result", "id": 1, "compressed": "...", "originTokens": N, "compressedTokens": M}
On startup it emits {"type": "ready", "model": "..."} once the model is loaded.
"""
import json
import os
import sys


def main() -> None:
    from llmlingua import PromptCompressor

    model = os.environ.get(
        "CADUCEUS_LLMLINGUA_MODEL",
        "microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank",
    )
    device = os.environ.get("CADUCEUS_LLMLINGUA_DEVICE", "cpu")

    compressor = PromptCompressor(model_name=model, use_llmlingua2=True, device_map=device)
    print(json.dumps({"type": "ready", "model": model}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req_id = None
        try:
            req = json.loads(line)
            req_id = req.get("id")
            text = req["text"]
            rate = float(req.get("rate", 0.5))
            result = compressor.compress_prompt(text, rate=rate)
            print(
                json.dumps(
                    {
                        "type": "result",
                        "id": req_id,
                        "compressed": result["compressed_prompt"],
                        "originTokens": int(result["origin_tokens"]),
                        "compressedTokens": int(result["compressed_tokens"]),
                    }
                ),
                flush=True,
            )
        except Exception as exc:  # report all errors back to the client
            print(json.dumps({"type": "error", "id": req_id, "error": str(exc)}), flush=True)


if __name__ == "__main__":
    main()
