import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@skribbl/shared": resolve(import.meta.dirname, "../shared"),
    },
  },
});
