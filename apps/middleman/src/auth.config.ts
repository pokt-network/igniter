import { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

// Sessions last at most 30 minutes from login (the jwt callback in auth.ts enforces it as an
// absolute limit; Auth.js would otherwise slide the expiry on every request).
export const SESSION_MAX_AGE_SECONDS = 30 * 60

export const useSecureCookies = (process.env.AUTH_URL ?? '').startsWith('https://')
// `__Host-`: Secure, Path=/ and no Domain, so a sibling subdomain cannot set or read them.
const cookiePrefix = useSecureCookies ? '__Host-' : ''

const authConfig: NextAuthConfig = {
  trustHost: true,
  // Secure cookies whenever the app is served over https. The names are computed here, once,
  // so the edge middleware and the node handlers always look up the same session cookie.
  useSecureCookies,
  cookies: {
    sessionToken: {
      name: `${cookiePrefix}middleman.authjs.session-token`,
    },
    callbackUrl: {
      name: `${cookiePrefix}middleman.authjs.callback-url`,
    },
    csrfToken: {
      name: `${cookiePrefix}middleman.authjs.csrf-token`,
    },
  },
  session: {
    strategy: 'jwt',
    maxAge: SESSION_MAX_AGE_SECONDS,
  },
  providers: [Credentials],
  callbacks: {
    // Edge-safe (no DB): the session ends SESSION_MAX_AGE_SECONDS after login here too, so the
    // middleware and the node handlers agree. auth.ts replaces this callback in node with one that
    // also re-reads the user; it applies the same limit.
    async jwt({ token, user }) {
      if (user) return token
      const loginAt = typeof token.loginAt === 'number' ? token.loginAt : 0
      if (!loginAt || Date.now() - loginAt > SESSION_MAX_AGE_SECONDS * 1000) {
        return null
      }
      return token
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
