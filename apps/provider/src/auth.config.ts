import { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {SiwpMessage} from "@poktscan/vault-siwp";
import {env} from "@/config/env";
import {normalizeIdentityToAddress} from "@igniter/commons/crypto";

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
    async signIn({ credentials }) {
      const { address } = new SiwpMessage(
        JSON.parse((credentials?.message || "{}") as string)
      );

      // Normalize OWNER_IDENTITY in case it was configured as a hex public key (legacy)
      const normalizedOwnerIdentity = normalizeIdentityToAddress(env.OWNER_IDENTITY);

      if (address !== normalizedOwnerIdentity) {
        return false;
      }

      return true;
    },
    async session({ session, token }) {
      // TODO: Remove ts-ignore when we figure out how to set the expected user type across next-auth
      // @ts-ignore
      session.user = token.user;
      return session;
    },
  },
};

export default authConfig;
