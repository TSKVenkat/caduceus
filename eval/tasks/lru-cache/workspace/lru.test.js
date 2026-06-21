const assert = require("node:assert");
const { LRUCache } = require("./lru");

const c = new LRUCache(2);
c.put(1, 1);
c.put(2, 2);
assert.strictEqual(c.get(1), 1); // 1 is now most-recent
c.put(3, 3); // evicts key 2
assert.strictEqual(c.get(2), -1);
c.put(4, 4); // evicts key 1
assert.strictEqual(c.get(1), -1);
assert.strictEqual(c.get(3), 3);
assert.strictEqual(c.get(4), 4);
console.log("ok");
