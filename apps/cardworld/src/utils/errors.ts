/**
 * Error handling utilities for production-grade error management
 * Provides structured error handling, logging, and user-friendly messages
 */

export interface ErrorInfo {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  statusCode?: number;
  originalError?: Error;
  timestamp: string;
  context?: string;
}

/** Parse error into structured format */
export function parseError(error: unknown, context?: string): ErrorInfo {
  const timestamp = new Date().toISOString();

  if (error instanceof Error) {
    return {
      code: error.name || "Error",
      message: error.message,
      originalError: error,
      timestamp,
      context,
    };
  }

  if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;
    
    // Check for HTTP response error
    if ("statusCode" in obj && "message" in obj) {
      return {
        code: String(obj.code || "HttpError"),
        message: String(obj.message || "HTTP Error"),
        statusCode: Number(obj.statusCode),
        details: obj.details as Record<string, unknown> | undefined,
        timestamp,
        context,
      };
    }

    // Check for response-like object
    if ("message" in obj) {
      return {
        code: String(obj.code || "Error"),
        message: String(obj.message),
        statusCode: Number(obj.status || obj.statusCode),
        timestamp,
        context,
      };
    }
  }

  if (typeof error === "string") {
    return {
      code: "StringError",
      message: error,
      timestamp,
      context,
    };
  }

  return {
    code: "UnknownError",
    message: "An unknown error occurred",
    timestamp,
    context,
  };
}

/** Convert error to user-friendly message */
export function getUserFriendlyMessage(errorInfo: ErrorInfo): string {
  // Network errors
  if (
    errorInfo.code.includes("Network") ||
    errorInfo.code.includes("ECONNREFUSED") ||
    errorInfo.code.includes("ERR_")
  ) {
    return "Network error. Please check your connection and try again.";
  }

  // Auth errors
  if (errorInfo.code.includes("Unauthorized") || errorInfo.statusCode === 401) {
    return "Your session has expired. Please sign in again.";
  }

  if (errorInfo.code.includes("Forbidden") || errorInfo.statusCode === 403) {
    return "You don't have permission to perform this action.";
  }

  // Not found
  if (errorInfo.code.includes("NotFound") || errorInfo.statusCode === 404) {
    return "The requested resource was not found.";
  }

  // Validation errors
  if (errorInfo.code.includes("Validation") || errorInfo.statusCode === 400) {
    return errorInfo.message || "There was a problem with your input. Please try again.";
  }

  // Timeout
  if (errorInfo.code.includes("Timeout")) {
    return "The request took too long. Please try again.";
  }

  // Server errors
  if ((errorInfo.statusCode ?? 0) >= 500) {
    return "Server error. Please try again later.";
  }

  // Default
  if (errorInfo.message && errorInfo.message.length < 200) {
    return errorInfo.message;
  }

  return "Something went wrong. Please try again.";
}

/** Logger with context support */
export interface LogEntry {
  level: "debug" | "info" | "warn" | "error";
  timestamp: string;
  context?: string;
  message: string;
  data?: Record<string, unknown>;
}

export class ContextLogger {
  private context: string;
  private isDev: boolean;

  constructor(context: string) {
    this.context = context;
    this.isDev = import.meta.env.DEV;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    if (this.isDev) {
      console.debug(`[${this.context}]`, message, data || "");
    }
  }

  info(message: string, data?: Record<string, unknown>): void {
    console.log(`[${this.context}]`, message, data || "");
  }

  warn(message: string, data?: Record<string, unknown>): void {
    console.warn(`[${this.context}]`, message, data || "");
  }

  error(message: string, error?: Error | unknown, data?: Record<string, unknown>): void {
    if (error instanceof Error) {
      console.error(`[${this.context}]`, message, error.message, data || "");
    } else {
      console.error(`[${this.context}]`, message, error, data || "");
    }
  }

  withContext<T>(newContext: string, fn: (logger: ContextLogger) => T): T {
    const originalContext = this.context;
    this.context = `${originalContext}/${newContext}`;
    try {
      return fn(this);
    } finally {
      this.context = originalContext;
    }
  }
}

/** Retry logic with exponential backoff */
export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  logger?: ContextLogger;
}

export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    initialDelayMs = 500,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    shouldRetry = isRetryableError,
    logger,
  } = options;

  let lastError: Error | null = null;
  let delay = initialDelayMs;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxAttempts || !shouldRetry(err, attempt)) {
        throw lastError;
      }

      logger?.debug(`Retry attempt ${attempt + 1}/${maxAttempts} after ${delay}ms`, {
        error: lastError.message,
      });

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * backoffMultiplier, maxDelayMs);
    }
  }

  throw lastError || new Error("Operation failed after retries");
}

/** Determine if error is retryable */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    // Network errors are retryable
    if (
      error.message.includes("ECONNREFUSED") ||
      error.message.includes("ENOTFOUND") ||
      error.message.includes("ETIMEDOUT") ||
      error.message.includes("ERR_NETWORK")
    ) {
      return true;
    }

    // Timeout errors are retryable
    if (error.message.includes("timeout")) {
      return true;
    }
  }

  // Don't retry by default
  return false;
}

/** HTTP error class for API errors */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly body?: unknown,
    readonly headers?: Record<string, string>
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** Validation error class */
export class ValidationError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: Record<string, string[]> = {}
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

/** Authentication error class */
export class AuthenticationError extends Error {
  constructor(message: string = "Authentication failed") {
    super(message);
    this.name = "AuthenticationError";
  }
}

/** Authorization error class */
export class AuthorizationError extends Error {
  constructor(message: string = "You don't have permission to perform this action") {
    super(message);
    this.name = "AuthorizationError";
  }
}

/** Timeout error class */
export class TimeoutError extends Error {
  constructor(message: string = "Request timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}
