import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/secrets.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: false,
  clean: true,
  minify: false,
});
