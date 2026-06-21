#!/usr/bin/env bash
node -e '
const fs = require("fs");
const c = JSON.parse(fs.readFileSync("config.json", "utf8"));
if (c.name !== "caduceus" || c.version !== "1.0.0") {
  console.error("unexpected config:", c);
  process.exit(1);
}
console.log("ok");
'
