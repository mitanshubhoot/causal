/**
 * One error type for the whole CLI, carrying the exit code the shell sees.
 *
 *   0 ok · 1 internal · 2 usage · 3 auth · 4 not_found · 5 network
 */

export type ErrorCode = "internal" | "usage" | "auth" | "not_found" | "network";

export const EXIT_CODES: Record<ErrorCode | "ok", number> = {
  ok: 0,
  internal: 1,
  usage: 2,
  auth: 3,
  not_found: 4,
  network: 5,
};

export class CausalCliError extends Error {
  readonly code: ErrorCode;
  /** Extra human-readable guidance printed under the error (never in --json). */
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, hint?: string) {
    super(message);
    this.name = "CausalCliError";
    this.code = code;
    if (hint !== undefined) this.hint = hint;
  }

  get exitCode(): number {
    return EXIT_CODES[this.code];
  }
}

export const usageError = (message: string, hint?: string): CausalCliError =>
  new CausalCliError("usage", message, hint);

export const authError = (message: string, hint?: string): CausalCliError =>
  new CausalCliError("auth", message, hint);

export const notFoundError = (message: string, hint?: string): CausalCliError =>
  new CausalCliError("not_found", message, hint);

export const networkError = (message: string, hint?: string): CausalCliError =>
  new CausalCliError("network", message, hint);

export const internalError = (message: string, hint?: string): CausalCliError =>
  new CausalCliError("internal", message, hint);

/** Normalize anything thrown into a CausalCliError. */
export function toCliError(err: unknown): CausalCliError {
  if (err instanceof CausalCliError) return err;
  if (err instanceof Error) return new CausalCliError("internal", err.message);
  return new CausalCliError("internal", String(err));
}
