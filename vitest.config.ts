import { configDefaults, defineConfig } from 'vitest/config';

const generatedOutput = [
  '**/.next/**',
  '**/.next-dev/**',
  '**/build/**',
  '**/coverage/**',
  '**/dist/**',
  '**/test-results/**',
];

const testFiles = ['{apps,packages}/**/__tests__/**/*.test.ts'];

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
    exclude: [...configDefaults.exclude, ...generatedOutput],
    passWithNoTests: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: testFiles,
          exclude: [
            ...configDefaults.exclude,
            ...generatedOutput,
            '**/*.integration.test.ts',
          ],
        },
      },
      {
        extends: true,
        test: {
          name: 'postgres',
          include: ['{apps,packages}/**/__tests__/**/*.integration.test.ts'],
          exclude: [...configDefaults.exclude, ...generatedOutput],
          // PostgreSQL integration suites intentionally share TEST_DATABASE_URL.
          fileParallelism: false,
        },
      },
    ],
  },
});
