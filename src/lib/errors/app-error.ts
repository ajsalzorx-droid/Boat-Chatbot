/**
 * Application error hierarchy.
 *
 * `publicMessage` is the only text that may be returned to a client. `message` is for logs and
 * must still never contain secrets or customer message content.
 */
export type ErrorCode =
  | "CONFIG_MISSING"
  | "CONFIG_INVALID"
  | "DATABASE_UNAVAILABLE"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "EXTERNAL_SERVICE_ERROR"
  | "INTERNAL_ERROR";

export interface AppErrorOptions {
  code: ErrorCode;
  httpStatus: number;
  publicMessage: string;
  /** True when the same operation may succeed if retried later (network blips, 5xx, 429). */
  retryable?: boolean;
  /** Safe, non-sensitive diagnostic details for logs. */
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly publicMessage: string;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, options: AppErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = options.code;
    this.httpStatus = options.httpStatus;
    this.publicMessage = options.publicMessage;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

export interface ConfigProblems {
  missing: readonly string[];
  invalid: readonly string[];
}

export class ConfigError extends AppError {
  /** Names of unset variables. Values are never included. */
  readonly missing: readonly string[];
  /** Names of set-but-invalid variables. Values are never included. */
  readonly invalid: readonly string[];

  constructor(group: string, problems: ConfigProblems) {
    const parts = [
      ...(problems.missing.length > 0 ? [`missing: ${problems.missing.join(", ")}`] : []),
      ...(problems.invalid.length > 0 ? [`invalid: ${problems.invalid.join(", ")}`] : []),
    ];
    super(`${group} configuration ${parts.join("; ")}`, {
      code: problems.missing.length > 0 ? "CONFIG_MISSING" : "CONFIG_INVALID",
      httpStatus: 503,
      publicMessage: "Service temporarily unavailable.",
      retryable: false,
      details: { group, missing: problems.missing, invalid: problems.invalid },
    });
    this.name = "ConfigError";
    this.missing = problems.missing;
    this.invalid = problems.invalid;
  }

  /** Every offending variable name, missing first. */
  get variables(): readonly string[] {
    return [...this.missing, ...this.invalid];
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
