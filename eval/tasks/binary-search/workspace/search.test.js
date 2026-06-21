const assert = require("node:assert");
const { binarySearch } = require("./search");

const a = [1, 3, 5, 7, 9, 11];
assert.strictEqual(binarySearch(a, 1), 0);
assert.strictEqual(binarySearch(a, 11), 5);
assert.strictEqual(binarySearch(a, 7), 3);
assert.strictEqual(binarySearch(a, 4), -1);
assert.strictEqual(binarySearch([], 5), -1);
assert.strictEqual(binarySearch([2], 2), 0);
console.log("ok");
