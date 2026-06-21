const assert = require("node:assert");
const { parseCSV } = require("./csv");

assert.deepStrictEqual(parseCSV("a,b,c"), [["a", "b", "c"]]);
assert.deepStrictEqual(parseCSV("a,b\nc,d"), [["a", "b"], ["c", "d"]]);
assert.deepStrictEqual(parseCSV('"x,y",z'), [["x,y", "z"]]);
assert.deepStrictEqual(parseCSV('"she said ""hi""",ok'), [['she said "hi"', "ok"]]);
console.log("ok");
