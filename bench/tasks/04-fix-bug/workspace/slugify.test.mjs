import test from "node:test";
import assert from "node:assert";
import { slugify } from "./slugify.mjs";
test("basic", () => assert.equal(slugify("Hello World"), "hello-world"));
test("punctuation collapses", () => assert.equal(slugify("Hello,  World!!"), "hello-world"));
test("trims edges", () => assert.equal(slugify("  --Hi--  "), "hi"));
