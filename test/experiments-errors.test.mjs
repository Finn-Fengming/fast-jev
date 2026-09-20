import test from 'node:test';
import assert from 'node:assert/strict';
import { AgyError } from '../src/agy.mjs';
import { FastJevError } from '../src/errors.mjs';
import { classifyError } from '../experiments/lib/errors.mjs';

test('AGY deadline stays a timeout despite its login/network troubleshooting hint', () => {
  const error = new AgyError('AGY_TIMEOUT',
    'AGY exceeded the 30000 ms timeout. Check your AGY login/network or increase --timeout.');
  assert.deepEqual(classifyError(error), {
    code: 'AGY_TIMEOUT', category: 'timeout', message: 'Provider exceeded the configured timeout.',
  });
});

test('compatible timeout code outranks authentication or quota text', () => {
  for (const message of ['Provider exceeded 30000 ms.', 'Check authentication.', 'HTTP 429: quota reached']) {
    assert.equal(classifyError(new FastJevError('TIMEOUT', message, 124)).category, 'timeout');
  }
});

test('cancellation code outranks misleading timeout, backend and authentication text', () => {
  for (const message of ['Request canceled.', 'timeout; check login', 'Backend precondition failed', 'HTTP 429']) {
    assert.deepEqual(classifyError(new FastJevError('ABORTED', message, 130)), {
      code: 'ABORTED', category: 'canceled', message: 'Experiment was canceled.',
    });
  }
});

test('AGY authentication failures retain a sanitized authentication category', () => {
  for (const message of [
    'AGY failed: UNAUTHENTICATED: authentication required',
    'AGY failed: Please sign in again.',
    'AGY failed: login required',
    'AGY failed: OAuth token expired',
  ]) {
    assert.equal(classifyError(new AgyError('AGY_FAILED', message)).category, 'authentication');
  }
});

test('current compatible HTTP 401 and 403 advice is recognized as authentication', () => {
  for (const status of [401, 403]) {
    const error = new FastJevError('PROVIDER_HTTP_ERROR',
      `OpenAI-compatible endpoint returned HTTP ${status}. Check the configured API key and endpoint permissions.`);
    assert.equal(classifyError(error).category, 'authentication');
  }
});

test('AGY precondition failures retain a sanitized generic backend category', () => {
  const error = new AgyError('AGY_FAILED',
    'AGY failed: FAILED_PRECONDITION (code 400): Backend precondition failed.');
  assert.deepEqual(classifyError(error), {
    code: 'AGY_FAILED', category: 'backend_or_output',
    message: 'Provider execution or output validation failed; reproduce locally for diagnostics.',
  });
});

test('provider rate and quota limits are retained without remote diagnostics', () => {
  for (const error of [
    new FastJevError('PROVIDER_HTTP_ERROR', 'OpenAI-compatible endpoint returned HTTP 429. Provider rate limit reached; retry later.'),
    new AgyError('AGY_FAILED', 'AGY failed: quota exceeded'),
    new AgyError('AGY_FAILED', 'AGY failed: rate-limit reached'),
  ]) {
    assert.deepEqual(classifyError(error), {
      code: error.code, category: 'rate_limit', message: 'Provider reported a rate or quota limit.',
    });
  }
});

test('uncoded backend deadline text remains a fallback timeout signal', () => {
  for (const message of ['AGY failed: DEADLINE_EXCEEDED', 'Provider timed out', 'Provider exceeded 500 ms.']) {
    assert.equal(classifyError(new AgyError('AGY_FAILED', message)).category, 'timeout');
  }
});

test('unrelated words and statuses do not become authentication or rate failures', () => {
  for (const message of ['Invalid author field', 'Unexpected value 4290', 'OpenAI-compatible endpoint returned HTTP 500. Check endpoint availability and provider logs.']) {
    assert.equal(classifyError(new FastJevError('INVALID_RESPONSE', message)).category, 'backend_or_output');
  }
});

test('persisted classifier output contains only code, category and a fixed message', () => {
  const sensitive = 'private-request-content-and-secret-token';
  const error = Object.assign(new AgyError('AGY_FAILED', `authentication failed: ${sensitive}`), {
    cause: { message: sensitive }, responseBody: sensitive,
  });
  const result = classifyError(error);
  assert.deepEqual(result, {
    code: 'AGY_FAILED', category: 'authentication', message: 'Provider requires working authentication.',
  });
  assert(!JSON.stringify(result).includes(sensitive));
  assert.deepEqual(classifyError(null), {
    code: 'ERROR', category: 'backend_or_output',
    message: 'Provider execution or output validation failed; reproduce locally for diagnostics.',
  });
});
