#!/usr/bin/env bash
node -e '
const { errorCode } = require("./errors");
const ok =
  errorCode("not_found") === "E_NOT_FOUND" &&
  errorCode("bad input") === "E_BAD_INPUT";
if (!ok) {
  console.error("got:", errorCode("not_found"), errorCode("bad input"));
  process.exit(1);
}
console.log("ok");
'
