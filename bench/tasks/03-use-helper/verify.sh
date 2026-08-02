cat > _check.mjs <<'JS'
import { receipt } from "./receipt.mjs";
if (receipt(0) !== "Total: FREE") process.exit(1);
if (receipt(105) !== "Total: $1.05") process.exit(1);
process.exit(0);
JS
node _check.mjs
