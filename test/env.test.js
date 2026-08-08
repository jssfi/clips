const test = require('node:test');
const assert = require('node:assert/strict');
const { parseEnv, required } = require('../scripts/env');

test('environment files support comments, spacing, and quoted values', () => {
  assert.deepEqual(parseEnv('# comment\nDOMAIN = clips.example.com\nPATH="/telemetry"\n'), {
    DOMAIN: 'clips.example.com',
    PATH: '/telemetry'
  });
});

test('required environment values fail closed', () => {
  assert.throws(() => required({ PRESENT: 'yes' }, ['PRESENT', 'MISSING']), /MISSING/);
});
