import { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

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
    async session({ session, token }) {
      // TODO: Remove ts-ignore when we figure out how to set the expected user type across next-auth
      // @ts-ignore
      session.user = token.user;
      return session;
    },
  },
};

export default authConfig;
