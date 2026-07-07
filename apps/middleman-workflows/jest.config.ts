import type { Config } from 'jest'
const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@igniter/pocket/proto/generated/(.*)$': '<rootDir>/../../packages/pocket/src/proto/generated/$1',
    '^@igniter/pocket/proto/(.*)$': '<rootDir>/../../packages/pocket/src/proto/generated/$1',
    '^@igniter/pocket/(.*)$': '<rootDir>/../../packages/pocket/src/$1',
    '^@igniter/pocket$': '<rootDir>/../../packages/pocket/src/index.ts',
    '^@igniter/tx-verify$': '<rootDir>/../../packages/tx-verify/src/index.ts',
    '^@igniter/domain/(.*)$': '<rootDir>/../../packages/domain/src/$1',
    // Enum subpaths live under schema/ but are published as ./middleman/enums
    // (see @igniter/db package exports); map them before the generic db rule.
    '^@igniter/db/middleman/enums$': '<rootDir>/../../packages/db/src/middleman/schema/enums.ts',
    '^@igniter/db/provider/enums$': '<rootDir>/../../packages/db/src/provider/schema/enums.ts',
    '^@igniter/db/(.*)$': '<rootDir>/../../packages/db/src/$1',
    '^@igniter/logger$': '<rootDir>/../../packages/logger/src/index.ts',
    '^@igniter/notifications$': '<rootDir>/../../packages/notifications/src/index.ts',
    '^@pocket/(.*)$': '<rootDir>/../../packages/pocket/src/$1',
  },
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        diagnostics: false,
      },
    ],
  },
}
export default config
