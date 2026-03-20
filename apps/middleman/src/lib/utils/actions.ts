import 'server-only'
import { auth } from '@/auth'
import { UserRole } from '@igniter/db/middleman/enums'

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
