'use strict';

/*
 * Unit tests for js/ranges.js. Run with `npm test` (uses Node's built-in
 * test runner, so there is nothing to install).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRanges, formatRanges, DEFAULT_MAX } = require('../js/ranges.js');

// Runs parseRanges and returns both the numbers and the reported problems.
function parse(input, max) {
  const errors = [];
  const options = { onError: message => errors.push(message) };
  if (max !== undefined) options.max = max;
  return { values: parseRanges(input, options), errors };
}

test('parses single values and ranges', () => {
  assert.deepEqual(parse('1-3,7,10-12'), { values: [1, 2, 3, 7, 10, 11, 12], errors: [] });
});

test('tolerates spaces around numbers, hyphens and commas', () => {
  assert.deepEqual(parse(' 1 - 3 , 7 ').values, [1, 2, 3, 7]);
});

test('empty, null and undefined input give an empty list', () => {
  for (const input of ['', '  ', ',,', null, undefined]) {
    assert.deepEqual(parse(input), { values: [], errors: [] });
  }
});

test('a single-number range such as "5-5" is accepted', () => {
  assert.deepEqual(parse('5-5').values, [5]);
});

test('rejects a leading hyphen instead of reading it as 0 to n', () => {
  const { values, errors } = parse('-5');
  assert.deepEqual(values, []);
  assert.equal(errors.length, 1);
});

test('rejects decimals, letters and open ranges', () => {
  for (const input of ['1.5', 'abc', '3-', '1-2-3', '1e3']) {
    const { values, errors } = parse(input);
    assert.deepEqual(values, [], `"${input}" should give no values`);
    assert.equal(errors.length, 1, `"${input}" should report one problem`);
  }
});

test('rejects a range that runs backwards', () => {
  const { values, errors } = parse('5-1');
  assert.deepEqual(values, []);
  assert.match(errors[0], /backwards/);
});

test('a bad token does not discard the good ones around it', () => {
  const { values, errors } = parse('1,x,3-4');
  assert.deepEqual(values, [1, 3, 4]);
  assert.equal(errors.length, 1);
});

test('refuses a huge range instead of looping over it', () => {
  const started = Date.now();
  const { values, errors } = parse('1-999999999');
  assert.deepEqual(values, []);
  assert.equal(errors.length, 1);
  assert.ok(Date.now() - started < 100, 'should return immediately');
});

test('the default limit applies when no max is given', () => {
  assert.equal(parse(String(DEFAULT_MAX)).values.length, 1);
  assert.equal(parse(String(DEFAULT_MAX + 1)).values.length, 0);
});

test('a caller-supplied max is respected', () => {
  assert.deepEqual(parse('1-5', 5).values, [1, 2, 3, 4, 5]);
  assert.deepEqual(parse('1-6', 5).values, []);
});

test('formatRanges sorts, drops duplicates and merges runs', () => {
  assert.equal(formatRanges([12, 1, 2, 3, 7, 10, 11, 3]), '1-3,7,10-12');
  assert.equal(formatRanges([]), '');
});

test('format then parse returns the same set', () => {
  const ids = [1, 2, 3, 9, 40, 41, 195];
  assert.deepEqual(parseRanges(formatRanges(ids)), ids);
});
