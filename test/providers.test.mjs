import test from 'node:test';
import assert from 'node:assert/strict';
import { completionUrl, runModel, runOpenAI, validateProviderOptions } from '../src/providers.mjs';
import { decide } from '../src/decision.mjs';

const request = { state: 'The request asks for a refund.', questions: [{ id: 'route', type: 'choice', prompt: 'Which team?', options: ['billing', 'engineering'] }] };
const data = { results: [{ id: 'route', type: 'choice', value: 'billing', confidence: 0.9 }] };
const response = (content = JSON.stringify(data), extra = {}) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content }, ...extra }], usage: { prompt_tokens: 10, completion_tokens: 8 } }));
const base = { prompt: 'Return JSON', schema: { type: 'object' }, model: 'test-model', baseUrl: 'http://localhost:8000/v1' };

test('completion URL preserves path prefixes and accepts complete endpoint', () => {
  assert.equal(completionUrl('https://gateway.example/api/v1/'), 'https://gateway.example/api/v1/chat/completions');
  assert.equal(completionUrl('http://127.0.0.1:8888/v1/chat/completions'), 'http://127.0.0.1:8888/v1/chat/completions');
  for (const url of ['file:///tmp/x', 'https://name:secret@example.com', 'https://example.com?token=x', 'bad']) assert.throws(() => completionUrl(url));
});

test('provider validation requires an explicit compatible model', () => {
  assert.equal(validateProviderOptions().model, 'gemini-3.8-flash-low');
  for (const options of [{ provider: 'other' }, { provider: 'openai' }, { timeoutMs: 0 }, { timeoutMs: Infinity }, { effort: 'turbo' }, { provider: 'openai', model: 'm', responseFormat: 'auto' }]) assert.throws(() => validateProviderOptions(options));
});

test('structured request and decision core integrate in one call with abstention', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, 'https://gateway.example/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-secret');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
    assert.equal(body.stream, false);
    assert.equal(body.tools, undefined);
    assert.equal(body.temperature, undefined);
    assert.equal(body.reasoning_effort, undefined);
    return response();
  });
  const output = await decide(request, { provider: 'openai', model: 'test', apiKey: 'test-secret', baseUrl: 'https://gateway.example/v1', minConfidence: 0.95 });
  assert.equal(calls, 1);
  assert.equal(output.results[0].value, null);
  assert.equal(output.results[0].status, 'abstained');
  assert.equal(output.meta.provider, 'openai');
  assert.equal(output.meta.calibrated, false);
  assert.deepEqual(output.meta.usage, { prompt_tokens: 10, completion_tokens: 8 });
});

test('JSON and text compatibility modes explicitly change request format', async t => {
  const bodies = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    bodies.push(JSON.parse(options.body));
    return response();
  });
  await runOpenAI({ ...base, responseFormat: 'json_object' });
  await runOpenAI({ ...base, responseFormat: 'text', effort: 'low', maxTokens: 512 });
  assert.deepEqual(bodies[0].response_format, { type: 'json_object' });
  assert.match(bodies[0].messages[0].content, /matching this schema/);
  assert.equal(bodies[1].response_format, undefined);
  assert.equal(bodies[1].max_tokens, 512);
  assert.equal(bodies[1].reasoning_effort, 'low');
});

test('HTTP failures do not leak upstream content or silently retry', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('secret echoed by gateway', { status: 401 }); });
  await assert.rejects(runOpenAI({ ...base, apiKey: 'secret' }), error => error.code === 'PROVIDER_HTTP_ERROR' && /401/.test(error.message) && !error.message.includes('secret'));
  assert.equal(calls, 1);
});

test('compatible usage omits private fields while preserving token detail counters', async t => {
  const canary = 'private-compatible-usage-canary';
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(data) } }],
    usage: {
      prompt_tokens: 10, completion_tokens: 8, total_tokens: 18, credential: canary,
      prompt_tokens_details: { cached_tokens: 2, metadata: { credential: canary } },
      completion_tokens_details: { reasoning_tokens: 0, accepted_prediction_tokens: canary },
    },
  })));
  const output = await decide(request, { ...base, provider: 'openai' });
  assert.ok(!JSON.stringify(output.meta.usage).includes(canary), 'Usage metadata must contain token counts only.');
  assert.deepEqual(output.meta.usage, {
    prompt_tokens: 10, completion_tokens: 8, total_tokens: 18,
    prompt_tokens_details: { cached_tokens: 2 }, completion_tokens_details: { reasoning_tokens: 0 },
  });
});

test('truncation, refusal, tool calls and invalid JSON are rejected', async t => {
  const replies = [
    response('{}', { finish_reason: 'length' }),
    response('{}', { message: { refusal: 'no' } }),
    response('{}', { message: { content: '{}', tool_calls: [{}] } }),
    response('```json\n{}\n```'),
    new Response('not JSON'),
    new Response('{}'),
  ];
  t.mock.method(globalThis, 'fetch', async () => replies.shift());
  for (const code of ['INCOMPLETE_RESPONSE', 'MODEL_REFUSAL', 'UNEXPECTED_TOOL_CALL', 'INVALID_RESPONSE', 'INVALID_RESPONSE', 'INCOMPLETE_RESPONSE']) {
    await assert.rejects(runOpenAI(base), { code });
  }
});

test('well-formed JSON with an invalid decision is still rejected', async t => {
  t.mock.method(globalThis, 'fetch', async () => response(JSON.stringify({ results: [{ ...data.results[0], value: 'unlisted' }] })));
  await assert.rejects(decide(request, { ...base, provider: 'openai' }), { code: 'INVALID_OUTPUT' });
});

test('oversized provider responses are rejected', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('x'.repeat(2 * 1024 * 1024 + 1)));
  await assert.rejects(runOpenAI(base), { code: 'OUTPUT_TOO_LARGE' });
});

test('deadline and caller cancellation produce distinct exit codes', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const hold = setTimeout(resolve, 1000);
    signal.addEventListener('abort', () => { clearTimeout(hold); reject(signal.reason); }, { once: true });
  }));
  await assert.rejects(runOpenAI({ ...base, timeoutMs: 10 }), { code: 'TIMEOUT', exitCode: 124 });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(runModel({ ...base, provider: 'openai', signal: controller.signal }), { code: 'ABORTED', exitCode: 130 });
});
