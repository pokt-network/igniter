import { getApplicationSettings } from '@/lib/dal/applicationSettings'
import { usersTable, type User } from '@igniter/db/middleman/schema'
import { UserRole } from '@igniter/db/middleman/enums'
import { getDb } from '@/db'
import { eq } from 'drizzle-orm'
import { normalizeIdentityToAddress } from '@igniter/commons/crypto'
import { getLogger } from '@igniter/logger'
import { env } from '@/config/env'

const log = getLogger(['middleman', 'users'])

export async function createUser(identity: string) {
  try {
    const applicationSettings = await getApplicationSettings()

    const isOwner = ownerAddress() === identity

    const newUser = {
      email: isOwner ? applicationSettings.ownerEmail : '',
      identity,
      role: isOwner ? UserRole.Owner : UserRole.User,
    }

    // TODO: Once we support user-invitations, we should create the user with the invited role.

    return await getDb().insert(usersTable).values(newUser).returning().then((res) => res[0])
  } catch (error) {
    log.error('user creation failed', { identity, error })
    throw error
  }
}

export async function getUser(identity: string) {
  const users = await getDb()
    .select()
    .from(usersTable)
    .where(eq(usersTable.identity, identity))
    .limit(1)

  return users[0]
}

/**
 * The owner is whoever OWNER_IDENTITY names now, read from the environment (the settings row keeps
 * the identity of the setup time, so it would keep a rotated-out owner). Normalized in case it is
 * configured as a hex public key (legacy).
 */
export function ownerAddress(): string {
  return normalizeIdentityToAddress(env.OWNER_IDENTITY)
}

/** The role a user has now: Owner for the current OWNER_IDENTITY only; a former owner becomes a User. */
export function currentRole(user: Pick<User, 'identity' | 'role'>): UserRole {
  if (user.identity === ownerAddress()) return UserRole.Owner
  return user.role === UserRole.Owner ? UserRole.User : user.role
}

/** Stores the current role when it changed, and returns the user with it. */
export async function syncUserRole(user: User): Promise<User> {
  const role = currentRole(user)
  if (role === user.role) return user
  const [updated] = await getDb()
    .update(usersTable)
    .set({ role })
    .where(eq(usersTable.identity, user.identity))
    .returning()
  log.info('user role updated from OWNER_IDENTITY', { identity: user.identity, from: user.role, to: role })
  return updated ?? { ...user, role }
}

