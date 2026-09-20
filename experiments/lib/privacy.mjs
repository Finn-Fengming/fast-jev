const REQUIRED_AGY_FLAGS = [
  '--disable-slash-commands', '--input-format', '--json-schema', '--mode',
  '--model', '--output-format', '--print-timeout', '--sandbox',
];

/** Keep experiment diagnostics useful without exporting the local AGY inventory. */
export function publicAgyProbe(probe, requestedModel, effort) {
  const required = effort === undefined ? REQUIRED_AGY_FLAGS : [...REQUIRED_AGY_FLAGS, '--effort'];
  const version = typeof probe.version === 'string'
    ? probe.version.match(/(?:^|[\s(v])(\d+\.\d+\.\d+)(?=[\s)-]|$)/)?.[1] ?? null
    : null;
  return {
    version,
    models: Array.isArray(probe.models) && probe.models.includes(requestedModel) ? [requestedModel] : [],
    capabilities: required.filter(flag => Array.isArray(probe.capabilities) && probe.capabilities.includes(flag)).sort(),
    metadata_scope: 'sanitized_to_tested_backend',
    privacy_note: 'Metadata is limited to the requested model and required adapter flags; unrelated local inventory is omitted.',
  };
}
