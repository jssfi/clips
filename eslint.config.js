const globals = require('globals');

const correctnessRules = {
  'constructor-super': 'error',
  'for-direction': 'error',
  'getter-return': 'error',
  'no-async-promise-executor': 'error',
  'no-class-assign': 'error',
  'no-compare-neg-zero': 'error',
  'no-constant-binary-expression': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-dupe-args': 'error',
  'no-dupe-class-members': 'error',
  'no-dupe-else-if': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-loss-of-precision': 'error',
  'no-new-native-nonconstructor': 'error',
  'no-obj-calls': 'error',
  'no-self-assign': 'error',
  'no-setter-return': 'error',
  'no-shadow-restricted-names': 'error',
  'no-sparse-arrays': 'error',
  'no-unexpected-multiline': 'error',
  'no-unreachable': 'error',
  'no-unreachable-loop': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-useless-backreference': 'error',
  'no-useless-catch': 'error',
  'no-useless-escape': 'error',
  'no-with': 'error',
  'require-yield': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error'
};

module.exports = [
  { ignores: ['dist/**', 'node_modules/**', 'vendor/**', '.clips-dev/**', 'clips-worker/public/**', '**/worker-configuration.d.ts'] },
  {
    files: ['eslint.config.js', 'src/**/*.js', 'scripts/**/*.js', 'scripts/**/*.mjs', 'test/**/*.js', 'clips-worker/src/**/*.js', 'clips-worker/scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node, ...globals.browser }
    },
    rules: { ...correctnessRules, 'no-undef': 'error' }
  },
  {
    files: ['scripts/**/*.mjs', 'clips-worker/scripts/**/*.mjs'],
    languageOptions: { sourceType: 'module' }
  }
];
