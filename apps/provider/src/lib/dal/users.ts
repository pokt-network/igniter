import {getApplicationSettings} from "@/lib/dal/applicationSettings";
import {UserRole} from "@igniter/db/provider/enums";
import {usersTable} from "@igniter/db/provider/schema";
import {getDb} from "@/db";
import {eq} from "drizzle-orm";
import {normalizeIdentityToAddress} from "@/lib/crypto";

export async function createUser(identity: string) {
  try {
    const applicationSettings = await getApplicationSettings();

    // Normalize ownerIdentity in case it was stored as a hex public key (legacy)
    const normalizedOwnerIdentity = normalizeIdentityToAddress(applicationSettings.ownerIdentity);
    const isOwner = normalizedOwnerIdentity === identity;

    const newUser = {
      email: isOwner ? applicationSettings.ownerEmail : "",
      identity,
      role: isOwner ? UserRole.Owner : UserRole.User,
    };

    // TODO: Once we support user-invitations, we should create the user with the invited role.

    return await getDb().insert(usersTable).values(newUser).returning().then((res) => res[0]);
  } catch (error) {
    console.error(`An error occurred while creating a user with Identity: ${identity}`, error);
    throw error;
  }
}

export async function getUser(identity: string) {
  const users = await getDb()
    .select()
    .from(usersTable)
    .where(eq(usersTable.identity, identity))
    .limit(1);

  return users[0];
}
