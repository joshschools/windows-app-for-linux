'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { shouldRetryCrash } = require('../src/recovery');

// Regression: with MAX = 1 the original code did `crashCount++` then checked
// `crashCount < MAX` -> `1 < 1` -> false, so it never reloaded. The fix checks
// attempts-so-far BEFORE incrementing, so the first crash does reload.
test('reloads once on the first crash, then gives up', () => {
  assert.equal(shouldRetryCrash('crashed', 0, 1), true);  // first crash -> reload
  assert.equal(shouldRetryCrash('crashed', 1, 1), false); // already retried once -> stop
});

test('honors a higher retry budget', () => {
  assert.equal(shouldRetryCrash('crashed', 0, 3), true);
  assert.equal(shouldRetryCrash('crashed', 2, 3), true);
  assert.equal(shouldRetryCrash('crashed', 3, 3), false);
});

test('only retries actual crashes', () => {
  assert.equal(shouldRetryCrash('killed', 0, 1), false);
  assert.equal(shouldRetryCrash('oom', 0, 1), false);
  assert.equal(shouldRetryCrash('clean-exit', 0, 1), false);
});

test('rejects invalid inputs', () => {
  assert.equal(shouldRetryCrash('crashed', -1, 1), false);
  assert.equal(shouldRetryCrash('crashed', NaN, 1), false);
  assert.equal(shouldRetryCrash('crashed', 'x', 1), false);
  assert.equal(shouldRetryCrash('crashed', 0, 0), false);
  assert.equal(shouldRetryCrash('crashed', 0, -1), false);
});
