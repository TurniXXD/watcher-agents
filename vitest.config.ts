import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // PostgreSQL integration suites intentionally share TEST_DATABASE_URL.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    include: ['{apps,packages}/**/__tests__/**/*.test.ts'],
    passWithNoTests: false,
  },
});
