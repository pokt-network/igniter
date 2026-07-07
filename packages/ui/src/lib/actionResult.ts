/**
 * Standardized server-action result shape shared across apps.
 *
 * A discriminated union so callers can narrow on `success`. Both the provider
 * and middleman admin apps return this from their Temporal `Workflows` server
 * actions, which lets the shared workflows admin UI (see
 * `@igniter/ui/components/workflows/*`) read a single, uniform result shape.
 *
 * This module is intentionally free of `server-only`/React so it can be pulled
 * in from both server actions (the `success`/`error` helpers) and client
 * components (the `ActionResult` type, which is erased at compile time).
 */

// Error codes for client-side handling
export const ActionErrorCode = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ActionErrorCode = (typeof ActionErrorCode)[keyof typeof ActionErrorCode]

// Standardized error response
export interface ActionError {
  code: ActionErrorCode
  message: string
}

// Standardized action result type
export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: ActionError }

// Helper to create success response
export function success<T>(data: T): ActionResult<T> {
  return { success: true, data }
}

// Helper to create error response
export function error<T>(code: ActionErrorCode, message: string): ActionResult<T> {
  return { success: false, error: { code, message } }
}
