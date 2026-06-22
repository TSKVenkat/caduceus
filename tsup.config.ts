import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts", "src/web/cli.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  dts: true,
  sourcemap: true,
});
