import { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { bootstrapStatus } from "@/lib/services/bootstrap";
import { SiwpMessage } from "@poktscan/vault-siwp";
import {env} from "@/config/env";

const authConfig: NextAuthConfig = {
  trustHost: true,
  cookies: {
    sessionToken: {
      name: `middleman.authjs.session-token`,
    },
    callbackUrl: {
      name: `middleman.authjs.callback-url`,
    },
    csrfToken: {
      name: `middleman.authjs.csrf-token`,
    },
  },
  providers: [Credentials],
  callbacks: {
    async signIn({ user, credentials }) {
      const isBootstrapped = await bootstrapStatus();

      const { address } = new SiwpMessage(
        JSON.parse((credentials?.message || "{}") as string)
      );

      if (!isBootstrapped && address !== env.OWNER_IDENTITY) {
        return "/auth/error?type=NotReady";
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
