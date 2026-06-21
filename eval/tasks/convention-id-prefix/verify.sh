#!/usr/bin/env bash
node -e '
const { createUser } = require("./users");
const a = createUser("Alice");
const b = createUser("Bob Smith");
const ok =
  a && a.id === "usr_alice" && a.name === "Alice" &&
  b && b.id === "usr_bob_smith" && b.name === "Bob Smith";
if (!ok) { console.error("got:", a, b); process.exit(1); }
console.log("ok");
'
