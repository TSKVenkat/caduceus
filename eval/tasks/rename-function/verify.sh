#!/usr/bin/env bash
if grep -rn "greet" . --include=*.js; then
  echo "still references the old name 'greet'"
  exit 1
fi
out="$(node main.js)"
if [ "$out" != "hello" ]; then
  echo "unexpected output: $out"
  exit 1
fi
echo "ok"
