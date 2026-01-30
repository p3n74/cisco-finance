import { defineConfig } from "tsdown";

export default defineConfig({
  entry: "./src/index.ts",
  format: "esm",
  outDir: "./dist",
  clean: true,
  noExternal: [/@cisco-finance\/.*/],
  // Resolve from node_modules at runtime; bundler can't resolve from workspace db package
  external: ["@prisma/adapter-pg", "@prisma/driver-adapter-utils", "pg"],
});
