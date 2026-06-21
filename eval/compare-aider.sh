#!/usr/bin/env bash
# Head-to-head: run Aider on the same task suite Caduceus is evaluated on,
# same model (Ollama Cloud), same hidden verifiers. Resolve rate + wall-clock.
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"
export PATH="$HOME/.local/bin:$PATH"

KEY="$(grep -E '^OLLAMA_API_KEY=' .env | cut -d= -f2-)"
export OPENAI_API_BASE="https://ollama.com/v1"
export OPENAI_API_KEY="$KEY"
MODEL="${CADUCEUS_MODEL:-openai/qwen3-coder:480b-cloud}"

# Standard tasks only (the convention tasks depend on the OKF layer Aider lacks).
tasks=(binary-search create-config-file csv-parse expression-eval fix-failing-test \
       fix-syntax-error implement-fizzbuzz lru-cache multi-file-bug rename-function)

pass=0
total=0
printf "%-22s %-6s %5s\n" "task" "result" "secs"
for t in "${tasks[@]}"; do
  td="$ROOT/eval/tasks/$t"
  ws="$(mktemp -d)"
  cp -r "$td/workspace/." "$ws/"
  files=$(cd "$ws" && ls)
  start=$(date +%s)
  ( cd "$ws" && timeout 300 aider --model "$MODEL" \
      --no-git --no-auto-commits --no-stream --no-pretty --no-check-update \
      --no-show-model-warnings --yes-always --map-tokens 0 \
      --message "$(cat "$td/prompt.txt")" $files >/dev/null 2>&1 )
  secs=$(( $(date +%s) - start ))
  if ( cd "$ws" && bash "$td/verify.sh" >/dev/null 2>&1 ); then
    res="PASS"; pass=$((pass+1))
  else
    res="FAIL"
  fi
  total=$((total+1))
  printf "%-22s %-6s %5s\n" "$t" "$res" "$secs"
  cd "$ROOT" || exit 1
  rm -rf "$ws"
done

echo
echo "Aider resolve rate: $pass/$total"
