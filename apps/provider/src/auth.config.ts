import { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { bootstrapStatus } from "@/lib/services/bootstrap";
import {SiwpMessage} from "@poktscan/vault-siwp";
import {env} from "@/config/env";

const authConfig: NextAuthConfig = {
  trustHost: true,
  cookies: {
    sessionToken: {
      name: `provider.authjs.session-token`,
    },
    callbackUrl: {
      name: `provider.authjs.callback-url`,
    },
    csrfToken: {
      name: `provider.authjs.csrf-token`,
    },
  },
  providers: [Credentials],
  callbacks: {
    async signIn({ user, credentials}) {
      console.log('[AUTH:SIGNIN] Callback triggered', {
        hasUser: !!user,
        userIdentity: (user as any)?.identity,
        hasCredentials: !!credentials,
      });

      const isBootstrapped = await bootstrapStatus();

      const { address } = new SiwpMessage(
        JSON.parse((credentials?.message || "{}") as string)
      );

      console.log('[AUTH:SIGNIN] Bootstrap check', {
        isBootstrapped,
        address,
        ownerIdentity: env.OWNER_IDENTITY,
        isOwner: address === env.OWNER_IDENTITY,
      });

       if (!isBootstrapped && address !== env.OWNER_IDENTITY) {
         console.log('[AUTH:SIGNIN] Rejected - not bootstrapped and not owner');
         return '/auth/error?error=OwnerOnly';
       }

       console.log('[AUTH:SIGNIN] Approved');
       return true;
    },
    async session({ session, token }) {
      console.log('[AUTH:SESSION] Callback triggered', {
        hasSession: !!session,
        hasToken: !!token,
        hasTokenUser: !!token.user,
        tokenUserIdentity: (token.user as any)?.identity,
        tokenUserRole: (token.user as any)?.role,
      });

      // TODO: Remove ts-ignore when we figure out how to set the expected user type across next-auth
      // @ts-ignore
      session.user = token.user;

      console.log('[AUTH:SESSION] Set session.user', {
        hasSessionUser: !!session.user,
        sessionUserIdentity: (session.user as any)?.identity,
      });

      return session;
    },
  },
};

export default authConfig;
