import test from 'node:test';
import assert from 'node:assert/strict';
import { percentile, scoreCase, summarize } from '../experiments/lib/metrics.mjs';

const example = {
  id: 'mixed',
  request: {
    state: {},
    questions: [
      { id: 'route', type: 'choice', options: ['ship', 'hold'] },
      { id: 'ready', type: 'boolean' },
      { id: 'urgency', type: 'score', min: 0, max: 10 },
    ],
  },
  expected: { route: 'hold', ready: false, urgency: 8 },
};

function results(overrides = {}) {
  return [
    { id: 'route', type: 'choice', value: 'hold', status: 'ok', confidence: 0.1 },
    { id: 'ready', type: 'boolean', value: false, status: 'ok', confidence: 0.99 },
    { id: 'urgency', type: 'score', value: 8, status: 'ok', confidence: 0.5 },
  ].map((result) => ({ ...result, ...overrides[result.id] }));
}

function record(case_id, overrides = {}) {
  return {
    case_id,
    repeat: 0,
    phase: 'measure',
    status: 'ok',
    elapsed_ms: 100,
    score: scoreCase(example, results()),
    category: 'release',
    language: 'en',
    kind: 'mixed',
    ...overrides,
  };
}

function almost(actual, expected, tolerance = 1e-12) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
}

test('scoring maps answers by id, keeps false, and ignores uncalibrated confidence', () => {
  const score = scoreCase(example, { results: results().reverse() });
  assert.equal(score.correct, true);
  assert.equal(score.valid, true);
  assert.deepEqual(score.questions.map(({ id, predicted }) => [id, predicted]), [
    ['route', 'hold'], ['ready', false], ['urgency', 8],
  ]);
  assert.equal(score.questions[2].absolute_error, 0);
  assert.equal(score.questions[2].normalized_absolute_error, 0);
});

test('score correctness uses inclusive half-point tolerance and preserves MAE', () => {
  for (const value of [7.5, 8.5]) {
    const score = scoreCase(example, results({ urgency: { value } }));
    assert.equal(score.correct, true);
    assert.equal(score.questions[2].absolute_error, 0.5);
    assert.equal(score.questions[2].normalized_absolute_error, 0.05);
  }
  const score = scoreCase(example, results({ urgency: { value: 8.500001 } }));
  assert.equal(score.valid, true);
  assert.equal(score.correct, false);
});

test('score validity rejects coercion, wrong types, out-of-range values, and abstention', () => {
  for (const overrides of [
    { route: { value: 'HOLD' } },
    { route: { value: 'hold ' } },
    { ready: { value: 'false' } },
    { ready: { value: 0 } },
    { ready: { type: 'choice' } },
    { urgency: { value: -0.1 } },
    { urgency: { value: 10.1 } },
    { urgency: { value: NaN } },
    { urgency: { value: Infinity } },
    { urgency: { value: '8' } },
    { urgency: { status: 'abstained', value: 8 } },
  ]) {
    const score = scoreCase(example, results(overrides));
    assert.equal(score.valid, false);
    assert.equal(score.correct, false);
  }
});

test('missing and duplicate predictions count as invalid instead of disappearing', () => {
  const missing = scoreCase(example, results().slice(0, 2));
  assert.equal(missing.questions.length, 3);
  assert.equal(missing.questions[2].predicted, null);
  assert.equal(missing.questions[2].valid, false);
  assert.equal('absolute_error' in missing.questions[2], false);
  const duplicate = scoreCase(example, [...results(), results()[0]]);
  assert.equal(duplicate.questions[0].valid, false);
  assert.equal(scoreCase(example, undefined).valid, false);
});

test('gold answers and score ranges are validated rather than silently corrupting accuracy', () => {
  assert.throws(() => scoreCase({ ...example, expected: {} }, results()), /Missing expected/);
  assert.throws(() => scoreCase({ ...example, expected: { ...example.expected, ready: 'false' } }, results()), /Invalid expected/);
  const zeroRange = {
    request: { questions: [{ id: 'score', type: 'score', min: 5, max: 5 }] },
    expected: { score: 5 },
  };
  const scored = scoreCase(zeroRange, [{ id: 'score', type: 'score', value: 5 }]);
  assert.equal(scored.questions[0].normalized_absolute_error, 0);
  assert.throws(() => scoreCase({ request: { questions: [] } }, []), /at least one/);
});

test('nearest-rank percentiles handle empty, unsorted, singleton and boundary samples', () => {
  const values = [100, 2, 7, 3];
  assert.equal(percentile(values, 50), 3);
  assert.equal(percentile(values, 95), 100);
  assert.equal(percentile(values, 0), 2);
  assert.equal(percentile(values, 100), 100);
  assert.deepEqual(values, [100, 2, 7, 3]);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([42], 95), 42);
  assert.throws(() => percentile([1, Infinity], 50), /finite/);
  assert.throws(() => percentile([1], 101), /between/);
});

test('empty or not-run experiments report missing accuracy as null with explicit coverage', () => {
  const empty = summarize([], { plannedCases: 12, expectedRepeats: 3 });
  assert.equal(empty.primary.end_to_end_correct_rate, null);
  assert.equal(empty.primary.observed_success_accuracy, null);
  assert.equal(empty.primary.accuracy_wilson95, null);
  assert.equal(empty.primary.latency_ms.p50, null);
  assert.equal(empty.primary.score_mae, null);
  assert.equal(empty.coverage.attempted_case_rate, 0);
  assert.equal(empty.coverage.expected_record_count, 36);
  assert.equal(empty.repeat_consistency.consistency_rate, null);
  const skipped = summarize([record('skip', { status: 'not_run', score: undefined, elapsed_ms: undefined })], { plannedCases: ['skip'] });
  assert.equal(skipped.not_run_count, 1);
  assert.equal(skipped.attempted_count, 0);
  assert.equal(skipped.primary.end_to_end_correct_rate, null);
  assert.equal(skipped.coverage.recorded_case_rate, 1);
  assert.equal(skipped.coverage.attempted_case_rate, 0);
});

test('backend failures are incorrect end-to-end, excluded from observed-success accuracy, and counted by code', () => {
  const summary = summarize([
    record('pass'),
    record('wrong', { score: scoreCase(example, results({ route: { value: 'ship' } })) }),
    record('fail', { status: 'error', score: undefined, elapsed_ms: 5, error: { code: 'BACKEND_FAILURE' } }),
    record('skip', { status: 'not_run', score: undefined, elapsed_ms: undefined }),
  ], { plannedCases: 4 });
  assert.equal(summary.attempted_count, 3);
  assert.equal(summary.error_count, 1);
  assert.equal(summary.primary.end_to_end_correct_rate, 1 / 3);
  assert.equal(summary.primary.observed_success_accuracy, 1 / 2);
  assert.equal(summary.primary.valid_rate, 2 / 3);
  assert.equal(summary.primary.choice_bool_accuracy, 3 / 4);
  assert.equal(summary.primary.latency_ms.sample_count, 3);
  assert.equal(summary.primary.successful_latency_ms.sample_count, 2);
  assert.deepEqual(summary.primary.errors_by_code, { BACKEND_FAILURE: 1 });
  const failed = summarize([record('fail', { status: 'error', score: undefined })]);
  assert.equal(failed.primary.end_to_end_correct_rate, 0);
  assert.equal(failed.primary.observed_success_accuracy, null);
  assert.equal(failed.primary.score_mae, null);
});

test('abstentions are invalid and incorrect while numeric error averages use valid predictions only', () => {
  const summary = summarize([
    record('a', { score: scoreCase(example, results({ urgency: { value: 7.5 } })) }),
    record('b', { score: scoreCase(example, results({ urgency: { value: 6 } })) }),
    record('c', { score: scoreCase(example, results({ urgency: { value: null, status: 'abstained' } })) }),
  ]);
  assert.equal(summary.primary.valid_count, 2);
  assert.equal(summary.primary.valid_rate, 2 / 3);
  assert.equal(summary.primary.end_to_end_correct_rate, 1 / 3);
  assert.equal(summary.primary.score_question_count, 3);
  assert.equal(summary.primary.score_valid_count, 2);
  assert.equal(summary.primary.score_mae, 1.25);
  assert.equal(summary.primary.score_normalized_mae, 0.125);
  assert.equal(summary.primary.score_within_tolerance, 1 / 3);
});

test('warmup is excluded, first repeat is primary, and repeated results never inflate the primary interval', () => {
  const summary = summarize([
    record('a', { phase: 'warmup', repeat: -1 }),
    record('a'),
    record('a', { repeat: 1 }),
    record('b'),
    record('b', { repeat: 1, score: scoreCase(example, results({ ready: { value: true } })) }),
  ], { plannedCases: 2, expectedRepeats: 2 });
  assert.equal(summary.record_count, 4);
  assert.equal(summary.unique_case_count, 2);
  assert.equal(summary.primary.attempted_count, 2);
  assert.equal(summary.primary.end_to_end_correct_rate, 1);
  assert.equal(summary.repeated.end_to_end_correct_rate, 3 / 4);
  assert.equal(summary.primary.accuracy_wilson95.sample_size, 2);
  assert.equal('accuracy_wilson95' in summary.repeated, false);
  almost(summary.primary.accuracy_wilson95.lower, 0.3423802275066531);
  almost(summary.primary.accuracy_wilson95.upper, 1);
  assert.equal(summary.repeat_consistency.eligible_case_count, 2);
  assert.equal(summary.repeat_consistency.consistency_rate, 1 / 2);
  assert.equal(summary.by_category.release.attempted_count, 2);
  assert.equal(summary.by_language.en.attempted_count, 2);
});

test('consistency requires all planned repeats to succeed and uses exact score values', () => {
  const summary = summarize([
    record('missing'),
    record('failed'),
    record('failed', { repeat: 1, status: 'error', score: undefined }),
    record('score'),
    record('score', { repeat: 1, score: scoreCase(example, results({ urgency: { value: 8.5 } })) }),
  ], { plannedCases: 3, expectedRepeats: 2 });
  assert.equal(summary.repeat_consistency.complete_case_count, 2);
  assert.equal(summary.repeat_consistency.eligible_case_count, 1);
  assert.equal(summary.repeat_consistency.consistency_rate, 0);
  assert.equal(summary.coverage.recorded_record_rate, 5 / 6);
});

test('duplicated measured case/repeat or invalid repeat indices cannot inflate sample size', () => {
  assert.throws(() => summarize([record('same'), record('same')]), /Duplicate/);
  assert.throws(() => summarize([record('a', { repeat: 1 })]), /repeat index/);
  assert.throws(() => summarize([], { expectedRepeats: 0 }), /positive integer/);
  assert.throws(() => summarize([], { plannedCases: -1 }), /nonnegative integer/);
});
