import 'server-only';
import {auth} from "@/auth";

/**
 * @deprecated Use actionUtils.ts helpers instead (withRequireAuth, withRequireOwner, etc.)
 */
export async function getCurrentUser() {
  const session = await auth();

  if (!session) {
    throw new Error("Not logged in");
  }

  if (!session.user) {
    throw new Error("Session exists but user is missing");
  }

  return session.user;
}

/**
 * @deprecated Use actionUtils.ts helpers instead (withRequireAuth, withRequireOwner, etc.)
 */
export async function getCurrentUserIdentity() {
  const user = await getCurrentUser();
  return (user as any).identity;
}
