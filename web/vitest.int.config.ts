import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests against the Firebase emulators (see package.json "test:int"); not part of `npm test`.
export default defineConfig({
  resolve: { alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) } },
  test: { environment: "node", include: ["test-int/**/*.test.ts"], testTimeout: 30000, hookTimeout: 30000 },
});
