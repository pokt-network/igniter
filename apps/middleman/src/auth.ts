import type { User } from '@igniter/db/middleman/schema'

import NextAuth, { type NextAuthResult } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'

import { SiwpMessage } from '@poktscan/vault-siwp'
import { getLogger } from '@igniter/logger'

import {
  createUser,
  getUser,
} from './lib/dal/users'
import authConfig from './auth.config'

const log = getLogger(['middleman', 'auth'])

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
          const siwp = new SiwpMessage(
            JSON.parse((credentials?.message || '{}') as string),
          )

          const nextAuthUrl = new URL(process.env.AUTH_URL ?? '')

          // NEVER log signature/message/publicKey raw (spec §0, §7): signature
          // is a secret, message/publicKey are auth material. domain is the
          // only non-sensitive context worth a line here.
          log.debug('siwp verification attempt', { domain: nextAuthUrl.host })

          const results = await Promise.allSettled([
            siwp.verifyERC4361({
              signature: (credentials?.signature as string) || '',
              domain: nextAuthUrl.host,
              publicKey: (credentials?.publicKey as string) || '',
            }),
            siwp.verifyAdr36({
              signature: (credentials?.signature as string) || '',
              domain: nextAuthUrl.host,
              publicKey: (credentials?.publicKey as string) || '',
            }),
          ])

          if (results.every((result) => result.status === 'rejected')) {
            throw (results.at(0) as  PromiseRejectedResult).reason
          }

          const result = results.find(result => result.status === 'fulfilled')!.value

          let user

          if (result.success) {
            user = await getUser(siwp.address)

            if (!user) {
              user = await createUser(siwp.address)
              log.info('user created on first login', { address: siwp.address })
            }

            log.info('siwp login verified', { address: siwp.address })
            return user ?? null
          }
          log.warn('siwp verification rejected', { address: siwp.address })
          return null
        } catch (error) {
          log.error('siwp verification failed', { error })
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
      }
      return token
    },
  },
})

export const handlers: NextAuthResult['handlers'] = authConfigResult.handlers
export const auth: NextAuthResult['auth'] = authConfigResult.auth
export const signIn: NextAuthResult['signIn'] = authConfigResult.signIn
export const signOut: NextAuthResult['signOut'] = authConfigResult.signOut
