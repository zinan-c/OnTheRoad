import react from "./apps/web/node_modules/@vitejs/plugin-react/dist/index.js";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    fileParallelism: false,
  },
});
