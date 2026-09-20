export class FastJevError extends Error {
  constructor(code, message, exitCode = 1) {
    super(message);
    this.name = 'FastJevError';
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function inputError(message) {
  return new FastJevError('INVALID_INPUT', message, 2);
}
