import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  sourcemap: true,
  // Make the built entry directly executable as `econome`.
  banner: { js: "#!/usr/bin/env node" },
});
