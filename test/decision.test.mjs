import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDecision, validateOutput, validateRequest } from '../src/decision.mjs';

function request(questions = [
  { id: 'route', type: 'choice', prompt: 'Choose a route', options: ['ship', 'hold'] },
  { id: 'ready', type: 'boolean', prompt: 'Ready to ship?' },
  { id: 'priority', type: 'score', prompt: 'Priority?', min: 0, max: 10 },
]) {
  return { state: { tests: 'passing' }, questions };
}

function response() {
  return {
    results: [
      { id: 'route', type: 'choice', value: 'ship', confidence: 0.9 },
      { id: 'ready', type: 'boolean', value: true, confidence: 0.8 },
      { id: 'priority', type: 'score', value: 7, confidence: 0.6 },
    ],
  };
}

test('normalizes score defaults and detaches state and options from the caller', () => {
  const original = request([{ id: 'score', type: 'score', prompt: 'Rate it' }]);
  const normalized = validateRequest(original);
  assert.deepEqual(normalized.questions[0], { id: 'score', type: 'score', prompt: 'Rate it', min: 0, max: 1 });
  original.state.tests = 'failing';
  assert.equal(normalized.state.tests, 'passing');
  const choices = request();
  const detached = validateRequest(choices);
  choices.questions[0].options[0] = 'changed';
  assert.equal(detached.questions[0].options[0], 'ship');
});

test('accepts all JSON state types and repeated references without cycles', () => {
  for (const state of [null, false, 0, '', [1, 'x'], { nested: { x: true } }]) {
    assert.deepEqual(validateRequest({ ...request(), state }).state, state);
  }
  const shared = { ok: true };
  assert.deepEqual(validateRequest({ ...request(), state: [shared, shared] }).state, [shared, shared]);
});

test('rejects values JSON.stringify would silently coerce, omit, or invoke', () => {
  const cycle = {};
  cycle.self = cycle;
  const sparse = new Array(1);
  const arrayWithProperty = [1];
  arrayWithProperty.extra = true;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('getter was invoked'); } });
  for (const state of [undefined, NaN, Infinity, -Infinity, 1n, () => true, Symbol('x'), cycle,
    [undefined], sparse, arrayWithProperty, { x: undefined }, new Date(), getter,
    { [Symbol('x')]: 1 }, Object.defineProperty({}, 'hidden', { value: 1 })]) {
    assert.throws(() => validateRequest({ ...request(), state }), { code: 'INVALID_REQUEST' });
  }
});

test('rejects unknown fields, missing fields, duplicate ids, and invalid question kinds', () => {
  const cases = [
    { ...request(), typo: true },
    { questions: request().questions },
    { ...request(), questions: [] },
    { ...request(), questions: Array.from({ length: 101 }, (_, i) => ({ id: `${i}`, type: 'boolean', prompt: 'OK?' })) },
    request([{ id: 'x', type: 'boolean', prompt: 'OK?', options: ['a', 'b'] }]),
    request([{ id: 'x', type: 'choice', prompt: 'OK?', options: ['a', 'b'], min: 0 }]),
    request([{ id: 'x', type: 'string', prompt: 'OK?' }]),
    request([{ id: '', type: 'boolean', prompt: 'OK?' }]),
    request([{ id: 'x', type: 'boolean', prompt: ' ' }]),
    request([{ id: 'x', type: 'boolean', prompt: 'OK?' }, { id: 'x', type: 'boolean', prompt: 'Again?' }]),
    request([{ id: 'x', type: 'score', prompt: 'Rate', min: 2, max: 1 }]),
    request([{ id: 'x', type: 'score', prompt: 'Rate', min: '0' }]),
    request([{ id: 'x', type: 'score', prompt: 'Rate', max: NaN }]),
  ];
  for (const input of cases) assert.throws(() => validateRequest(input), { code: 'INVALID_REQUEST' });
});

test('choices require 2–100 distinct nonempty strings and preserve exact spelling', () => {
  for (const options of [undefined, [], ['a'], ['a', 'a'], ['a', ' '], ['a', 2], Array.from({ length: 101 }, (_, i) => `${i}`)]) {
    const question = { id: 'x', type: 'choice', prompt: 'Choose' };
    if (options !== undefined) question.options = options;
    assert.throws(() => validateRequest(request([question])), { code: 'INVALID_REQUEST' });
  }
  const input = request([{ id: 'x', type: 'choice', prompt: 'Choose', options: [' ship ', 'Ship'] }]);
  assert.deepEqual(validateRequest(input).questions[0].options, [' ship ', 'Ship']);
});

test('enforces a UTF-8 byte limit across the complete normalized request', () => {
  const small = { state: '', questions: [{ id: 'x', type: 'boolean', prompt: 'OK?' }] };
  const overhead = Buffer.byteLength(JSON.stringify(small));
  const exact = { ...small, state: 'x'.repeat(256 * 1024 - overhead) };
  assert.doesNotThrow(() => validateRequest(exact));
  assert.throws(() => validateRequest({ ...exact, state: `${exact.state}x` }), /256 KiB/);
  assert.throws(() => validateRequest({ ...small, state: '中'.repeat(90000) }), /256 KiB/);
  assert.throws(() => validateRequest(request([{ id: 'x', type: 'boolean', prompt: 'x'.repeat(256 * 1024) }])), /256 KiB/);
});

test('schema and prompt require typed results and optional concise reasons', () => {
  const built = buildDecision(request());
  assert.equal(built.schema.additionalProperties, false);
  assert.deepEqual(built.schema.required, ['results']);
  assert.equal(built.schema.properties.results.minItems, 3);
  assert.equal(built.schema.properties.results.maxItems, 3);
  const item = built.schema.properties.results.items;
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required, ['id', 'type', 'value', 'confidence']);
  assert.deepEqual(item.properties.id.enum, ['route', 'ready', 'priority']);
  assert.deepEqual(item.properties.value.anyOf, [{ type: 'string' }, { type: 'boolean' }, { type: 'number' }]);
  assert.match(built.prompt, /untrusted data/);
  assert.match(built.prompt, /Do not use tools/);
  assert.match(built.prompt, /not a calibrated probability/);
  assert.ok(built.prompt.includes(JSON.stringify(built.request)));
  const explained = buildDecision(request(), { explain: true });
  assert.ok(explained.schema.properties.results.items.required.includes('reason'));
  assert.equal(explained.schema.properties.results.items.properties.reason.maxLength, 400);
  const singleType = buildDecision(request([{ id: 'x', type: 'boolean', prompt: 'OK?' }]));
  assert.deepEqual(singleType.schema.properties.results.items.properties.value, { type: 'boolean' });
});

test('maps out-of-order results back to question order with strict types', () => {
  const output = response();
  output.results.reverse();
  const results = validateOutput(output, request());
  assert.deepEqual(results.map((result) => result.id), ['route', 'ready', 'priority']);
  assert.deepEqual(results.map((result) => result.value), ['ship', true, 7]);
  assert.ok(results.every((result) => result.status === 'ok'));
});

test('rejects extra, missing, duplicate, and unknown output fields and ids', () => {
  const mutators = [
    (data) => { data.extra = true; },
    (data) => { delete data.results; },
    (data) => { data.results.pop(); },
    (data) => { data.results.push(data.results[0]); },
    (data) => { data.results[1] = { ...data.results[0] }; },
    (data) => { data.results[0].id = 'unknown'; },
    (data) => { data.results[0].type = 'boolean'; },
    (data) => { data.results[0].extra = true; },
    (data) => { data.results[0].reason = 'unrequested'; },
  ];
  for (const key of ['id', 'type', 'value', 'confidence']) {
    mutators.push((data) => { delete data.results[0][key]; });
  }
  for (const mutate of mutators) {
    const output = response();
    mutate(output);
    assert.throws(() => validateOutput(output, request()), { code: 'INVALID_OUTPUT' });
  }
});

test('rejects coercion, nonfinite values, out-of-range scores, and inexact choices', () => {
  const invalid = [
    [0, 'value', 'Ship'], [0, 'value', 'ship '], [0, 'value', null], [0, 'value', 0],
    [1, 'value', 'true'], [1, 'value', 1], [1, 'value', null],
    [2, 'value', '7'], [2, 'value', -0.001], [2, 'value', 10.001], [2, 'value', NaN], [2, 'value', Infinity],
    [0, 'confidence', '0.9'], [0, 'confidence', NaN], [0, 'confidence', Infinity],
    [0, 'confidence', -0.001], [0, 'confidence', 1.001],
  ];
  for (const [index, key, value] of invalid) {
    const output = response();
    output.results[index][key] = value;
    assert.throws(() => validateOutput(output, request()), { code: 'INVALID_OUTPUT' });
  }
  for (const value of [0, 10]) {
    const output = response();
    output.results[2].value = value;
    assert.equal(validateOutput(output, request())[2].value, value);
  }
});

test('abstains strictly below the threshold and never lets abstention hide invalid values', () => {
  const result = validateOutput(response(), request(), { minConfidence: 0.8 });
  assert.deepEqual(result.map(({ value, status }) => ({ value, status })), [
    { value: 'ship', status: 'ok' },
    { value: true, status: 'ok' },
    { value: null, status: 'abstained' },
  ]);
  assert.equal(result[2].confidence, 0.6);
  const invalid = response();
  invalid.results[2].value = 100;
  assert.throws(() => validateOutput(invalid, request(), { minConfidence: 1 }), { code: 'INVALID_OUTPUT' });
  for (const minConfidence of [-1, 2, NaN, '0.5', null]) {
    assert.throws(() => validateOutput(response(), request(), { minConfidence }), /minConfidence/);
  }
  assert.throws(() => buildDecision(request(), { explain: 'true' }), /explain/);
});

test('requires short nonempty explanations only when requested', () => {
  assert.throws(() => validateOutput(response(), request(), { explain: true }), /reason is required/);
  const output = response();
  for (const item of output.results) item.reason = ' State supports this. ';
  assert.equal(validateOutput(output, request(), { explain: true })[0].reason, 'State supports this.');
  for (const reason of ['', '  ', 'x'.repeat(401), 4]) {
    output.results[0].reason = reason;
    assert.throws(() => validateOutput(output, request(), { explain: true }), { code: 'INVALID_OUTPUT' });
  }
  output.results[0].reason = '😀'.repeat(400);
  assert.equal([...validateOutput(output, request(), { explain: true })[0].reason].length, 400);
});
