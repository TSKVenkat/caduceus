#!/usr/bin/env bash
# Full convention-benchmark run: Caduceus (no knowledge), Caduceus (with OKF
# knowledge), and Aider, over every conv-* task with repeated trials.
set -u
cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"
export PATH="$HOME/.local/bin:$PATH"
ATTEMPTS="${1:-3}"
MAXSTEPS="${2:-8}"
KEY="$(grep -E '^OLLAMA_API_KEY=' .env | cut -d= -f2-)"
MODEL="openai/qwen3-coder:480b-cloud"

echo "### Caduceus (no knowledge)"
pnpm -s eval --match conv- --attempts "$ATTEMPTS" --max-steps "$MAXSTEPS" --label conv-no-knowledge

echo "### Caduceus (with OKF knowledge)"
pnpm -s eval --match conv- --attempts "$ATTEMPTS" --max-steps "$MAXSTEPS" --knowledge --label conv-with-knowledge

echo "### Aider"
export OPENAI_API_BASE="https://ollama.com/v1"
export OPENAI_API_KEY="$KEY"
apass=0
atotal=0
for td in eval/tasks/conv-*; do
  for ((i = 1; i <= ATTEMPTS; i++)); do
    ws="$(mktemp -d)"
    cp -r "$ROOT/$td/workspace/." "$ws/"
    files=$(cd "$ws" && ls)
    ( cd "$ws" && timeout 200 aider --model "$MODEL" \
        --no-git --no-auto-commits --no-stream --no-pretty --no-check-update \
        --no-show-model-warnings --yes-always --map-tokens 0 \
        --message "$(cat "$ROOT/$td/prompt.txt")" $files >/dev/null 2>&1 )
    if ( cd "$ws" && bash "$ROOT/$td/verify.sh" >/dev/null 2>&1 ); then apass=$((apass + 1)); fi
    atotal=$((atotal + 1))
    cd "$ROOT" || exit 1
    rm -rf "$ws"
  done
done

echo
echo "===== SUMMARY — convention benchmark (12 tasks x ${ATTEMPTS} attempts) ====="
node -e '
const fs = require("fs");
const read = (f) => { try { return JSON.parse(fs.readFileSync("eval/results/" + f + ".json", "utf8")); } catch { return null; } };
const rate = (r) => r ? `${r.results.filter((x) => x.pass).length}/${r.results.length} = ${(r.resolveRate * 100).toFixed(1)}%` : "n/a";
console.log("Caduceus, no knowledge :", rate(read("conv-no-knowledge")));
console.log("Caduceus, OKF knowledge:", rate(read("conv-with-knowledge")));
'
printf "Aider                  : %d/%d = %.1f%%\n" "$apass" "$atotal" "$(node -e "console.log($apass/$atotal*100)")"
