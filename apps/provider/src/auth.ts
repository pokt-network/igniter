import NextAuth, { type NextAuthResult } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  cookieFromRequest,
  loginNonceCookieName,
  SiwpLoginError,
  verifySiwpLogin,
} from "@igniter/ui/lib/siwpLogin";
import {createUser, getUser} from "./lib/dal/users";
import {getApplicationSettings} from "./lib/dal/applicationSettings";
import authConfig, { SESSION_MAX_AGE_SECONDS, useSecureCookies } from "./auth.config";
import type {User} from "@igniter/db/provider/schema";
import {UserRole} from "@igniter/db/provider/enums";
import {normalizeIdentityToAddress} from "@igniter/commons/crypto";
import {env} from "@/config/env";
import { getLogger } from "@igniter/logger";

const log = getLogger(["provider", "auth"]);

/**
 * Re-reads the session's user on every session read. Only the current OWNER_IDENTITY may hold a
 * session on the provider, so a rotated-out owner loses it at once; the session also ends when the
 * user row is gone or 30 minutes after login.
 */
export async function refreshSessionToken<T extends Record<string, unknown>>(token: T): Promise<T | null> {
  const loginAt = typeof token.loginAt === "number" ? token.loginAt : 0;
  if (!loginAt || Date.now() - loginAt > SESSION_MAX_AGE_SECONDS * 1000) {
    return null;
  }

  const identity = (token.user as { identity?: unknown } | undefined)?.identity;
  if (typeof identity !== "string" || identity !== normalizeIdentityToAddress(env.OWNER_IDENTITY)) {
    return null;
  }

  const user = await getUser(identity);
  if (!user) {
    return null;
  }

  return { ...token, user: { ...user, role: UserRole.Owner } };
}

const authConfigResult = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: "siwp",
      name: "POKT Morse",
      credentials: {
        message: {
          label: "Message",
          type: "text",
          placeholder: "0x0",
        },
        signature: {
          label: "Signature",
          type: "text",
          placeholder: "0x0",
        },
        publicKey: {
          label: "Public Key",
          type: "text",
          placeholder: "0x0",
        },
      },
      // @TODO: Remove ts-ignore. Once we learn how to update the User type next-auth expects.
      // @ts-ignore
      authorize: async (credentials, req): Promise<User | null> => {
        try {
          const address = await verifySiwpLogin(credentials, {
            domain: new URL(process.env.AUTH_URL ?? "").host,
            chainId: (await getApplicationSettings()).chainId,
            secret: process.env.AUTH_SECRET ?? "",
            nonceCookie: cookieFromRequest(req as Request, loginNonceCookieName("provider", useSecureCookies)),
          });

          let user = await getUser(address);

          if (!user) {
            user = await createUser(address);
          }

          return user ?? null;
        } catch (error) {
          if (error instanceof SiwpLoginError) {
            log.warn('authorization rejected', { reason: error.reason });
          } else {
            log.error('authorization failed', { error });
          }
          return null;
        }
      },
    }),
  ],
  pages: {
    signIn: "/",
  },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        // @TODO: Remove ts-ignore. Once we learn how to update the User type next-auth expects.
        // @ts-ignore
        token.user = user;
        token.loginAt = Date.now();
        return token;
      }
      return refreshSessionToken(token);
    },
  },
});

export const handlers: NextAuthResult["handlers"] = authConfigResult.handlers;
export const auth: NextAuthResult["auth"] = authConfigResult.auth;
export const signIn: NextAuthResult["signIn"] = authConfigResult.signIn;
export const signOut: NextAuthResult["signOut"] = authConfigResult.signOut;
