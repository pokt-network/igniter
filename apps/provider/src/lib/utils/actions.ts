import 'server-only';
import {auth} from "@/auth";

export async function getCurrentUser() {
  console.log('[UTILS:getCurrentUser] Called');

  const session = await auth();

  console.log('[UTILS:getCurrentUser] Session result', {
    hasSession: !!session,
    hasUser: !!session?.user,
    userIdentity: (session?.user as any)?.identity,
    userRole: (session?.user as any)?.role,
  });

  if (!session) {
    console.log('[UTILS:getCurrentUser] No session - throwing "Not logged in"');
    throw new Error("Not logged in");
  }

  if (!session.user) {
    console.log('[UTILS:getCurrentUser] Session exists but no user - this is unexpected!');
    throw new Error("Session exists but user is missing");
  }

  return session.user;
}

export async function getCurrentUserIdentity() {
  console.log('[UTILS:getCurrentUserIdentity] Called');

  const user = await getCurrentUser();

  console.log('[UTILS:getCurrentUserIdentity] Got user', {
    hasIdentity: !!(user as any)?.identity,
    identity: (user as any)?.identity,
  });

  if (!(user as any)?.identity) {
    console.log('[UTILS:getCurrentUserIdentity] User has no identity!', { user });
  }

  return (user as any).identity;
}
