import react from "./apps/web/node_modules/@vitejs/plugin-react/dist/index.js";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["**/*.{test,spec,e2e-spec}.?(c|m)[jt]s?(x)"],
    fileParallelism: false,
  },
});
