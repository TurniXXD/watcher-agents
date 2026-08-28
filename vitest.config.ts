import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    include: ['{apps,packages}/**/__tests__/**/*.test.ts'],
    passWithNoTests: false,
  },
});
