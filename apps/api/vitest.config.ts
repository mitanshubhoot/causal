import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    // Each file stubs process.env + module singletons (config, the Anthropic
    // client), so files must not share a module registry.
    isolate: true,
  },
});
