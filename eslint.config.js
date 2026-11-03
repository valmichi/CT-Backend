const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['node_modules/', 'coverage/']
  },
  js.configs.recommended,
  {
    // Backend (Node.js, CommonJS)
    files: ['src/**/*.js', 'tests/**/*.js', '*.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      // `next` es obligatorio en la firma de los manejadores de error de Express
      'no-unused-vars': ['error', { argsIgnorePattern: '^(next|_)' }]
    }
  },
  {
    // Dashboard docente (navegador)
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser }
    }
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.jest }
    }
  }
];
