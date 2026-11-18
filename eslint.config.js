import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const CYRILLIC = '/[А-Яа-яЁё]/';
const I18N_MESSAGE = 'Тексты интерфейса — только через i18n-ключи (apps/web/messages/ru.json).';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/migrations/**',
      '**/coverage/**',
      'apps/web/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'log'] }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/**/*.test.ts'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // Весь текст интерфейса — через i18n: кириллица в коде фронта запрещена.
      'no-restricted-syntax': [
        'error',
        { selector: `Literal[value=${CYRILLIC}]`, message: I18N_MESSAGE },
        { selector: `TemplateElement[value.raw=${CYRILLIC}]`, message: I18N_MESSAGE },
        { selector: `JSXText[value=${CYRILLIC}]`, message: I18N_MESSAGE },
      ],
    },
  },
);
