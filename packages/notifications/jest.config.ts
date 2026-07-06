import type { Config } from 'jest'

const config: Config = {
  rootDir: '.',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Let the package's own tests import it by name (mapped to source).
    '^@igniter/notifications$': '<rootDir>/src/index.ts',
    '^@igniter/logger$': '<rootDir>/../logger/src/index.ts',
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
