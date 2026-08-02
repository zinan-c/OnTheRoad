import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ["browser/**", "e2e/**", "node_modules/**", ".next/**", "dist/**"],
  },
});
