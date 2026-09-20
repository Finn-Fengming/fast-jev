import test from 'node:test';
import assert from 'node:assert/strict';
import { safeUsage } from '../src/privacy.mjs';

test('usage includes only known finite nonnegative numeric counters', () => {
  assert.deepEqual(safeUsage({
    input_tokens: 10, output_tokens: 0, total_tokens: Infinity, thinking_tokens: NaN,
    cache_read_tokens: -1, prompt_tokens: '12', completion_tokens: { count: 2 },
    cache_write_tokens: 4, cache_creation_input_tokens: 6, cache_read_input_tokens: 3,
    unknown_tokens: 7,
  }), { input_tokens: 10, output_tokens: 0, cache_write_tokens: 4, cache_read_input_tokens: 3, cache_creation_input_tokens: 6 });
});

test('nested usage detail objects use their own strict counter allowlists', () => {
  assert.deepEqual(safeUsage({
    prompt_tokens_details: { cached_tokens: 2, audio_tokens: 1, reasoning_tokens: 3 },
    completion_tokens_details: { reasoning_tokens: 4, audio_tokens: 0, accepted_prediction_tokens: 2, rejected_prediction_tokens: 1 },
    input_tokens_details: { cached_tokens: -2, audio_tokens: '1' },
    output_tokens_details: { reasoning_tokens: 3, arbitrary: { text: 'private-detail-canary' } },
  }), {
    prompt_tokens_details: { cached_tokens: 2, audio_tokens: 1 },
    completion_tokens_details: { reasoning_tokens: 4, audio_tokens: 0, accepted_prediction_tokens: 2, rejected_prediction_tokens: 1 },
    output_tokens_details: { reasoning_tokens: 3 },
  });
});

test('invalid or empty usage metadata is normalized to null', () => {
  for (const value of [undefined, null, false, 1, 'text', [], { custom: 'text' }, { prompt_tokens_details: [] }, { completion_tokens_details: 'text' }]) {
    assert.equal(safeUsage(value), null);
  }
});

test('usage never copies inherited counters or metadata', () => {
  const usage = Object.assign(Object.create({ input_tokens: 10, prompt_tokens_details: { cached_tokens: 8 } }), { output_tokens: 3 });
  assert.deepEqual(safeUsage(usage), { output_tokens: 3 });
  assert.equal(safeUsage({ input_tokens_details: Object.create({ cached_tokens: 8 }) }), null);
});
