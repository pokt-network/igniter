import type { User } from '@igniter/db/middleman/schema'

import NextAuth, { type NextAuthResult } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'

import { getLogger } from '@igniter/logger'

import {
  cookieFromRequest,
  loginNonceCookieName,
  SiwpLoginError,
  verifySiwpLogin,
} from '@igniter/ui/lib/siwpLogin'

import {
  createUser,
  currentRole,
  getUser,
  syncUserRole,
} from './lib/dal/users'
import { getApplicationSettings } from './lib/dal/applicationSettings'
import authConfig, { SESSION_MAX_AGE_SECONDS, useSecureCookies } from './auth.config'

const log = getLogger(['middleman', 'auth'])

/**
 * Re-reads the session's user on every session read: the session ends when the user row is gone or
 * 30 minutes after login, and the role is the current one (OWNER_IDENTITY now), not the one at login.
 */
export async function refreshSessionToken<T extends Record<string, unknown>>(token: T): Promise<T | null> {
  const loginAt = typeof token.loginAt === 'number' ? token.loginAt : 0
  if (!loginAt || Date.now() - loginAt > SESSION_MAX_AGE_SECONDS * 1000) {
    return null
  }

  const identity = (token.user as { identity?: unknown } | undefined)?.identity
  if (typeof identity !== 'string' || !identity) {
    return null
  }

  const user = await getUser(identity)
  if (!user) {
    return null
  }

  return { ...token, user: { ...user, role: currentRole(user) } }
}

const authConfigResult = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: 'siwp',
      name: 'POKT Morse',
      credentials: {
        message: {
          label: 'Message',
          type: 'text',
          placeholder: '0x0',
        },
        signature: {
          label: 'Signature',
          type: 'text',
          placeholder: '0x0',
        },
        publicKey: {
          label: 'Public Key',
          type: 'text',
          placeholder: '0x0',
        },
      },
      // @TODO: Remove ts-ignore. Once we learn how to update the User type next-auth expects.
      // @ts-ignore
      authorize: async (credentials, req): Promise<User | null> => {
        try {
          const domain = new URL(process.env.AUTH_URL ?? '').host

          // NEVER log signature/message/publicKey raw (spec §0, §7): signature
          // is a secret, message/publicKey are auth material. domain is the
          // only non-sensitive context worth a line here.
          log.debug('siwp verification attempt', { domain })

          const address = await verifySiwpLogin(credentials, {
            domain,
            chainId: (await getApplicationSettings()).chainId,
            secret: process.env.AUTH_SECRET ?? '',
            nonceCookie: cookieFromRequest(req as Request, loginNonceCookieName('middleman', useSecureCookies)),
          })

          let user = await getUser(address)

          if (!user) {
            user = await createUser(address)
            log.info('user created on first login', { address })
          } else {
            // The role follows OWNER_IDENTITY as it is now, not as it was when the user was created.
            user = await syncUserRole(user)
          }

          log.info('siwp login verified', { address })
          return user ?? null
        } catch (error) {
          if (error instanceof SiwpLoginError) {
            log.warn('siwp verification rejected', { reason: error.reason })
          } else {
            log.error('siwp verification failed', { error })
          }
          return null
        }
      },
    }),
  ],
  pages: {
    signIn: '/',
  },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        // @TODO: Remove ts-ignore. Once we learn how to update the User type next-auth expects.
        // @ts-ignore
        token.user = user
        token.loginAt = Date.now()
        return token
      }
      return refreshSessionToken(token)
    },
  },
})

export const handlers: NextAuthResult['handlers'] = authConfigResult.handlers
export const auth: NextAuthResult['auth'] = authConfigResult.auth
export const signIn: NextAuthResult['signIn'] = authConfigResult.signIn
export const signOut: NextAuthResult['signOut'] = authConfigResult.signOut
