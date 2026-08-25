import 'server-only'
import { auth } from '@/auth'
import { UserRole } from '@igniter/db/middleman/enums'
import { type ActionResult, success, error } from '@igniter/ui/lib/actionResult'
import { describeDatabaseFailure } from '@igniter/db/errors'
import { getLogger } from '@igniter/logger'

const log = getLogger(['middleman', 'actions'])

export async function getCurrentUser() {
  const session = await auth()

  if (!session) {
    throw new Error('Not logged in')
  }

  return session.user
}

export async function getCurrentUserIdentity() {
  const user = await getCurrentUser()
  return user.identity
}

export async function isUserAdmin() {
  const user = await getCurrentUser()
  // TODO: Either add UserRole.Admin or establish RBAC mechanism with permissions when adding support for multi admins.
  return [UserRole.Owner].includes(user.role)
}

/**
 * Gets the current user identity for use in server actions.
 * Use this at the top of server action functions to authenticate.
 * Re-exported as a shorter alias for convenience.
 */
export const requireAuth = getCurrentUserIdentity

/**
 * Gets the current user and asserts admin/owner role.
 * Throws if the current user is not an admin/owner.
 */
export async function requireAdmin() {
  const isAdmin = await isUserAdmin()
  if (!isAdmin) {
    throw new Error('Unauthorized')
  }
}

/**
 * Wrapper for server actions that require owner/admin and return the shared
 * `ActionResult<T>` shape. Keeps middleman's existing `requireAdmin()` auth
 * semantics; only the RESULT shape is standardized to match the provider app so
 * the shared workflows admin UI can read a single uniform result.
 */
export async function withRequireOwner<T>(
  action: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    await requireAdmin()
    const result = await action()
    return success(result)
  } catch (err) {
    // `cause` carries the driver's own error — the SQLSTATE and its detail line —
    // which the wrapper's message does not include.
    log.error('server action failed', { error: err, cause: (err as Error)?.cause })

    if (err instanceof Error) {
      if (err.message === 'Unauthorized' || err.message === 'Not logged in') {
        return error('UNAUTHORIZED', err.message)
      }
      // Database errors before the generic pass-through: their message is the
      // statement and its bound parameters (drizzle's DrizzleQueryError), or a
      // connection detail, so forwarding it would ship the schema, the values, or
      // the host to the browser.
      const dbFailure = describeDatabaseFailure(err)
      if (dbFailure) {
        return error(dbFailure.code, dbFailure.message)
      }
      if (err.message.includes('validation') || err.message.includes('Invalid')) {
        return error('VALIDATION_ERROR', err.message)
      }
      return error('INTERNAL_ERROR', err.message)
    }

    return error('INTERNAL_ERROR', 'An unexpected error occurred')
  }
}

/**
 * Asserts that an entity exists and is owned by the given user.
 * Throws descriptive errors if not found or unauthorized.
 */
export function assertOwnership<T>(
  entity: T | null | undefined,
  userIdentity: string,
  ownerField: keyof T,
  entityName: string,
): asserts entity is T {
  if (!entity) {
    throw new Error(`${entityName} not found`)
  }
  if (entity[ownerField] !== userIdentity) {
    throw new Error(`${entityName} not owned by user ${userIdentity}`)
  }
}
