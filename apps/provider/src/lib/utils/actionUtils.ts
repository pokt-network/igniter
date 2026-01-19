import 'server-only'

import { auth } from '@/auth'
import { UserRole } from '@igniter/db/provider/enums'
import type { User } from '@igniter/db/provider/schema'

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

// Authentication helpers
export async function getAuthenticatedUser(): Promise<User | null> {
  const session = await auth()
  if (!session?.user) {
    return null
  }
  return session.user as User
}

export async function requireAuth(): Promise<ActionResult<User>> {
  const user = await getAuthenticatedUser()
  if (!user) {
    return error('UNAUTHORIZED', 'You must be logged in to perform this action')
  }
  return success(user)
}

export async function requireRole(allowedRoles: UserRole[]): Promise<ActionResult<User>> {
  const authResult = await requireAuth()
  if (!authResult.success) {
    return authResult
  }

  const user = authResult.data
  if (!allowedRoles.includes(user.role)) {
    return error('FORBIDDEN', 'You do not have permission to perform this action')
  }

  return success(user)
}

export async function requireOwner(): Promise<ActionResult<User>> {
  return requireRole([UserRole.Owner])
}

export async function requireOwnerOrAdmin(): Promise<ActionResult<User>> {
  return requireRole([UserRole.Owner, UserRole.Admin])
}

// Wrapper for server actions that handles errors consistently
export async function withAuth<T>(
  authCheck: () => Promise<ActionResult<User>>,
  action: (user: User) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    const authResult = await authCheck()
    if (!authResult.success) {
      return authResult
    }

    const result = await action(authResult.data)
    return success(result)
  } catch (err) {
    console.error('[ActionError]', err)

    if (err instanceof Error) {
      // Check for known error types
      if (err.message === 'Unauthorized' || err.message === 'Not logged in') {
        return error('UNAUTHORIZED', err.message)
      }
      if (err.message.includes('validation') || err.message.includes('Invalid')) {
        return error('VALIDATION_ERROR', err.message)
      }
      return error('INTERNAL_ERROR', err.message)
    }

    return error('INTERNAL_ERROR', 'An unexpected error occurred')
  }
}

// Simplified wrapper that just requires authentication
export async function withRequireAuth<T>(
  action: (user: User) => Promise<T>,
): Promise<ActionResult<T>> {
  return withAuth(requireAuth, action)
}

// Wrapper that requires owner role
export async function withRequireOwner<T>(
  action: (user: User) => Promise<T>,
): Promise<ActionResult<T>> {
  return withAuth(requireOwner, action)
}

// Wrapper that requires owner or admin role
export async function withRequireOwnerOrAdmin<T>(
  action: (user: User) => Promise<T>,
): Promise<ActionResult<T>> {
  return withAuth(requireOwnerOrAdmin, action)
}