cat > _check.mjs <<'JS'
import { groupAnagrams } from "./anagram.mjs";
const g = groupAnagrams(["eat","tea","tan","ate","nat","bat"]);
const norm = g.map(a=>[...a].sort().join(",")).sort();
const key = norm.map(s=>s.split(",").sort().join("|")).sort().join(" ; ");
// expected groups (as sorted sets of words)
const want = [["ate","eat","tea"],["nat","tan"],["bat"]]
  .map(a=>a.sort().join("|")).sort().join(" ; ");
if (key !== want) process.exit(1);
process.exit(0);
JS
node _check.mjs
