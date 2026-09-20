import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildJevRequest, normalizeJevAnswers, callJev } from '../experiments/lib/jev-openrouter.mjs';
import { buildBatch } from '../experiments/lib/suite.mjs';

const request = { state: { record: 'A public synthetic example.' }, questions: [
  { id: 'route', type: 'choice', prompt: 'Select a route.', options: ['billing', 'technical'] },
  { id: 'grounded', type: 'boolean', prompt: 'Is the whole claim established?' },
  { id: 'quality', type: 'score', prompt: 'Judge the reply.', min: 0, max: 2 },
] };
const scoreLevels = { quality: ['Neither element is present.', 'One element is present.', 'Both elements are present.'] };
const answer = () => ({ model: 'typesafe/jev-1.13-20260917', answers: {
  route: { type: 'choice', choice: 'billing', confidence: 0.6, probabilities: { billing: 0.8, technical: 0.2 } },
  grounded: { type: 'noul', noul: 0.5 },
  quality: { type: 'score', score: 1.43, confidence: 0.35, probabilities: { 0: 0, 1: 0.57, 2: 0.43 } },
}, usage: { input_tokens: 321, output_tokens: 42, cost: 0.00002 } });
const response = data => new Response(JSON.stringify(data ?? answer()));
const options = { apiKey: 'test-only-canary', scoreLevels };

test('native mapping preserves state, exact prompts and typed criteria without mutating input', () => {
  const original = structuredClone(request);
  const wire = buildJevRequest(request, { scoreLevels });
  assert.equal(wire.model, 'typesafe/jev-1.13');
  assert.deepEqual(wire.state, request.state);
  assert.deepEqual(wire.questions.route, { type: 'choice', instructions: request.questions[0].prompt, criteria: { billing: null, technical: null } });
  assert.deepEqual(wire.questions.grounded, { type: 'noul', instructions: request.questions[1].prompt });
  assert.deepEqual(wire.questions.quality.criteria, scoreLevels.quality);
  assert.deepEqual(request, original);
  wire.state.record = 'Changed';
  wire.questions.quality.criteria[0] = 'Changed';
  assert.deepEqual(request, original);
  assert.equal(scoreLevels.quality[0], 'Neither element is present.');
});

test('score mapping rejects missing descriptions, unsupported ranges and floating scale indices', () => {
  for (const levels of [undefined, {}, { quality: ['0', '1', '2'] }, { quality: ['A', 'B'] }, { quality: ['A', '', 'C'] }, { quality: new Array(3) }]) {
    assert.throws(() => buildJevRequest(request, { scoreLevels: levels }), { code: 'INVALID_REQUEST' });
  }
  for (const limits of [{ min: -1 }, { min: 1 }, { max: 2.5 }, { max: 10 }]) {
    const changed = structuredClone(request);
    Object.assign(changed.questions[2], limits);
    assert.throws(() => buildJevRequest(changed, { scoreLevels }), { code: 'INVALID_REQUEST' });
    assert.throws(() => normalizeJevAnswers(changed, answer()), { code: 'INVALID_REQUEST' });
  }
  assert.deepEqual(buildJevRequest(request, { scoreLevels: new Map(Object.entries(scoreLevels)) }).questions.quality.criteria, scoreLevels.quality);
});

test('mapping refuses unpinned models and does not echo invalid input', () => {
  for (const model of ['typesafe/jev-latest', 'secret-model-canary', 'openai/example', 'typesafe/jev-1.13\nsecret']) {
    assert.throws(() => buildJevRequest(request, { model, scoreLevels }), error => error.code === 'INVALID_REQUEST' && !error.message.includes('canary'));
  }
  assert.throws(() => buildJevRequest({ secret: 'sensitive-canary' }), error => !error.message.includes('sensitive-canary'));
});

test('all bundled rubrics can map exactly and batched prompts keep their input selectors', async () => {
  const rows = (await readFile(new URL('../experiments/data/decision-suite.jsonl', import.meta.url), 'utf8')).trim().split('\n').map(JSON.parse);
  for (let offset = 0; offset < rows.length; offset += 8) {
    const items = rows.slice(offset, offset + 8);
    const { request: batch, mapping } = buildBatch(items);
    const levels = {};
    for (const entry of mapping) {
      const original = items.find(item => item.id === entry.case_id).request.questions.find(question => question.id === entry.original_id);
      if (original.type === 'score') levels[entry.id] = original.prompt.split('\n').slice(1).map(line => line.replace(/^\d+[:：]\s*/, ''));
    }
    const wire = buildJevRequest(batch, { scoreLevels: levels });
    assert.deepEqual(wire.state, batch.state);
    for (const question of batch.questions) assert.equal(wire.questions[question.id].instructions, question.prompt);
    assert.ok(Object.values(wire.questions).every(question => question.instructions.startsWith('Use ONLY state.inputs[')));
  }
});

test('typed normalization preserves fractional score and defines noul ties without inventing confidence', () => {
  const results = normalizeJevAnswers(request, answer());
  assert.deepEqual(results.map(item => item.value), ['billing', true, 1.43]);
  assert.equal(results[1].confidence, undefined);
  for (const [noul, expected] of [[0, false], [0.499999, false], [0.5, true], [1, true]]) {
    const envelope = answer(); envelope.answers.grounded.noul = noul;
    assert.equal(normalizeJevAnswers(request, envelope)[1].value, expected);
  }
});

test('typed normalization rejects missing or extra IDs, wrong types, out-of-range values and malformed probabilities', () => {
  const mutations = [
    data => { delete data.answers.route; },
    data => { data.answers.extra = { type: 'noul', noul: 1 }; },
    data => { data.answers.route.type = 'score'; },
    data => { data.answers.route.choice = 'unlisted'; },
    data => { data.answers.grounded.noul = '1'; },
    data => { data.answers.grounded.noul = NaN; },
    data => { data.answers.grounded.noul = 1.1; },
    data => { data.answers.quality.score = 2.01; },
    data => { data.answers.quality.score = -0.01; },
    data => { data.answers.quality.score = Infinity; },
    data => { data.answers.route.confidence = -0.1; },
    data => { data.answers.route.probabilities.billing = '0.8'; },
    data => { data.answers.route.probabilities.secret = 0; },
    data => { delete data.answers.quality.probabilities[2]; },
  ];
  for (const mutate of mutations) {
    const data = answer(); mutate(data);
    assert.throws(() => normalizeJevAnswers(request, data), { code: 'INVALID_RESPONSE' });
  }
});

test('optional distributions and confidence may be absent as permitted by the OpenRouter schema', () => {
  const data = answer();
  for (const item of Object.values(data.answers)) { delete item.confidence; delete item.probabilities; }
  const results = normalizeJevAnswers(request, data);
  assert.equal(results.length, 3);
  assert.ok(results.every(item => !Object.hasOwn(item, 'confidence')));
});

test('prototype-shaped IDs and options are handled as data without object mutation', () => {
  const special = { state: null, questions: [{ id: '__proto__', type: 'choice', prompt: 'Select.', options: ['__proto__', 'constructor'] }] };
  const wire = buildJevRequest(special);
  assert.deepEqual(Object.keys(wire.questions), ['__proto__']);
  const envelope = JSON.parse('{"answers":{"__proto__":{"type":"choice","choice":"__proto__"}}}');
  assert.equal(normalizeJevAnswers(special, envelope)[0].value, '__proto__');
  assert.equal(Object.getPrototypeOf(wire.questions), Object.prototype);
});

test('native call uses the fixed endpoint, disables redirects, hashes exact body and allowlists artifacts', async () => {
  let body;
  let calls = 0;
  const data = answer();
  data.id = 'private-account-canary';
  data.provider = 'private-provider-canary';
  data.usage.private = 'private-usage-canary';
  data.answers.quality.legend = { 0: 'private-legend-canary' };
  data.answers.quality.private = 'private-answer-canary';
  const output = await callJev(request, { ...options, fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, 'https://openrouter.ai/api/alpha/decisions');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, `Bearer ${options.apiKey}`);
    body = init.body;
    return response(data);
  } });
  assert.equal(calls, 1);
  assert.equal(output.native.wire_request_sha256, createHash('sha256').update(body).digest('hex'));
  assert.deepEqual(output.meta, { provider: 'jev-openrouter', model: data.model, usage: { input_tokens: 321, output_tokens: 42, cost: 0.00002 } });
  assert.ok(!JSON.stringify(output).includes('canary'));
  assert.equal(output.native.answers.quality.score, 1.43);
  assert.equal(output.native.answers.grounded.noul, 0.5);
});

test('usage preserves only nonnegative finite numeric counters and cost', async () => {
  const data = answer(); data.usage = { input_tokens: '321', output_tokens: -1, cost: Infinity, total_tokens: 99 };
  const output = await callJev(request, { ...options, fetchImpl: async () => response(data) });
  assert.equal(output.meta.usage, null);
});

test('HTTP errors never read or echo the remote body and never retry', async () => {
  for (const status of [400, 401, 402, 403, 429, 500]) {
    let calls = 0;
    await assert.rejects(callJev(request, { ...options, fetchImpl: async () => {
      calls++;
      return new Response('private-error-canary', { status });
    } }), error => error.code === 'PROVIDER_HTTP_ERROR' && error.message === `Jev endpoint returned HTTP ${status}.`);
    assert.equal(calls, 1);
  }
});

test('malformed bodies, huge bodies, model substitution and echoed transport secrets are rejected safely', async () => {
  for (const [fetchImpl, code] of [
    [async () => new Response('private-invalid-canary'), 'INVALID_RESPONSE'],
    [async () => response({ ...answer(), model: 'typesafe/jev-2.0' }), 'INVALID_RESPONSE'],
    [async () => response({ ...answer(), model: 'private-model-canary' }), 'INVALID_RESPONSE'],
    [async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)), 'OUTPUT_TOO_LARGE'],
    [async () => { throw new Error('private-transport-canary'); }, 'PROVIDER_UNAVAILABLE'],
  ]) await assert.rejects(callJev(request, { ...options, fetchImpl }), error => error.code === code && !error.message.includes('canary'));
});

test('missing authentication and invalid timeouts fail before any network call', async () => {
  let calls = 0;
  for (const invalidOptions of [{ apiKey: '' }, { apiKey: 'secret\ncanary' }, { timeoutMs: 0 }, { timeoutMs: 1.5 }, { timeoutMs: Infinity }, { signal: {} }]) {
    await assert.rejects(callJev(request, { ...options, ...invalidOptions, fetchImpl: async () => { calls++; return response(); } }), { code: 'INVALID_REQUEST' });
  }
  assert.equal(calls, 0);
});

test('timeout and caller cancellation use stable distinct errors and abort the fetch', async () => {
  const stall = (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('private-abort-canary')), { once: true });
  });
  // Keep the event loop alive because AbortSignal.timeout intentionally uses an unref timer.
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(callJev(request, { ...options, timeoutMs: 10, fetchImpl: stall }), { code: 'TIMEOUT', exitCode: 124 });
    const controller = new AbortController();
    const promise = callJev(request, { ...options, signal: controller.signal, fetchImpl: stall });
    controller.abort(new Error('private-reason-canary'));
    await assert.rejects(promise, { code: 'ABORTED', exitCode: 130 });
    let calls = 0;
    await assert.rejects(callJev(request, { ...options, signal: controller.signal, fetchImpl: async () => { calls++; return response(); } }), { code: 'ABORTED' });
    assert.equal(calls, 0);
  } finally { clearTimeout(keepAlive); }
});
