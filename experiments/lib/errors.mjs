// Stable adapter codes outrank diagnostic hints such as "check login/network".
// Persist only fixed messages; backend text may contain credentials or user data.
const messages = {
  authentication: 'Provider requires working authentication.',
  timeout: 'Provider exceeded the configured timeout.',
  rate_limit: 'Provider reported a rate or quota limit.',
  canceled: 'Experiment was canceled.',
  backend_or_output: 'Provider execution or output validation failed; reproduce locally for diagnostics.',
};

export function classifyError(error) {
  const code = error?.code ?? 'ERROR';
  const text = String(error?.message ?? '');
  const category = code === 'ABORTED' ? 'canceled'
    : code === 'AGY_TIMEOUT' || code === 'TIMEOUT' ? 'timeout'
      : /\b429\b|\bquota\b|\brate[ -]?limit/i.test(text) ? 'rate_limit'
        : /\btimeout\b|\btimed out\b|\bdeadline[ _-]exceeded\b|\bexceeded\b.+\bms\b/i.test(text) ? 'timeout'
          : (code === 'PROVIDER_HTTP_ERROR' && /\bHTTP (401|403)\b/.test(text))
            || /\b(auth|oauth|unauthenticated|authentication|authorization|unauthorized|sign[ -]?in|log[ -]?in)\b/i.test(text)
            ? 'authentication' : 'backend_or_output';
  return { code, category, message: messages[category] };
}
