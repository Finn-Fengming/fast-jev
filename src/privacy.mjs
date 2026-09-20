const TOKEN_FIELDS = [
  'input_tokens', 'output_tokens', 'prompt_tokens', 'completion_tokens',
  'total_tokens', 'thinking_tokens', 'cache_read_tokens', 'cache_write_tokens',
  'cache_read_input_tokens', 'cache_creation_input_tokens',
];

const TOKEN_DETAILS = {
  input_tokens_details: ['cached_tokens', 'audio_tokens'],
  output_tokens_details: ['reasoning_tokens', 'audio_tokens'],
  prompt_tokens_details: ['cached_tokens', 'audio_tokens'],
  completion_tokens_details: ['reasoning_tokens', 'audio_tokens', 'accepted_prediction_tokens', 'rejected_prediction_tokens'],
};

function counters(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const key of fields) {
    if (Object.hasOwn(value, key) && Number.isFinite(value[key]) && value[key] >= 0) result[key] = value[key];
  }
  return result;
}

/** Preserve token counts without forwarding provider-specific metadata or text. */
export function safeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = counters(value, TOKEN_FIELDS);
  for (const [key, fields] of Object.entries(TOKEN_DETAILS)) {
    if (!Object.hasOwn(value, key)) continue;
    const details = counters(value[key], fields);
    if (Object.keys(details).length) result[key] = details;
  }
  return Object.keys(result).length ? result : null;
}
