import NextAuth, { type NextAuthResult } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { SiwpMessage } from "@poktscan/vault-siwp";
import {createUser, getUser} from "./lib/dal/users";
import authConfig from "./auth.config";
import type {User} from "@igniter/db/provider/schema";

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
          const siwp = new SiwpMessage(
            JSON.parse((credentials?.message || "{}") as string)
          );

          const nextAuthUrl = new URL(process.env.AUTH_URL ?? "");

          const result = await siwp.verify({
            signature: (credentials?.signature as string) || "",
            domain: nextAuthUrl.host,
            publicKey: (credentials?.publicKey as string) || "",
          });

          let user;

          if (result.success) {
            user = await getUser(siwp.address);

            if (!user) {
              user = await createUser(siwp.address);
            }

            return user ?? null;
          }
          return null;
        } catch (error) {
          console.log(error);
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
    async jwt({ token, user, trigger }) {
      console.log('[AUTH:JWT] Callback triggered', {
        trigger,
        hasUser: !!user,
        hasTokenUser: !!token.user,
        tokenUserIdentity: (token.user as any)?.identity,
        userIdentity: (user as any)?.identity,
      });

      if (user) {
        // @TODO: Remove ts-ignore. Once we learn how to update the User type next-auth expects.
        // @ts-ignore
        token.user = user;
        console.log('[AUTH:JWT] Set token.user from user', {
          identity: (user as any)?.identity,
          role: (user as any)?.role,
        });
      }

      console.log('[AUTH:JWT] Returning token', {
        hasTokenUser: !!token.user,
        tokenUserIdentity: (token.user as any)?.identity,
      });

      return token;
    },
  },
});

export const handlers: NextAuthResult["handlers"] = authConfigResult.handlers;
export const auth: NextAuthResult["auth"] = authConfigResult.auth;
export const signIn: NextAuthResult["signIn"] = authConfigResult.signIn;
export const signOut: NextAuthResult["signOut"] = authConfigResult.signOut;
