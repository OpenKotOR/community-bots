/**
 * Comprehensive input validation and sanitization utilities
 * Production-ready validators with detailed error messages
 */

/** Username validation rules */
export interface UsernameValidationResult {
  valid: boolean;
  errors: string[];
}

/** Username uniqueness check result */
export interface UsernameUniquenessResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate and normalize a username
 * - 3-32 characters
 * - Alphanumeric, hyphens, underscores only
 * - No leading/trailing hyphens or underscores
 * - No consecutive special characters
 */
export function validateUsername(input: unknown): UsernameValidationResult {
  if (typeof input !== "string") {
    return { valid: false, errors: ["Username must be a string"] };
  }

  const username = input.trim();
  const errors: string[] = [];

  if (username.length < 3) {
    errors.push("Username must be at least 3 characters");
  }
  if (username.length > 32) {
    errors.push("Username must be at most 32 characters");
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
    errors.push("Username can only contain letters, numbers, hyphens, and underscores");
  }

  if (/^[-_]/.test(username)) {
    errors.push("Username cannot start with a hyphen or underscore");
  }

  if (/[-_]$/.test(username)) {
    errors.push("Username cannot end with a hyphen or underscore");
  }

  if (/[-_]{2,}/.test(username)) {
    errors.push("Username cannot contain consecutive hyphens or underscores");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** Email validation rules */
export interface EmailValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate email address
 * - Standard RFC 5322 simple validation
 * - Max 254 characters
 * - Must have local and domain parts
 */
export function validateEmail(input: unknown): EmailValidationResult {
  if (typeof input !== "string") {
    return { valid: false, errors: ["Email must be a string"] };
  }

  const email = input.trim();
  const errors: string[] = [];

  if (email.length === 0) {
    return { valid: true, errors: [] }; // Optional field
  }

  if (email.length > 254) {
    errors.push("Email must be at most 254 characters");
  }

  // Simple RFC 5322-like validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    errors.push("Email must be a valid email address");
  }

  const [localPart, ...domainParts] = email.split("@");
  if (localPart && localPart.length > 64) {
    errors.push("Email local part must be at most 64 characters");
  }

  if (domainParts[0] && domainParts[0].length > 255) {
    errors.push("Email domain must be at most 255 characters");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** Display name validation */
export interface DisplayNameValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate display name (allows more characters than username)
 * - 1-64 characters
 * - No leading/trailing whitespace
 * - No control characters
 * - Unicode-aware
 */
export function validateDisplayName(input: unknown): DisplayNameValidationResult {
  if (typeof input !== "string") {
    return { valid: false, errors: ["Display name must be a string"] };
  }

  const displayName = input.trim();
  const errors: string[] = [];

  if (displayName.length === 0) {
    return { valid: true, errors: [] }; // Optional field
  }

  if (displayName.length > 64) {
    errors.push("Display name must be at most 64 characters");
  }

  // Check for control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F-\x9F]/.test(displayName)) {
    errors.push("Display name cannot contain control characters");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** Password validation rules */
export interface PasswordValidationResult {
  valid: boolean;
  strength: "weak" | "fair" | "good" | "strong";
  errors: string[];
  suggestions: string[];
}

/**
 * Validate password strength
 * - Minimum 10 characters
 * - Complexity requirements: uppercase, lowercase, numbers, special chars
 * - No common patterns
 */
export function validatePassword(input: unknown): PasswordValidationResult {
  if (typeof input !== "string") {
    return {
      valid: false,
      strength: "weak",
      errors: ["Password must be a string"],
      suggestions: [],
    };
  }

  const password = input;
  const errors: string[] = [];
  const suggestions: string[] = [];
  let strengthScore = 0;

  // Length check
  if (password.length < 10) {
    errors.push("Password must be at least 10 characters");
  } else {
    strengthScore += 1;
  }

  if (password.length >= 16) {
    strengthScore += 1;
  }

  // Complexity checks
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumbers = /[0-9]/.test(password);
  const hasSpecialChars = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);

  if (!hasUppercase) {
    suggestions.push("Add uppercase letters");
  } else {
    strengthScore += 1;
  }

  if (!hasLowercase) {
    suggestions.push("Add lowercase letters");
  } else {
    strengthScore += 1;
  }

  if (!hasNumbers) {
    suggestions.push("Add numbers");
  } else {
    strengthScore += 1;
  }

  if (!hasSpecialChars) {
    suggestions.push("Add special characters");
  } else {
    strengthScore += 1;
  }

  // Check for common patterns
  const commonPatterns = /^(123|abc|password|qwerty|admin|letmein|welcome|monkey|dragon)/i;
  if (commonPatterns.test(password)) {
    errors.push("Password is too common. Avoid dictionary words and keyboard patterns");
  }

  // Check for repeating characters
  if (/(.)\1{4,}/.test(password)) {
    suggestions.push("Avoid repeating characters");
  }

  let strength: "weak" | "fair" | "good" | "strong";
  if (strengthScore <= 2) {
    strength = "weak";
  } else if (strengthScore <= 4) {
    strength = "fair";
  } else if (strengthScore <= 6) {
    strength = "good";
  } else {
    strength = "strong";
  }

  return {
    valid: errors.length === 0,
    strength,
    errors,
    suggestions: suggestions.slice(0, 3), // Limit to 3 suggestions
  };
}

/** Lobby name validation */
export interface LobbyNameValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateLobbyName(input: unknown): LobbyNameValidationResult {
  if (typeof input !== "string") {
    return { valid: false, errors: ["Lobby name must be a string"] };
  }

  const name = input.trim();
  const errors: string[] = [];

  if (name.length === 0) {
    errors.push("Lobby name cannot be empty");
  }

  if (name.length > 128) {
    errors.push("Lobby name must be at most 128 characters");
  }

  // Check for control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F-\x9F]/.test(name)) {
    errors.push("Lobby name cannot contain control characters");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** Lobby password validation */
export interface LobbyPasswordValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateLobbyPassword(input: unknown): LobbyPasswordValidationResult {
  if (typeof input !== "string") {
    return { valid: false, errors: ["Lobby password must be a string"] };
  }

  const password = input.trim();
  const errors: string[] = [];

  if (password.length > 0 && password.length < 4) {
    errors.push("Lobby password must be at least 4 characters (or leave empty)");
  }

  if (password.length > 64) {
    errors.push("Lobby password must be at most 64 characters");
  }

  // Check for control characters
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1F\x7F-\x9F]/.test(password)) {
    errors.push("Lobby password cannot contain control characters");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/** Sanitize for display (prevent XSS) */
export function sanitizeForDisplay(input: string, maxLength: number = 256): string {
  if (typeof input !== "string") {
    return "";
  }

  return (
    input
      .slice(0, maxLength)
      .replace(/[<>"']/g, (char) => {
        const entities: Record<string, string> = {
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        };
        return entities[char] || char;
      })
      // Remove control characters
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1F\x7F-\x9F]/g, "")
  );
}

/** Normalize input string */
export function normalizeInput(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.trim().replace(/\s+/g, " ");
}

/** Validate and coerce a number within bounds */
export interface NumberValidationResult {
  valid: boolean;
  value: number;
  errors: string[];
}

export function validateNumber(
  input: unknown,
  min: number,
  max: number,
  label: string = "Value"
): NumberValidationResult {
  if (typeof input === "number" && Number.isFinite(input)) {
    if (input < min || input > max) {
      return {
        valid: false,
        value: Math.max(min, Math.min(max, input)),
        errors: [`${label} must be between ${min} and ${max}`],
      };
    }
    return { valid: true, value: input, errors: [] };
  }

  if (typeof input === "string") {
    const parsed = parseFloat(input.trim());
    if (Number.isNaN(parsed) || !Number.isFinite(parsed)) {
      return {
        valid: false,
        value: min,
        errors: [`${label} must be a valid number`],
      };
    }

    if (parsed < min || parsed > max) {
      return {
        valid: false,
        value: Math.max(min, Math.min(max, parsed)),
        errors: [`${label} must be between ${min} and ${max}`],
      };
    }

    return { valid: true, value: parsed, errors: [] };
  }

  return {
    valid: false,
    value: min,
    errors: [`${label} must be a number`],
  };
}

/**
 * Registration-time username checks that can run **before** `registerAccount`.
 *
 * **Collision / uniqueness** is enforced server-side when `registerAccount` runs;
 * this helper only validates local format rules so the user gets fast feedback.
 * Do not treat `valid: true` as “username is globally available.”
 */
export async function validateUsernameForRegistration(username: string): Promise<UsernameUniquenessResult> {
  const localValidation = validateUsername(username);
  if (!localValidation.valid) {
    return {
      valid: false,
      error: localValidation.errors[0],
    };
  }

  return {
    valid: true,
  };
}
