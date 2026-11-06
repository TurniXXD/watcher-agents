import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/.cache/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/generated/**',
      '**/.next/**',
      '**/.next-dev/**',
      '**/.source/**',
      '**/.turbo/**',
      '**/test-results/**',
      '**/next-env.d.ts',
      '**/*.tsbuildinfo',
      '**/*.config.ts',
      'deploy/runtime/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: false },
      ],
      '@typescript-eslint/only-throw-error': 'error',
    },
  },
  {
    files: ['**/__tests__/**/*.ts'],
    rules: { '@typescript-eslint/require-await': 'off' },
  },
  prettier,
);
