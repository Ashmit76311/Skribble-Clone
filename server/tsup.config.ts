import { defineConfig } from "tsup";
import fs from "fs";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  noExternal: ["@skribbl/shared"],
  onSuccess: async () => {
    fs.copyFileSync("words.json", "dist/words.json");
  },
});
